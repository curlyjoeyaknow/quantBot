/**
 * ConditionEvaluator
 *
 * Evaluates StrategyGraph nodes at runtime.
 * Designed for vectorized evaluation per (token_id, ts).
 */

import type { GraphNode, FeatureRefNode, ComparisonNode, CrossNode, LogicalNode } from './types.js';
import { logger } from '@quantbot/utils';

/**
 * Feature data for a single timestamp
 */
export interface FeatureRow {
  tokenId: string;
  ts: number;
  [featureName: string]: string | number; // Feature values indexed by name
}

/**
 * Previous row for cross detection
 */
export interface PreviousRow {
  [featureName: string]: number | string;
}

/**
 * Evaluation context
 */
export interface EvaluationContext {
  currentRow: FeatureRow;
  previousRow?: PreviousRow;
}

/**
 * ConditionEvaluator
 */
export class ConditionEvaluator {
  /**
   * Evaluate a graph node
   */
  evaluate(node: GraphNode, context: EvaluationContext): boolean {
    switch (node.type) {
      case 'feature_ref':
        return this.evaluateFeatureRef(node, context);
      case 'comparison':
        return this.evaluateComparison(node, context);
      case 'cross':
        return this.evaluateCross(node, context);
      case 'logical':
        return this.evaluateLogical(node, context);
      default:
        logger.error('Unknown node type', { node });
        return false;
    }
  }

  /**
   * Evaluate feature reference (always returns true, value is used in comparisons)
   */
  private evaluateFeatureRef(node: FeatureRefNode, context: EvaluationContext): boolean {
    // Feature refs are used in comparisons, not as boolean values
    // This should not be called directly
    logger.warn('evaluateFeatureRef called directly (should be used in comparisons)', { node });
    return true;
  }

  /**
   * Get feature value from context
   */
  private getFeatureValue(featureName: string, context: EvaluationContext): number {
    const value = context.currentRow[featureName];
    if (typeof value !== 'number') {
      logger.warn('Feature value is not a number', { featureName, value, type: typeof value });
      return 0;
    }
    return value;
  }

  /**
   * Evaluate comparison node
   */
  private evaluateComparison(node: ComparisonNode, context: EvaluationContext): boolean {
    // Get left value
    let leftValue: number;
    if (node.left.type === 'feature_ref') {
      leftValue = this.getFeatureValue(node.left.featureName, context);
    } else {
      // Left is also a node (shouldn't happen in practice, but handle it)
      logger.warn('Comparison left is not a feature ref', { node });
      return false;
    }

    // Get right value
    let rightValue: number;
    if (typeof node.right === 'number') {
      rightValue = node.right;
    } else if (typeof node.right === 'string') {
      // Try to parse as number
      rightValue = parseFloat(node.right);
      if (isNaN(rightValue)) {
        logger.warn('Comparison right is not a number', { node, right: node.right });
        return false;
      }
    } else if (node.right.type === 'feature_ref') {
      rightValue = this.getFeatureValue(node.right.featureName, context);
    } else {
      logger.warn('Comparison right is not a number or feature ref', { node });
      return false;
    }

    // Evaluate comparison
    switch (node.operator) {
      case 'gt':
        return leftValue > rightValue;
      case 'lt':
        return leftValue < rightValue;
      case 'gte':
        return leftValue >= rightValue;
      case 'lte':
        return leftValue <= rightValue;
      case 'eq':
        return Math.abs(leftValue - rightValue) < 1e-9; // Floating point comparison
      case 'ne':
        return Math.abs(leftValue - rightValue) >= 1e-9;
      default:
        logger.error('Unknown comparison operator', { node, operator: node.operator });
        return false;
    }
  }

  /**
   * Evaluate cross node
   */
  private evaluateCross(node: CrossNode, context: EvaluationContext): boolean {
    if (!context.previousRow) {
      // No previous row - cannot detect cross
      return false;
    }

    // Both left and right must be FeatureRefNode for cross detection
    if (node.left.type !== 'feature_ref' || node.right.type !== 'feature_ref') {
      logger.warn('Cross node requires feature_ref nodes for left and right', { node });
      return false;
    }

    const leftFeatureName = node.left.featureName;
    const rightFeatureName = node.right.featureName;
    const leftCurrent = this.getFeatureValue(leftFeatureName, context);
    const rightCurrent = this.getFeatureValue(rightFeatureName, context);
    const leftPreviousRaw = context.previousRow[leftFeatureName] ?? leftCurrent;
    const rightPreviousRaw = context.previousRow[rightFeatureName] ?? rightCurrent;
    // Convert to numbers (handle string values)
    const leftPrevious =
      typeof leftPreviousRaw === 'number'
        ? leftPreviousRaw
        : parseFloat(String(leftPreviousRaw)) || leftCurrent;
    const rightPrevious =
      typeof rightPreviousRaw === 'number'
        ? rightPreviousRaw
        : parseFloat(String(rightPreviousRaw)) || rightCurrent;

    switch (node.operator) {
      case 'cross_up':
        // Left crosses above right: left_prev <= right_prev AND left_current > right_current
        return leftPrevious <= rightPrevious && leftCurrent > rightCurrent;
      case 'cross_down':
        // Left crosses below right: left_prev >= right_prev AND left_current < right_current
        return leftPrevious >= rightPrevious && leftCurrent < rightCurrent;
      default:
        logger.error('Unknown cross operator', { node, operator: node.operator });
        return false;
    }
  }

  /**
   * Evaluate logical node
   */
  private evaluateLogical(node: LogicalNode, context: EvaluationContext): boolean {
    const results = node.children.map((child) => this.evaluate(child, context));

    switch (node.operator) {
      case 'all':
        return results.every((r) => r === true);
      case 'any':
        return results.some((r) => r === true);
      default:
        logger.error('Unknown logical operator', { node, operator: node.operator });
        return false;
    }
  }

  /**
   * Evaluate multiple entry nodes (returns true if any entry condition is true)
   */
  evaluateEntries(nodes: GraphNode[], context: EvaluationContext): boolean {
    return nodes.some((node) => this.evaluate(node, context));
  }

  /**
   * Evaluate multiple exit nodes (returns true if any exit condition is true)
   */
  evaluateExits(nodes: GraphNode[], context: EvaluationContext): boolean {
    return nodes.some((node) => this.evaluate(node, context));
  }
}

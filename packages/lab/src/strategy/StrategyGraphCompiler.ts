/**
 * StrategyGraphCompiler
 *
 * Compiles YAML condition trees into executable StrategyGraph.
 *
 * Input: YAML condition tree from preset
 * Output: StrategyGraph with pre-resolved feature references
 */

import { createHash } from 'crypto';
import type { ConditionTree, GraphNode, StrategyGraph } from './types.js';
import { logger } from '@quantbot/utils';

/**
 * StrategyGraphCompiler
 */
export class StrategyGraphCompiler {
  private nodeIdCounter = 0;
  private featureNames: Set<string> = new Set();

  /**
   * Generate unique node ID
   */
  private generateNodeId(): string {
    return `node_${this.nodeIdCounter++}`;
  }

  /**
   * Parse feature reference (can be feature name or constant)
   */
  private parseFeatureRef(ref: string | number): GraphNode | number | string {
    if (typeof ref === 'number') {
      return ref;
    }
    if (typeof ref === 'string' && /^-?\d+\.?\d*$/.test(ref)) {
      // Numeric string
      return parseFloat(ref);
    }
    // Feature name
    this.featureNames.add(ref);
    return {
      id: this.generateNodeId(),
      type: 'feature_ref',
      featureName: ref,
    };
  }

  /**
   * Compile condition tree to graph node
   */
  private compileCondition(condition: ConditionTree): GraphNode {
    if ('all' in condition) {
      return {
        id: this.generateNodeId(),
        type: 'logical',
        operator: 'all',
        children: condition.all.map((c) => this.compileCondition(c)),
      };
    }

    if ('any' in condition) {
      return {
        id: this.generateNodeId(),
        type: 'logical',
        operator: 'any',
        children: condition.any.map((c) => this.compileCondition(c)),
      };
    }

    if ('gt' in condition) {
      const left = this.parseFeatureRef(condition.gt.a);
      const right = this.parseFeatureRef(condition.gt.b);
      return {
        id: this.generateNodeId(),
        type: 'comparison',
        operator: 'gt',
        left:
          typeof left === 'object'
            ? left
            : { id: this.generateNodeId(), type: 'feature_ref', featureName: String(left) },
        right: typeof right === 'object' ? right : right,
      };
    }

    if ('lt' in condition) {
      const left = this.parseFeatureRef(condition.lt.a);
      const right = this.parseFeatureRef(condition.lt.b);
      return {
        id: this.generateNodeId(),
        type: 'comparison',
        operator: 'lt',
        left:
          typeof left === 'object'
            ? left
            : { id: this.generateNodeId(), type: 'feature_ref', featureName: String(left) },
        right: typeof right === 'object' ? right : right,
      };
    }

    if ('gte' in condition) {
      const left = this.parseFeatureRef(condition.gte.a);
      const right = this.parseFeatureRef(condition.gte.b);
      return {
        id: this.generateNodeId(),
        type: 'comparison',
        operator: 'gte',
        left:
          typeof left === 'object'
            ? left
            : { id: this.generateNodeId(), type: 'feature_ref', featureName: String(left) },
        right: typeof right === 'object' ? right : right,
      };
    }

    if ('lte' in condition) {
      const left = this.parseFeatureRef(condition.lte.a);
      const right = this.parseFeatureRef(condition.lte.b);
      return {
        id: this.generateNodeId(),
        type: 'comparison',
        operator: 'lte',
        left:
          typeof left === 'object'
            ? left
            : { id: this.generateNodeId(), type: 'feature_ref', featureName: String(left) },
        right: typeof right === 'object' ? right : right,
      };
    }

    if ('eq' in condition) {
      const left = this.parseFeatureRef(condition.eq.a);
      const right = this.parseFeatureRef(condition.eq.b);
      return {
        id: this.generateNodeId(),
        type: 'comparison',
        operator: 'eq',
        left:
          typeof left === 'object'
            ? left
            : { id: this.generateNodeId(), type: 'feature_ref', featureName: String(left) },
        right: typeof right === 'object' ? right : right,
      };
    }

    if ('ne' in condition) {
      const left = this.parseFeatureRef(condition.ne.a);
      const right = this.parseFeatureRef(condition.ne.b);
      return {
        id: this.generateNodeId(),
        type: 'comparison',
        operator: 'ne',
        left:
          typeof left === 'object'
            ? left
            : { id: this.generateNodeId(), type: 'feature_ref', featureName: String(left) },
        right: typeof right === 'object' ? right : right,
      };
    }

    if ('cross_up' in condition) {
      const left = this.parseFeatureRef(condition.cross_up.a);
      const right = this.parseFeatureRef(condition.cross_up.b);
      if (typeof left !== 'object' || typeof right !== 'object') {
        throw new Error('cross_up requires feature references (not constants)');
      }
      return {
        id: this.generateNodeId(),
        type: 'cross',
        operator: 'cross_up',
        left,
        right,
      };
    }

    if ('cross_down' in condition) {
      const left = this.parseFeatureRef(condition.cross_down.a);
      const right = this.parseFeatureRef(condition.cross_down.b);
      if (typeof left !== 'object' || typeof right !== 'object') {
        throw new Error('cross_down requires feature references (not constants)');
      }
      return {
        id: this.generateNodeId(),
        type: 'cross',
        operator: 'cross_down',
        left,
        right,
      };
    }

    throw new Error(`Unknown condition type: ${JSON.stringify(condition)}`);
  }

  /**
   * Compile strategy from YAML preset
   */
  compileStrategy(args: {
    entries: Array<{ name: string; when: ConditionTree }>;
    exits: Array<{ name: string; when: ConditionTree }>;
  }): StrategyGraph {
    this.nodeIdCounter = 0;
    this.featureNames.clear();

    const entryNodes: GraphNode[] = [];
    const exitNodes: GraphNode[] = [];

    // Compile entry conditions
    for (const entry of args.entries) {
      try {
        const node = this.compileCondition(entry.when);
        entryNodes.push(node);
        logger.debug('Compiled entry condition', { name: entry.name, nodeId: node.id });
      } catch (error) {
        logger.error('Failed to compile entry condition', error as Error, { entry: entry.name });
        throw error;
      }
    }

    // Compile exit conditions
    for (const exit of args.exits) {
      try {
        const node = this.compileCondition(exit.when);
        exitNodes.push(node);
        logger.debug('Compiled exit condition', { name: exit.name, nodeId: node.id });
      } catch (error) {
        logger.error('Failed to compile exit condition', error as Error, { exit: exit.name });
        throw error;
      }
    }

    return {
      entryNodes,
      exitNodes,
      featureNames: Array.from(this.featureNames),
    };
  }

  /**
   * Compute strategy graph hash (for caching)
   */
  static computeGraphHash(graph: StrategyGraph): string {
    const graphStr = JSON.stringify(graph, null, 2);
    return createHash('sha256').update(graphStr).digest('hex').slice(0, 16);
  }
}

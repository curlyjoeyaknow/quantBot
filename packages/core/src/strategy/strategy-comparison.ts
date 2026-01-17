/**
 * Strategy Comparison Service
 *
 * Provides services for comparing strategies by ID, file path, or version.
 */

import type { StrategyDSL } from './dsl-schema.js';
import { computeStrategyDiff, calculateSimilarity, formatDiffAsString } from './strategy-diff.js';
import type { StrategyDiff, StrategyComparison } from './diff-types.js';

/**
 * Strategy Comparison Service
 */
export class StrategyComparisonService {
  /**
   * Compare two strategy DSL objects
   */
  compare(strategy1: StrategyDSL, strategy2: StrategyDSL): StrategyComparison {
    const diff = computeStrategyDiff(strategy1, strategy2);
    const similarity = calculateSimilarity(strategy1, strategy2);

    return {
      strategy1,
      strategy2,
      diff,
      similarity,
    };
  }

  /**
   * Compare strategies by file path
   *
   * @param path1 - Path to first strategy file
   * @param path2 - Path to second strategy file
   * @returns Comparison result
   */
  async compareByPath(path1: string, path2: string): Promise<StrategyComparison> {
    const { readFileSync } = await import('fs');

    const content1 = readFileSync(path1, 'utf-8');
    const content2 = readFileSync(path2, 'utf-8');

    // Remove comments and parse JSON (simple approach - assumes valid JSON)
    const strategy1 = JSON.parse(content1.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')) as StrategyDSL;
    const strategy2 = JSON.parse(content2.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')) as StrategyDSL;

    return this.compare(strategy1, strategy2);
  }

  /**
   * Format comparison as human-readable string
   */
  formatComparison(comparison: StrategyComparison, format: 'text' | 'json' = 'text'): string {
    if (format === 'json') {
      return JSON.stringify(comparison, null, 2);
    }

    const lines: string[] = [];
    lines.push(`Strategy 1: ${comparison.strategy1.name} (${comparison.strategy1.id || 'no-id'})`);
    lines.push(`Strategy 2: ${comparison.strategy2.name} (${comparison.strategy2.id || 'no-id'})`);
    lines.push(`Similarity: ${(comparison.similarity * 100).toFixed(1)}%`);
    lines.push('');
    lines.push(formatDiffAsString(comparison.diff));

    return lines.join('\n');
  }

  /**
   * Get summary of differences
   */
  getSummary(comparison: StrategyComparison): {
    identical: boolean;
    similarity: number;
    differences: {
      added: number;
      removed: number;
      changed: number;
      total: number;
    };
  } {
    return {
      identical: comparison.diff.summary.identical,
      similarity: comparison.similarity,
      differences: {
        added: comparison.diff.summary.added,
        removed: comparison.diff.summary.removed,
        changed: comparison.diff.summary.changed,
        total: comparison.diff.summary.totalDifferences,
      },
    };
  }
}


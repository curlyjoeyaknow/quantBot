/**
 * Handler for comparing strategies (summary)
 */

import type { CommandContext } from '../../core/command-context.js';
import { StrategyComparisonService, parseStrategyDSL } from '@quantbot/core';
import { readFileSync, existsSync } from 'fs';

export interface CompareStrategyArgs {
  strategy1: string;
  strategy2: string;
  format: 'json' | 'table' | 'text';
}

export async function compareStrategyHandler(
  args: CompareStrategyArgs,
  _ctx: CommandContext
): Promise<unknown> {
  const service = new StrategyComparisonService();

  // Load strategies
  const strategy1 = await loadStrategy(args.strategy1);
  const strategy2 = await loadStrategy(args.strategy2);

  // Compare strategies
  const comparison = service.compare(strategy1, strategy2);
  const summary = service.getSummary(comparison);

  // Format output
  if (args.format === 'json') {
    return {
      summary,
      diff: comparison.diff,
    };
  }

  if (args.format === 'text') {
    const lines: string[] = [];
    lines.push(`Strategy Comparison Summary`);
    lines.push(`============================`);
    lines.push(`Strategy 1: ${comparison.strategy1.name}`);
    lines.push(`Strategy 2: ${comparison.strategy2.name}`);
    lines.push(`Similarity: ${(summary.similarity * 100).toFixed(1)}%`);
    lines.push(`Identical: ${summary.identical ? 'Yes' : 'No'}`);
    lines.push('');
    lines.push(`Differences:`);
    lines.push(`  Added: ${summary.differences.added}`);
    lines.push(`  Removed: ${summary.differences.removed}`);
    lines.push(`  Changed: ${summary.differences.changed}`);
    lines.push(`  Total: ${summary.differences.total}`);
    return lines.join('\n');
  }

  // Table format
  return {
    strategy1: comparison.strategy1.name,
    strategy2: comparison.strategy2.name,
    identical: summary.identical,
    similarity: `${(summary.similarity * 100).toFixed(1)}%`,
    differences: summary.differences.total,
  };
}

/**
 * Load strategy from file path or strategy ID
 */
async function loadStrategy(pathOrId: string): Promise<import('@quantbot/core').StrategyDSL> {
  // Check if it's a file path
  if (existsSync(pathOrId)) {
    const content = readFileSync(pathOrId, 'utf-8');
    // Remove comments and parse JSON
    const cleaned = content.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    return parseStrategyDSL(cleaned);
  }

  // TODO: Load from strategy repository by ID
  // For now, assume it's a file path that doesn't exist
  throw new Error(`Strategy not found: ${pathOrId}. Please provide a valid file path.`);
}


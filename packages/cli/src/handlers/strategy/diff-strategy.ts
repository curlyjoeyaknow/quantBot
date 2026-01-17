/**
 * Handler for comparing two strategies (diff)
 */

import type { CommandContext } from '../../core/command-context.js';
import { StrategyComparisonService, parseStrategyDSL } from '@quantbot/core';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface DiffStrategyArgs {
  strategy1: string;
  strategy2: string;
  format: 'json' | 'table' | 'text';
  output?: string;
}

export async function diffStrategyHandler(
  args: DiffStrategyArgs,
  _ctx: CommandContext
): Promise<unknown> {
  const service = new StrategyComparisonService();

  // Load strategies (from file path or strategy ID)
  const strategy1 = await loadStrategy(args.strategy1);
  const strategy2 = await loadStrategy(args.strategy2);

  // Compare strategies
  const comparison = service.compare(strategy1, strategy2);

  // Format output
  if (args.format === 'json') {
    return comparison;
  }

  if (args.format === 'text') {
    return service.formatComparison(comparison, 'text');
  }

  // Table format (simplified summary)
  const summary = service.getSummary(comparison);
  return {
    strategy1: comparison.strategy1.name,
    strategy2: comparison.strategy2.name,
    identical: summary.identical,
    similarity: `${(summary.similarity * 100).toFixed(1)}%`,
    differences: {
      added: summary.differences.added,
      removed: summary.differences.removed,
      changed: summary.differences.changed,
      total: summary.differences.total,
    },
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


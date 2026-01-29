/**
 * Catalog Sync Handler
 *
 * Scans completed backtest runs and registers them in the DuckDB catalog.
 * This is the "daemon" operation that makes runs queryable.
 * Pure handler - depends only on ports, no direct I/O
 */

import type { CommandContext } from '../../core/command-context.js';

export interface CatalogSyncArgs {
  baseDir?: string;
  duckdb?: string;
  stats?: boolean;
}

/**
 * Simple catalog implementation - scans runs and returns stats
 * Full catalog would require DuckDB persistence (can be added later)
 * Pure handler - uses backtest results port
 */
export async function catalogSyncHandler(
  args: CatalogSyncArgs,
  ctx: CommandContext
): Promise<{
  registered: number;
  skipped: number;
  stats?: {
    totalRuns: number;
    completedRuns: number;
    failedRuns: number;
    runsByType: Record<string, number>;
    totalArtifacts: number;
    artifactsByType: Record<string, number>;
  };
}> {
  const { stats = false } = args;

  // Get backtest results port from context
  const resultsPort = ctx.services.backtestResults();

  // Check if port is available
  const isAvailable = await resultsPort.isAvailable();
  if (!isAvailable) {
    throw new Error('Backtest results storage is not available');
  }

  // List all run summaries via port
  const summaries = await resultsPort.listRunSummaries();

  let registered = 0;
  const skipped = 0; // No skipped runs when using port
  const runsByType: Record<string, number> = {};
  const artifactsByType: Record<string, number> = {};

  // Process each run
  for (const _summary of summaries) {
    registered++;

    // Count by type (would need metadata inspection for full implementation)
    const runType = 'unknown'; // TODO: Extract from metadata if available
    runsByType[runType] = (runsByType[runType] || 0) + 1;

    // Count artifacts (simplified - would need filesystem inspection for full count)
    artifactsByType['summary'] = (artifactsByType['summary'] || 0) + 1;
  }

  const result: {
    registered: number;
    skipped: number;
    stats?: {
      totalRuns: number;
      completedRuns: number;
      failedRuns: number;
      runsByType: Record<string, number>;
      totalArtifacts: number;
      artifactsByType: Record<string, number>;
    };
  } = {
    registered,
    skipped,
  };

  if (stats) {
    const totalArtifacts = Object.values(artifactsByType).reduce((a, b) => a + b, 0);
    const completedRuns = summaries.filter((s) => s.totalTrades > 0).length;
    const failedRuns = summaries.filter((s) => s.totalTrades === 0).length;

    result.stats = {
      totalRuns: summaries.length,
      completedRuns,
      failedRuns,
      runsByType,
      totalArtifacts,
      artifactsByType,
    };
  }

  return result;
}

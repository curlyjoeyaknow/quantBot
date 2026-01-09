/**
 * Catalog Sync Handler
 *
 * Scans completed backtest runs and registers them in the DuckDB catalog.
 * This is the "daemon" operation that makes runs queryable.
 */

import type { CommandContext } from '../../core/command-context.js';
import { DuckDBClient } from '@quantbot/storage';
import { initializeCatalog, catalogAllRuns, getCatalogStats } from '@quantbot/backtest';
import { logger } from '@quantbot/utils';

export interface CatalogSyncArgs {
  baseDir?: string;
  duckdb?: string;
  stats?: boolean;
}

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
  const baseDir = args.baseDir || 'runs';
  const duckdbPath = args.duckdb || 'data/backtest_catalog.duckdb';

  logger.info('Starting catalog sync', { baseDir, duckdbPath });

  // Open catalog database
  const db = new DuckDBClient(duckdbPath);

  try {
    // Initialize catalog schema
    await initializeCatalog(db);

    // Scan and register all completed runs
    const result = await catalogAllRuns(db, baseDir);

    logger.info('Catalog sync complete', {
      registered: result.registered,
      skipped: result.skipped,
    });

    // Get stats if requested
    let stats;
    if (args.stats) {
      stats = await getCatalogStats(db);
      logger.info('Catalog statistics', stats);
    }

    return {
      registered: result.registered,
      skipped: result.skipped,
      stats,
    };
  } finally {
    await db.close();
  }
}


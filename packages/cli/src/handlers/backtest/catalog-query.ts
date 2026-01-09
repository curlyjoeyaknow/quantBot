/**
 * Catalog Query Handler
 *
 * Query the backtest catalog for runs matching criteria.
 */

import type { CommandContext } from '../../core/command-context.js';
import { DuckDBClient } from '@quantbot/storage';
import { queryRuns, getArtifactPath } from '@quantbot/backtest';
import { logger } from '@quantbot/utils';

export interface CatalogQueryArgs {
  duckdb?: string;
  runType?: string;
  status?: string;
  gitBranch?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  runId?: string;
  artifactType?: string;
}

export async function catalogQueryHandler(
  args: CatalogQueryArgs,
  ctx: CommandContext
): Promise<any> {
  const duckdbPath = args.duckdb || 'data/backtest_catalog.duckdb';

  const db = new DuckDBClient(duckdbPath);

  try {
    // If runId and artifactType provided, get artifact path
    if (args.runId && args.artifactType) {
      const path = await getArtifactPath(db, args.runId, args.artifactType as any);
      logger.info('Artifact path', { runId: args.runId, artifactType: args.artifactType, path });
      return { runId: args.runId, artifactType: args.artifactType, path };
    }

    // Otherwise, query runs
    const runs = await queryRuns(db, {
      runType: args.runType,
      status: args.status,
      gitBranch: args.gitBranch,
      fromDate: args.fromDate,
      toDate: args.toDate,
      limit: args.limit,
    });

    logger.info('Query results', { count: runs.length });

    return { runs, count: runs.length };
  } finally {
    await db.close();
  }
}


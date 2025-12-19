/**
 * Handler for ingestion ohlcv command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * Follows the happy path: work planning (offline) → jobs fetch (online).
 * 
 * Flow:
 * 1. Get worklist from @quantbot/ingestion (offline work planning)
 * 2. Execute fetch via @quantbot/jobs (online boundary)
 * 3. Return results
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { ohlcvSchema } from '../../commands/ingestion.js';
import { generateOhlcvWorklist } from '@quantbot/ingestion';

/**
 * Input arguments (already validated by Zod)
 */
export type IngestOhlcvArgs = z.infer<typeof ohlcvSchema>;

/**
 * Handler function: pure use-case orchestration
 * 
 * Follows the happy path:
 * - ingestion.getOhlcvWorklist() → worklist (offline)
 * - jobs.ohlcvFetchJob.fetchWorkList() → execute fetch (online)
 */
export async function ingestOhlcvHandler(args: IngestOhlcvArgs, ctx: CommandContext) {
  // Step 1: Get worklist from ingestion (offline work planning)
  const duckdbPath = args.duckdb || process.env.DUCKDB_PATH;
  if (!duckdbPath) {
    throw new Error('DuckDB path is required. Provide --duckdb or set DUCKDB_PATH environment variable.');
  }

  const worklist = await generateOhlcvWorklist(duckdbPath, {
    from: args.from ? new Date(args.from) : undefined,
    to: args.to ? new Date(args.to) : undefined,
    interval: args.interval,
    preWindowMinutes: args.preWindow,
    postWindowMinutes: args.postWindow,
  });

  if (worklist.length === 0) {
    return {
      tokensProcessed: 0,
      tokensSucceeded: 0,
      tokensFailed: 0,
      tokensSkipped: 0,
      totalCandlesStored: 0,
      workItemsProcessed: [],
    };
  }

  // Step 2: Execute fetch via jobs (online boundary)
  const fetchJob = ctx.services.ohlcvFetchJob();
  const results = await fetchJob.fetchWorkList(worklist);

  // Aggregate results
  const tokensSucceeded = results.filter((r) => r.success).length;
  const tokensFailed = results.filter((r) => !r.success).length;
  const totalCandlesStored = results.reduce((sum, r) => sum + r.candlesStored, 0);

  return {
    tokensProcessed: worklist.length,
    tokensSucceeded,
    tokensFailed,
    tokensSkipped: 0, // Coverage checks handle skipping
    totalCandlesStored,
    workItemsProcessed: results.map((r) => ({
      mint: r.workItem.mint,
      chain: r.workItem.chain,
      interval: r.workItem.interval,
      success: r.success,
      candlesStored: r.candlesStored,
      error: r.error,
    })),
  };
}

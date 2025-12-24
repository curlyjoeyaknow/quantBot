/**
 * CLI Composition Root for OHLCV Ingestion
 *
 * This is where impurity is ALLOWED:
 * - env vars (process.env)
 * - paths (path.resolve, process.cwd())
 * - stdout (console.log)
 * - process exit codes
 * - real adapters
 *
 * The pure handler in @quantbot/core remains untouched.
 */

import path from 'node:path';
import process from 'node:process';
import { ConfigurationError } from '@quantbot/utils';

import { ingestOhlcv, createOhlcvIngestionContext } from '@quantbot/workflows';
import type { IngestOhlcvSpec } from '@quantbot/workflows';
import type { CommandContext } from '../../core/command-context.js';
import { ohlcvSchema } from '../../commands/ingestion.js';
import type { z } from 'zod';

/**
 * Input arguments (already validated by Zod)
 */
export type IngestOhlcvArgs = z.infer<typeof ohlcvSchema>;

/**
 * CLI handler: composition root (env + fs + wiring)
 *
 * This function can:
 * - Read process.env ✅
 * - Touch filesystem ✅
 * - Log to console ✅
 * - Exit the process ✅
 *
 * The pure handler in @quantbot/core remains untouched.
 */
export async function ingestOhlcvHandler(args: IngestOhlcvArgs, _ctx: CommandContext) {
  // ENV + FS LIVE HERE (and ONLY here)
  const duckdbPathRaw = args.duckdb || process.env.DUCKDB_PATH;
  if (!duckdbPathRaw) {
    throw new ConfigurationError(
      'DuckDB path is required. Provide --duckdb or set DUCKDB_PATH environment variable.',
      'duckdbPath',
      { args, env: { DUCKDB_PATH: process.env.DUCKDB_PATH } }
    );
  }
  const duckdbPath = path.resolve(duckdbPathRaw);

  // Map interval to workflow format (workflow only accepts '15s', '1m', '5m', '1H')
  let workflowInterval: '15s' | '1m' | '5m' | '1H' = '5m'; // Default to 5m
  if (args.interval === '1s' || args.interval === '15s') {
    workflowInterval = '15s';
  } else if (args.interval === '1m') {
    workflowInterval = '1m';
  } else if (args.interval === '5m') {
    workflowInterval = '5m';
  } else if (args.interval === '15m') {
    workflowInterval = '5m'; // 15m maps to 5m (workflow doesn't support 15m)
  } else if (args.interval === '1h') {
    workflowInterval = '1H'; // 1h maps to 1H (uppercase H)
  }

  // Build workflow spec (all paths absolute, no env vars)
  const spec: IngestOhlcvSpec = {
    chain: 'solana',
    duckdbPath,
    from: args.from,
    to: args.to,
    interval: workflowInterval,
    preWindowMinutes: args.preWindow,
    postWindowMinutes: args.postWindow,
    side: 'buy', // Default side
    errorMode: 'collect',
    checkCoverage: true,
    rateLimitMs: process.env.BIRDEYE_RATE_LIMIT_MS_PER_WORKER
      ? parseInt(process.env.BIRDEYE_RATE_LIMIT_MS_PER_WORKER, 10)
      : 330,
    maxRetries: 3,
  };

  // Create workflow context with ports
  const workflowCtx = await createOhlcvIngestionContext({ duckdbPath });

  // Call workflow directly (uses ports internally)
  const output = await ingestOhlcv(spec, workflowCtx);

  // Presentation belongs here (composition root)
  if (args.format === 'json') {
    return output;
  }

  // Build summary format
  return buildSummary(output);
}

/**
 * Build summary format for display
 */
function buildSummary(output: Awaited<ReturnType<typeof ingestOhlcv>>): unknown {
  const successRate =
    (output.workItemsProcessed ?? 0) > 0
      ? ((output.workItemsSucceeded ?? 0) / (output.workItemsProcessed ?? 1)) * 100
      : 0;

  return [
    {
      type: 'SUMMARY',
      worklistGenerated: output.worklistGenerated ?? 0,
      workItemsProcessed: output.workItemsProcessed ?? 0,
      workItemsSucceeded: output.workItemsSucceeded ?? 0,
      workItemsFailed: output.workItemsFailed ?? 0,
      workItemsSkipped: output.workItemsSkipped ?? 0,
      successRate: `${successRate.toFixed(1)}%`,
      totalCandlesFetched: output.totalCandlesFetched ?? 0,
      totalCandlesStored: output.totalCandlesStored ?? 0,
      errors: output.errors?.length ?? 0,
      durationMs: output.durationMs ?? 0,
    },
    ...(output.errors && output.errors.length > 0
      ? output.errors.map((err) => ({
          type: 'ERROR',
          mint: err.mint
            ? String(err.mint)
            : 'unknown',
          chain: err.chain ?? 'unknown',
          error: err.error,
        }))
      : []),
  ];
}

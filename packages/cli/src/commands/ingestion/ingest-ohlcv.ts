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

import {
  ingestOhlcvHandler,
  type IngestOhlcvCommand,
} from '@quantbot/core';
import { createOhlcvIngestionWorkflowAdapter } from '@quantbot/workflows';
import { createOhlcvIngestionContext } from '@quantbot/workflows';
import type { ClockPort } from '@quantbot/core';
import { OhlcvFetchJob } from '@quantbot/jobs';
import type { CommandContext } from '../../core/command-context.js';
import { ohlcvSchema } from '../../commands/ingestion.js';
import type { z } from 'zod';

/**
 * Input arguments (already validated by Zod)
 */
export type IngestOhlcvArgs = z.infer<typeof ohlcvSchema>;

/**
 * System clock adapter (composition root - allowed to use Date.now())
 */
const systemClock: ClockPort = {
  nowMs: () => Date.now(),
};

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
    throw new Error(
      'DuckDB path is required. Provide --duckdb or set DUCKDB_PATH environment variable.'
    );
  }
  const duckdbPath = path.resolve(duckdbPathRaw);

  // Build command (all paths absolute, no env vars)
  const cmd: IngestOhlcvCommand = {
    duckdbPath,
    from: args.from,
    to: args.to,
    interval: args.interval,
    preWindowMinutes: args.preWindow,
    postWindowMinutes: args.postWindow,
  };

  // Wire adapters (composition root)
  const parallelWorkers = process.env.BIRDEYE_PARALLEL_WORKERS
    ? parseInt(process.env.BIRDEYE_PARALLEL_WORKERS, 10)
    : 16;
  const rateLimitMsPerWorker = process.env.BIRDEYE_RATE_LIMIT_MS_PER_WORKER
    ? parseInt(process.env.BIRDEYE_RATE_LIMIT_MS_PER_WORKER, 10)
    : 330;

  const workflowCtx = createOhlcvIngestionContext({
    ohlcvFetchJob: new OhlcvFetchJob({
      parallelWorkers,
      rateLimitMsPerWorker,
      maxRetries: 3,
      checkCoverage: true,
    }),
  });

  const ports = {
    ohlcvIngestion: createOhlcvIngestionWorkflowAdapter(workflowCtx),
    clock: systemClock,
  };

  // Call pure handler (no I/O, no env, no time globals)
  const output = await ingestOhlcvHandler(cmd, ports, {
    correlationId: 'cli:ingest-ohlcv',
  });

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
function buildSummary(output: Awaited<ReturnType<typeof ingestOhlcvHandler>>): unknown {
  const result = output.result;
  const summary = result.summary as {
    worklistGenerated?: number;
    workItemsProcessed?: number;
    workItemsSucceeded?: number;
    workItemsFailed?: number;
    workItemsSkipped?: number;
    totalCandlesFetched?: number;
    totalCandlesStored?: number;
    durationMs?: number;
  };

  const successRate =
    (summary.workItemsProcessed ?? 0) > 0
      ? ((summary.workItemsSucceeded ?? 0) / (summary.workItemsProcessed ?? 1)) * 100
      : 0;

  return [
    {
      type: 'SUMMARY',
      worklistGenerated: summary.worklistGenerated ?? 0,
      workItemsProcessed: summary.workItemsProcessed ?? 0,
      workItemsSucceeded: summary.workItemsSucceeded ?? 0,
      workItemsFailed: summary.workItemsFailed ?? 0,
      workItemsSkipped: summary.workItemsSkipped ?? 0,
      successRate: `${successRate.toFixed(1)}%`,
      totalCandlesFetched: summary.totalCandlesFetched ?? 0,
      totalCandlesStored: summary.totalCandlesStored ?? 0,
      errors: result.errors?.length ?? 0,
      durationMs: summary.durationMs ?? 0,
    },
    ...(result.errors && result.errors.length > 0
      ? result.errors.map((error) => ({
          type: 'ERROR',
          mint: error.context?.mint
            ? String(error.context.mint).substring(0, 20) +
              (String(error.context.mint).length > 20 ? '...' : '')
            : 'unknown',
          chain: error.context?.chain ?? 'unknown',
          error: error.message,
        }))
      : []),
  ];
}

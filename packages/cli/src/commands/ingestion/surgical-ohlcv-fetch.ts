/**
 * CLI Composition Root for Surgical OHLCV Fetch
 *
 * This is a "power tool" - it's allowed to:
 * - Read process.env
 * - Use path.resolve()
 * - Log to console
 * - Do I/O
 *
 * This is NOT a pure handler - it's a composition root.
 */

import type { z } from 'zod';
import path from 'node:path';
import process from 'node:process';
import { ConfigurationError, logger } from '@quantbot/infra/utils';
import type { CommandContext } from '../../core/command-context.js';
import { surgicalOhlcvFetchSchema } from '../ingestion.js';
import {
  surgicalOhlcvFetch,
  type SurgicalOhlcvFetchSpec,
  type SurgicalOhlcvFetchContext,
  type ProgressCallback,
} from '@quantbot/workflows';
import { createOhlcvIngestionContext } from '@quantbot/workflows';
import { OhlcvFetchJob } from '@quantbot/data/jobs';
import { DateTime } from 'luxon';
import { createProgressBar } from '../../core/progress-indicator.js';

/**
 * Input arguments (already validated by Zod)
 */
export type SurgicalOhlcvFetchArgs = z.infer<typeof surgicalOhlcvFetchSchema>;

/**
 * CLI composition root for surgical OHLCV fetch
 *
 * This function can:
 * - Read process.env ✅
 * - Use path.resolve() ✅
 * - Log to console ✅
 * - Do I/O ✅
 */
export async function surgicalOhlcvFetchHandler(args: SurgicalOhlcvFetchArgs, ctx: CommandContext) {
  // Always log verbose flag value for debugging
  logger.info('surgicalOhlcvFetchHandler called', {
    service: 'quantbot',
    namespace: 'quantbot',
    verbose: args.verbose,
    verboseType: typeof args.verbose,
    caller: args.caller,
    startMonth: args.startMonth,
    endMonth: args.endMonth,
  });

  // Immediately show verbose status if enabled (before anything else)
  if (args.verbose) {
    process.stderr.write('=== VERBOSE MODE ENABLED ===\n');
    logger.info('Verbose mode enabled in handler', { service: 'quantbot', namespace: 'quantbot' });
  }

  // ENV + FS LIVE HERE (composition root)
  const duckdbPathRaw = args.duckdb || process.env.DUCKDB_PATH;
  if (!duckdbPathRaw) {
    throw new ConfigurationError(
      'DuckDB path is required. Provide --duckdb or set DUCKDB_PATH environment variable.',
      'duckdb',
      { envVar: 'DUCKDB_PATH' }
    );
  }
  // Convert relative paths to absolute paths (Python scripts run from different working directories)
  const duckdbPath = path.resolve(duckdbPathRaw);

  const spec: SurgicalOhlcvFetchSpec = {
    duckdbPath,
    interval: args.interval,
    caller: args.caller,
    month: args.month,
    startMonth: args.startMonth,
    endMonth: args.endMonth,
    auto: args.auto,
    limit: args.limit,
    minCoverage: args.minCoverage,
    dryRun: args.dryRun,
    verbose: args.verbose,
    errorMode: 'collect', // Collect errors, don't fail fast
  };

  // Create workflow context
  const pythonEngine = ctx.services.pythonEngine();

  // Create OhlcvFetchJob service instance (handles both fetch AND store in parallel)
  // Use parallel workers if configured (default: 16 workers with 330ms delay = ~48.5 RPS)
  const parallelWorkers = process.env.BIRDEYE_PARALLEL_WORKERS
    ? parseInt(process.env.BIRDEYE_PARALLEL_WORKERS, 10)
    : 16; // Default to 16 workers for better throughput
  const rateLimitMsPerWorker = process.env.BIRDEYE_RATE_LIMIT_MS_PER_WORKER
    ? parseInt(process.env.BIRDEYE_RATE_LIMIT_MS_PER_WORKER, 10)
    : 330; // 330ms per worker = ~48.5 RPS with 16 workers (under 50 RPS limit)

  if (args.verbose || parallelWorkers > 1) {
    logger.info('Birdeye fetch and store configuration', {
      parallelWorkers,
      rateLimitMsPerWorker,
      estimatedRPS: ((1000 / rateLimitMsPerWorker) * parallelWorkers).toFixed(2),
      note: 'OhlcvFetchJob handles both fetch AND store in parallel',
    });
  }

  const ohlcvFetchJob = new OhlcvFetchJob({
    parallelWorkers,
    rateLimitMsPerWorker,
    maxRetries: 3,
    checkCoverage: true,
    minCoverageToSkip: args.minCoverage ?? 0.95,
  });

  // Create OHLCV ingestion context
  const ohlcvIngestionContext = await createOhlcvIngestionContext({
    duckdbPath: spec.duckdbPath,
  });

  // Create progress callback if verbose mode is enabled
  const progressCallback: ProgressCallback | undefined = spec.verbose
    ? (stage: string, progress?: { current: number; total: number; message?: string }) => {
        if (progress) {
          const bar = createProgressBar(progress.current, progress.total, 40);
          const message = progress.message || stage;
          // Write to stderr so it doesn't interfere with JSON output
          process.stderr.write(`\r${message} ${bar}`);
          if (progress.current >= progress.total) {
            process.stderr.write('\n');
          }
        } else {
          // For non-progress stages, log immediately
          console.error(`[${stage}]`);
        }
      }
    : undefined;

  // Show initial verbose message
  if (spec.verbose) {
    console.error('Verbose mode enabled - showing detailed progress');
    console.error(
      `Analyzing coverage for caller: ${spec.caller || 'all'}, months: ${spec.startMonth || 'all'} to ${spec.endMonth || 'all'}`
    );
  }

  const workflowContext: SurgicalOhlcvFetchContext = {
    pythonEngine,
    ohlcvIngestionContext,
    logger: {
      info: (message: string, meta?: Record<string, unknown>) => {
        logger.info(message, { service: 'quantbot', namespace: 'quantbot', ...meta });
      },
      warn: (message: string, meta?: Record<string, unknown>) => {
        logger.warn(message, { service: 'quantbot', namespace: 'quantbot', ...meta });
      },
      error: (message: string, meta?: Record<string, unknown>) => {
        logger.error(message, { service: 'quantbot', namespace: 'quantbot', ...meta });
      },
      debug: (message: string, meta?: Record<string, unknown>) => {
        logger.debug(message, { service: 'quantbot', namespace: 'quantbot', ...meta });
      },
    },
    clock: {
      now: () => DateTime.utc(),
    },
    onProgress: progressCallback,
  };

  // Call workflow (orchestration happens here)
  const result = await surgicalOhlcvFetch(spec, workflowContext);

  // Transform result into cleaner summary format (unless format is JSON)
  if (args.format === 'json') {
    // Return full result for JSON format
    return result;
  }

  // Build summary format
  return buildSummary(result);
}

/**
 * Build a cleaner summary format from surgical fetch result
 */
function buildSummary(result: Awaited<ReturnType<typeof surgicalOhlcvFetch>>): unknown {
  // Track intervals processed
  const intervalsProcessed = new Set<string>();
  const successfulMints = new Set<string>();

  for (const task of result.taskResults) {
    // Track which intervals were processed
    task.intervals.forEach((interval: string) => intervalsProcessed.add(interval));

    // Track successful mints
    if (task.success && task.missingMints) {
      task.missingMints.forEach((mint: string) => successfulMints.add(mint));
    }
  }

  // Build task summaries (one per task)
  const taskSummaries = result.taskResults.map(
    (task: {
      caller?: string;
      month?: string;
      success: boolean;
      error?: string;
      missingMints?: string[];
      candlesFetched?: number;
      candlesStored?: number;
      intervals: string[];
      durationMs?: number;
    }) => ({
      caller: task.caller,
      month: task.month,
      status: task.success ? 'success' : task.error ? 'failed' : 'pending',
      mintsRequested: task.missingMints?.length || 0,
      mintsFetched: task.success ? task.missingMints?.length || 0 : 0,
      candlesFetched: task.candlesFetched,
      candlesStored: task.candlesStored,
      intervals: task.intervals.join(', ') || 'none',
      error: task.error || undefined,
      durationMs: task.durationMs,
    })
  );

  // Calculate coverage stats
  const totalMintsRequested = result.taskResults.reduce(
    (sum: number, task: { missingMints?: string[] }) => sum + (task.missingMints?.length || 0),
    0
  );
  const totalMintsFetched = successfulMints.size;
  const mintsCoverage = totalMintsRequested > 0 ? totalMintsFetched / totalMintsRequested : 0;

  // Return array format for better table display
  // First element: overall summary
  // Subsequent elements: individual task summaries
  const output = [
    {
      type: 'SUMMARY',
      tasksAnalyzed: result.tasksAnalyzed,
      tasksExecuted: result.tasksExecuted,
      tasksSucceeded: result.tasksSucceeded,
      tasksFailed: result.tasksFailed,
      durationMs: result.durationMs,
      intervalsProcessed: Array.from(intervalsProcessed).sort().join(', '),
      totalCandlesFetched: result.totalCandlesFetched,
      totalCandlesStored: result.totalCandlesStored,
      mintsRequested: totalMintsRequested,
      mintsFetched: totalMintsFetched,
      mintsCoverage: `${(mintsCoverage * 100).toFixed(1)}%`,
      clickhouseUniqueTokens: totalMintsFetched,
      clickhouseCandlesStored: result.totalCandlesStored,
      clickhouseCallsCoverage: `${(mintsCoverage * 100).toFixed(1)}%`,
    },
    ...taskSummaries.map(
      (task: {
        type?: string;
        caller?: string;
        month?: string;
        status: string;
        mintsRequested: number;
        mintsFetched: number;
        candlesFetched?: number;
        candlesStored?: number;
        intervals: string;
        error?: string;
        durationMs?: number;
      }) => ({
        type: 'TASK',
        ...task,
      })
    ),
  ];

  return output;
}

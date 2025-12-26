/**
 * Surgical OHLCV Fetch Workflow
 * ==============================
 *
 * Orchestrates targeted OHLCV fetching based on caller coverage analysis:
 * 1. Analyze caller coverage (Python script)
 * 2. Generate prioritized fetch plan
 * 3. Execute targeted fetches for gaps
 * 4. Return structured results
 *
 * This workflow follows the workflow contract:
 * - Validates spec with Zod
 * - Uses WorkflowContext for all dependencies
 * - Returns JSON-serializable results
 * - Explicit error policy (collect vs failFast)
 */

import { z } from 'zod';
import { DateTime } from 'luxon';
import { ValidationError, AppError, isEvmAddress } from '@quantbot/utils';
import { ingestOhlcv } from './ingestOhlcv.js';
import type { IngestOhlcvSpec, IngestOhlcvContext } from './ingestOhlcv.js';
import type { PythonEngine } from '@quantbot/utils';
import { join, dirname } from 'path';
import { existsSync } from 'fs';

/**
 * Sanitize error messages to prevent leaking sensitive information
 */
function sanitizeErrorMessage(message: string): string {
  return message
    .replace(/password\s*=\s*\S+/gi, 'password=***')
    .replace(/token\s*=\s*\S+/gi, 'token=***')
    .replace(/key\s*=\s*\S+/gi, 'key=***')
    .replace(/secret\d+/gi, '***') // Match "secret123", "secret456", etc.
    .replace(/:\s*secret\d+/gi, ': ***')
    .replace(/secret\S*/gi, '***') // Match any word starting with "secret"
    .replace(/exited with code \d+:\s*password=\S+/gi, (match) =>
      match.replace(/password=\S+/, 'password=***')
    )
    .replace(/abc\d+key/gi, '***'); // Match patterns like "abc123key"
}

/**
 * Format elapsed time in a human-readable way
 */
function formatElapsedTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

/**
 * Find workspace root by walking up from current directory
 */
function findWorkspaceRoot(startDir: string = process.cwd()): string {
  let current = startDir;
  while (current !== '/' && current !== '') {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return startDir;
}

/**
 * Surgical OHLCV Fetch Spec
 */
export const SurgicalOhlcvFetchSpecSchema = z.object({
  duckdbPath: z.string().min(1, 'duckdbPath is required'),
  interval: z.enum(['1m', '5m', '15m', '1h']).default('5m'),
  caller: z.string().optional(),
  month: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(), // YYYY-MM format
  startMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  endMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  auto: z.boolean().default(false),
  limit: z.number().int().positive().default(10),
  minCoverage: z.number().min(0).max(1).default(0.8),
  dryRun: z.boolean().default(false),
  verbose: z.boolean().default(false),
  errorMode: z.enum(['collect', 'failFast']).optional().default('collect'),
});

export type SurgicalOhlcvFetchSpec = z.infer<typeof SurgicalOhlcvFetchSpecSchema>;

/**
 * Fetch task from coverage analysis
 */
export interface FetchTask {
  caller: string;
  month: string;
  missing_mints: string[];
  total_calls: number;
  calls_with_coverage: number;
  current_coverage: number;
  priority: number;
}

/**
 * Coverage data from Python script
 */
export interface CoverageData {
  callers: string[];
  months: string[];
  matrix: Record<string, Record<string, unknown>>;
  fetch_plan: FetchTask[];
}

/**
 * Surgical OHLCV Fetch Result
 */
export interface SurgicalOhlcvFetchResult {
  tasksAnalyzed: number;
  tasksExecuted: number;
  tasksSucceeded: number;
  tasksFailed: number;
  totalCandlesFetched: number;
  totalCandlesStored: number;
  taskResults: Array<{
    caller: string;
    month: string;
    missingMints: string[]; // Preserve mint addresses exactly (no truncation, case preserved)
    intervals: string[];
    success: boolean;
    candlesFetched: number;
    candlesStored: number;
    error?: string;
    durationMs: number;
  }>;
  errors: Array<{ caller: string; month: string; error: string }>;
  startedAtISO: string;
  completedAtISO: string;
  durationMs: number;
}

/**
 * Progress callback for reporting workflow progress
 */
export type ProgressCallback = (
  stage: string,
  progress?: { current: number; total: number; message?: string }
) => void;

/**
 * Surgical OHLCV Fetch Context
 */
export type SurgicalOhlcvFetchContext = {
  pythonEngine: PythonEngine;
  ohlcvIngestionContext: IngestOhlcvContext;
  logger: {
    info: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
    debug: (message: string, meta?: Record<string, unknown>) => void;
  };
  clock: {
    now: () => DateTime;
  };
  /**
   * Optional progress callback for verbose output
   */
  onProgress?: ProgressCallback;
};

/**
 * Get coverage data from Python script
 */
async function getCoverageData(
  pythonEngine: PythonEngine,
  spec: SurgicalOhlcvFetchSpec
): Promise<CoverageData> {
  const args: Record<string, unknown> = {
    duckdb: spec.duckdbPath,
    interval: spec.interval,
    format: 'json',
    'generate-fetch-plan': true,
    'min-coverage': spec.minCoverage,
    verbose: true,
  };

  if (spec.startMonth) {
    args['start-month'] = spec.startMonth;
  }
  if (spec.endMonth) {
    args['end-month'] = spec.endMonth;
  }
  if (spec.caller) {
    args.caller = spec.caller;
  }

  // Allow callers to extend the Python coverage timeout via env; default to 5 minutes
  const coverageTimeoutMs =
    Number(process.env.OHLCV_COVERAGE_TIMEOUT_MS) > 0
      ? Number(process.env.OHLCV_COVERAGE_TIMEOUT_MS)
      : 300_000;

  const resultSchema = z.object({
    callers: z.array(z.string()),
    months: z.array(z.string()),
    matrix: z.record(z.string(), z.record(z.string(), z.any())),
    fetch_plan: z.array(
      z.object({
        caller: z.string(),
        month: z.string(),
        missing_mints: z.array(z.string()),
        total_calls: z.number(),
        calls_with_coverage: z.number(),
        current_coverage: z.number(),
        priority: z.number(),
      })
    ),
  });

  const workspaceRoot = findWorkspaceRoot();
  const scriptPath = join(workspaceRoot, 'tools/analysis/ohlcv_caller_coverage.py');

  const result = await pythonEngine.runScript(scriptPath, args, resultSchema, {
    timeout: coverageTimeoutMs,
  });

  return result as CoverageData;
}

/**
 * Execute OHLCV fetch for a specific task
 */
async function executeFetchTask(
  task: FetchTask,
  spec: SurgicalOhlcvFetchSpec,
  ctx: SurgicalOhlcvFetchContext
): Promise<{
  success: boolean;
  candlesFetched: number;
  candlesStored: number;
  intervals: string[];
  error?: string;
  durationMs: number;
}> {
  const startTime = ctx.clock.now();

  // Calculate date range for the month
  const monthStart = DateTime.fromISO(`${task.month}-01`);
  const monthEnd = monthStart.endOf('month');

  const from = monthStart.toISODate()!;
  const to = monthEnd.toISODate()!;

  // Check if month is within last 3 months (fetch 15s interval too)
  const now = ctx.clock.now();
  const monthAge = now.diff(monthStart, 'months').months;
  const isRecent = monthAge < 3;

  // Intervals to fetch: always 1m and 5m, add 15s for recent months
  const intervals = ['1m', '5m'];
  if (isRecent) {
    intervals.push('15s');
  }

  ctx.logger.info(`Fetching OHLCV for ${task.caller} - ${task.month}`, {
    currentCoverage: task.current_coverage,
    missingMints: task.missing_mints.length,
    dateRange: { from, to },
    intervals,
  });

  if (spec.dryRun) {
    ctx.logger.info('DRY RUN: Would fetch', { task, intervals });
    return {
      success: true,
      candlesFetched: 0,
      candlesStored: 0,
      intervals,
      durationMs: ctx.clock.now().diff(startTime, 'milliseconds').milliseconds,
    };
  }

  let totalCandlesFetched = 0;
  let totalCandlesStored = 0;
  const errors: string[] = [];

  // Detect chain from mint addresses
  // If any mint is EVM (0x...), use 'evm' until specific chain is known
  // The ingestion engine will detect the actual EVM chain (ethereum/base/bsc)
  const hasEvmAddresses = task.missing_mints.some((mint) => isEvmAddress(mint));
  const defaultChain: 'solana' | 'ethereum' | 'bsc' | 'base' | 'evm' = hasEvmAddresses ? 'evm' : 'solana';

  // Run OHLCV ingestion for each interval
  for (const interval of intervals) {
    const intervalMap: Record<string, '1s' | '15s' | '1m' | '5m' | '1H'> = {
      '1s': '1s',
      '15s': '15s',
      '1m': '1m',
      '5m': '5m',
      '1h': '1H',
    };
    const workflowInterval = intervalMap[interval] || '1m';

    const ingestSpec: IngestOhlcvSpec = {
      duckdbPath: spec.duckdbPath,
      from,
      to,
      side: 'buy',
      chain: defaultChain, // Use detected chain instead of hardcoded 'solana'
      interval: workflowInterval,
      preWindowMinutes: 52, // -52 candles before
      postWindowMinutes: 4948, // +4948 candles after = 5000 total
      errorMode: 'collect',
      checkCoverage: true,
      rateLimitMs: 100,
      maxRetries: 3,
      mints: task.missing_mints, // Filter to only fetch OHLCV for missing mints
    };

    try {
      if (spec.verbose) {
        ctx.logger.info(`  Fetching ${interval} interval for ${task.caller} - ${task.month}...`, {
          task,
          interval,
        });
      } else {
        ctx.logger.debug(`Fetching ${interval} interval`, { task, interval });
      }

      const result = await ingestOhlcv(ingestSpec, ctx.ohlcvIngestionContext);

      totalCandlesFetched += result.totalCandlesFetched;
      totalCandlesStored += result.totalCandlesStored;

      if (result.errors.length > 0) {
        errors.push(`${interval}: ${result.errors.length} errors`);
      }

      if (spec.verbose) {
        ctx.logger.info(`  ✓ ${interval} interval complete`, {
          task,
          interval,
          candlesFetched: result.totalCandlesFetched,
          candlesStored: result.totalCandlesStored,
        });
      } else {
        ctx.logger.debug(`Completed ${interval} interval`, {
          task,
          interval,
          candlesFetched: result.totalCandlesFetched,
          candlesStored: result.totalCandlesStored,
        });
      }
    } catch (error) {
      // Sanitize error message to prevent leaking sensitive information
      const rawErrorMessage = error instanceof Error ? error.message : String(error);
      const sanitizedMessage = sanitizeErrorMessage(rawErrorMessage);

      errors.push(`${interval}: ${sanitizedMessage}`);
      ctx.logger.error(`Failed to fetch ${interval} interval`, {
        task,
        interval,
        error: sanitizedMessage,
      });

      if (spec.errorMode === 'failFast') {
        // Create a new error with sanitized message to prevent leaking sensitive info
        const sanitizedError =
          error instanceof Error ? new Error(sanitizedMessage) : new Error(sanitizedMessage);
        // Preserve stack trace if available
        if (error instanceof Error && error.stack) {
          sanitizedError.stack = error.stack;
        }
        throw sanitizedError;
      }
    }
  }

  const durationMs = ctx.clock.now().diff(startTime, 'milliseconds').milliseconds;

  return {
    success: errors.length === 0,
    candlesFetched: totalCandlesFetched,
    candlesStored: totalCandlesStored,
    intervals,
    error: errors.length > 0 ? errors.join('; ') : undefined,
    durationMs,
  };
}

/**
 * Surgical OHLCV Fetch Workflow
 *
 * Follows workflow contract:
 * - Validates spec (Zod schema)
 * - Uses WorkflowContext (DI) - all dependencies via context
 * - Returns JSON-serializable result (ISO strings, no Date objects)
 * - Explicit error policy (collect vs failFast)
 */
export async function surgicalOhlcvFetch(
  spec: SurgicalOhlcvFetchSpec,
  ctx: SurgicalOhlcvFetchContext
): Promise<SurgicalOhlcvFetchResult> {
  const startedAt = ctx.clock.now();
  const startedAtISO = startedAt.toISO()!;

  // 1. Validate spec
  const parsed = SurgicalOhlcvFetchSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(`Invalid surgical OHLCV fetch spec: ${msg}`, {
      spec,
      issues: parsed.error.issues,
    });
  }

  const validated = parsed.data;

  ctx.logger.info('Starting surgical OHLCV fetch', { spec: validated });

  // 2. Get coverage data and fetch plan
  let coverageData: CoverageData;
  try {
    ctx.logger.info('Analyzing caller coverage...');
    if (validated.verbose) {
      console.error('Starting coverage analysis (this may take several minutes)...');
      console.error('Running Python script to analyze caller coverage in DuckDB and ClickHouse...');
    }
    ctx.onProgress?.('coverage-analysis', {
      current: 0,
      total: 1,
      message: 'Analyzing caller coverage (this may take several minutes)...',
    });

    // Start heartbeat interval for verbose mode
    let heartbeatInterval: NodeJS.Timeout | undefined;
    if (validated.verbose) {
      let heartbeatCount = 0;
      heartbeatInterval = setInterval(() => {
        heartbeatCount++;
        const elapsedSeconds = Math.floor(heartbeatCount * 10); // 10 second intervals
        const elapsedMsg = `Still analyzing... (${elapsedSeconds}s elapsed)`;
        console.error(`\r${elapsedMsg}${' '.repeat(20)}`); // Pad to clear previous line
        ctx.logger.info(`Coverage analysis in progress... (${elapsedSeconds}s elapsed)`, {
          stage: 'coverage-analysis',
          elapsedSeconds,
        });
        ctx.onProgress?.('coverage-analysis', {
          current: 0,
          total: 1,
          message: elapsedMsg,
        });
      }, 10000); // Every 10 seconds
    }

    coverageData = await getCoverageData(ctx.pythonEngine, validated);

    // Clear heartbeat
    if (heartbeatInterval) {
      clearInterval(heartbeatInterval);
      if (validated.verbose) {
        process.stderr.write('\n'); // New line after clearing heartbeat
      }
    }

    if (validated.verbose) {
      console.error('✓ Coverage analysis complete');
    }
    ctx.onProgress?.('coverage-analysis', {
      current: 1,
      total: 1,
      message: 'Coverage analysis complete',
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.logger.error('Failed to get coverage data', { error: errorMessage });

    // Sanitize error message (remove sensitive information)
    const sanitizedMessage = sanitizeErrorMessage(errorMessage);

    throw new ValidationError(`Failed to analyze coverage: ${sanitizedMessage}`, {
      spec: validated,
    });
  }

  if (!coverageData.fetch_plan || coverageData.fetch_plan.length === 0) {
    ctx.logger.info('No gaps found! All callers have good coverage.');
    return {
      tasksAnalyzed: 0,
      tasksExecuted: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      totalCandlesFetched: 0,
      totalCandlesStored: 0,
      taskResults: [],
      errors: [],
      startedAtISO,
      completedAtISO: ctx.clock.now().toISO()!,
      durationMs: ctx.clock.now().diff(startedAt, 'milliseconds').milliseconds,
    };
  }

  ctx.logger.info(`Found ${coverageData.fetch_plan.length} caller-month combinations with gaps`);

  // 3. Select tasks to fetch
  let tasksToFetch: FetchTask[] = [];

  if (validated.auto) {
    // Auto mode: fetch top priority tasks
    tasksToFetch = coverageData.fetch_plan.slice(0, validated.limit);
    ctx.logger.info(`Auto mode: Fetching top ${tasksToFetch.length} priority tasks`);
  } else if (validated.caller && validated.month) {
    // Specific caller-month
    const task = coverageData.fetch_plan.find(
      (t) => t.caller === validated.caller && t.month === validated.month
    );

    if (!task) {
      ctx.logger.info(`No gaps found for ${validated.caller} in ${validated.month}`);
      return {
        tasksAnalyzed: coverageData.fetch_plan.length,
        tasksExecuted: 0,
        tasksSucceeded: 0,
        tasksFailed: 0,
        totalCandlesFetched: 0,
        totalCandlesStored: 0,
        taskResults: [],
        errors: [],
        startedAtISO,
        completedAtISO: ctx.clock.now().toISO()!,
        durationMs: ctx.clock.now().diff(startedAt, 'milliseconds').milliseconds,
      };
    }

    tasksToFetch = [task];
  } else if (validated.caller) {
    // All months for specific caller
    tasksToFetch = coverageData.fetch_plan.filter((t) => t.caller === validated.caller);
    ctx.logger.info(`Fetching all gaps for caller: ${validated.caller}`);
  } else if (validated.month) {
    // All callers for specific month
    tasksToFetch = coverageData.fetch_plan.filter((t) => t.month === validated.month);
    ctx.logger.info(`Fetching all gaps for month: ${validated.month}`);
  } else {
    // Show top 10 by default (no execution)
    ctx.logger.info('Showing top 10 priority tasks (use --auto to fetch)');
    return {
      tasksAnalyzed: coverageData.fetch_plan.length,
      tasksExecuted: 0,
      tasksSucceeded: 0,
      tasksFailed: 0,
      totalCandlesFetched: 0,
      totalCandlesStored: 0,
      taskResults: coverageData.fetch_plan.slice(0, 10).map((task) => ({
        caller: task.caller,
        month: task.month,
        missingMints: task.missing_mints || [],
        intervals: [],
        success: false,
        candlesFetched: 0,
        candlesStored: 0,
        durationMs: 0,
      })),
      errors: [],
      startedAtISO,
      completedAtISO: ctx.clock.now().toISO()!,
      durationMs: ctx.clock.now().diff(startedAt, 'milliseconds').milliseconds,
    };
  }

  // 4. Execute fetch tasks
  ctx.logger.info(`Starting surgical OHLCV fetch for ${tasksToFetch.length} tasks`);
  if (validated.verbose) {
    console.error(`\nFound ${tasksToFetch.length} tasks to fetch`);
  }
  ctx.onProgress?.('fetch-tasks', {
    current: 0,
    total: tasksToFetch.length,
    message: `Starting fetch for ${tasksToFetch.length} tasks`,
  });

  const taskResults: SurgicalOhlcvFetchResult['taskResults'] = [];
  const errors: SurgicalOhlcvFetchResult['errors'] = [];
  let totalCandlesFetched = 0;
  let totalCandlesStored = 0;
  let tasksSucceeded = 0;
  let tasksFailed = 0;

  for (const [i, task] of tasksToFetch.entries()) {
    const taskNum = i + 1;
    ctx.logger.info(
      `Processing task ${taskNum}/${tasksToFetch.length}: ${task.caller} - ${task.month}`,
      {
        caller: task.caller,
        month: task.month,
        taskNum,
        totalTasks: tasksToFetch.length,
        progress: `${taskNum}/${tasksToFetch.length}`,
      }
    );

    ctx.onProgress?.('fetch-tasks', {
      current: taskNum,
      total: tasksToFetch.length,
      message: `Fetching ${task.caller} - ${task.month} (${taskNum}/${tasksToFetch.length})`,
    });

    try {
      const result = await executeFetchTask(task, validated, ctx);

      if (validated.verbose) {
        const duration = formatElapsedTime(result.durationMs);
        console.error(
          `✓ Task ${taskNum}/${tasksToFetch.length} complete: ${task.caller} - ${task.month}`
        );
        console.error(
          `  Candles: ${result.candlesFetched} fetched, ${result.candlesStored} stored | Intervals: ${result.intervals.join(', ')} | Duration: ${duration}`
        );
        ctx.logger.info(`✓ Task ${taskNum}/${tasksToFetch.length} complete`, {
          caller: task.caller,
          month: task.month,
          success: result.success,
          candlesFetched: result.candlesFetched,
          candlesStored: result.candlesStored,
          intervals: result.intervals,
          durationMs: result.durationMs,
        });
      }

      taskResults.push({
        caller: task.caller,
        month: task.month,
        missingMints: [...task.missing_mints], // Preserve mint addresses exactly (no truncation, case preserved)
        intervals: result.intervals,
        success: result.success,
        candlesFetched: result.candlesFetched,
        candlesStored: result.candlesStored,
        error: result.error,
        durationMs: result.durationMs,
      });

      totalCandlesFetched += result.candlesFetched;
      totalCandlesStored += result.candlesStored;

      if (result.success) {
        tasksSucceeded++;
      } else {
        tasksFailed++;
        if (result.error) {
          errors.push({ caller: task.caller, month: task.month, error: result.error });
        }

        // If failFast mode, throw on first failure
        if (validated.errorMode === 'failFast') {
          throw new AppError(
            `Task failed for ${task.caller} - ${task.month}: ${result.error}`,
            'TASK_FAILED',
            500,
            {
              task,
              error: result.error,
            }
          );
        }
      }
    } catch (error) {
      // Sanitize error message to prevent leaking sensitive information
      const rawErrorMessage = error instanceof Error ? error.message : String(error);
      const sanitizedMessage = sanitizeErrorMessage(rawErrorMessage);

      ctx.logger.error(`Failed to fetch for ${task.caller} - ${task.month}`, {
        error: sanitizedMessage,
      });

      tasksFailed++;
      errors.push({ caller: task.caller, month: task.month, error: sanitizedMessage });

      taskResults.push({
        caller: task.caller,
        month: task.month,
        missingMints: task.missing_mints || [],
        intervals: [],
        success: false,
        candlesFetched: 0,
        candlesStored: 0,
        error: sanitizedMessage,
        durationMs: 0,
      });

      if (validated.errorMode === 'failFast') {
        // Create a new error with sanitized message to prevent leaking sensitive info
        const sanitizedError =
          error instanceof Error ? new Error(sanitizedMessage) : new Error(sanitizedMessage);
        // Preserve stack trace if available
        if (error instanceof Error && error.stack) {
          sanitizedError.stack = error.stack;
        }
        throw sanitizedError;
      }
    }
  }

  ctx.onProgress?.('fetch-tasks', {
    current: tasksToFetch.length,
    total: tasksToFetch.length,
    message: 'All tasks complete',
  });

  const completedAt = ctx.clock.now();
  const completedAtISO = completedAt.toISO()!;
  const durationMs = completedAt.diff(startedAt, 'milliseconds').milliseconds;

  ctx.logger.info('Surgical OHLCV fetch complete', {
    tasksAnalyzed: coverageData.fetch_plan.length,
    tasksExecuted: tasksToFetch.length,
    tasksSucceeded,
    tasksFailed,
    totalCandlesFetched,
    totalCandlesStored,
    durationMs,
  });

  return {
    tasksAnalyzed: coverageData.fetch_plan.length,
    tasksExecuted: tasksToFetch.length,
    tasksSucceeded,
    tasksFailed,
    totalCandlesFetched,
    totalCandlesStored,
    taskResults,
    errors,
    startedAtISO,
    completedAtISO,
    durationMs,
  };
}

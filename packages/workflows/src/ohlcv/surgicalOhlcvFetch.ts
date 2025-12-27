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
/**
 * Retry failed mints across all chains and add to exclusions if all fail
 */
async function retryFailedMintsAcrossAllChains(
  failedMintsForInterval: Map<string, Set<string>>,
  interval: string,
  from: string,
  to: string,
  spec: SurgicalOhlcvFetchSpec,
  ctx: SurgicalOhlcvFetchContext
): Promise<{
  succeeded: string[];
  excluded: Array<{ tokenAddress: string; chain: string; reason: string }>;
}> {
  const succeeded: string[] = [];
  const excluded: Array<{ tokenAddress: string; chain: string; reason: string }> = [];
  const allChains: Array<'solana' | 'ethereum' | 'bsc' | 'base'> = [
    'solana',
    'ethereum',
    'bsc',
    'base',
  ];

  const intervalMap: Record<string, '1s' | '15s' | '1m' | '5m' | '1H'> = {
    '1s': '1s',
    '15s': '15s',
    '1m': '1m',
    '5m': '5m',
    '1h': '1H',
  };
  const workflowInterval = intervalMap[interval] || '1m';

  // Only retry 5m and 1m intervals for exclusion
  const shouldExcludeOnAllFailure = interval === '5m' || interval === '1m';

  ctx.logger.debug(`Starting retry for ${failedMintsForInterval.size} mints on ${interval}`, {
    interval,
    shouldExcludeOnAllFailure,
    totalMints: failedMintsForInterval.size,
  });

  // Try each mint across all chains
  for (const [mint, failedChains] of failedMintsForInterval.entries()) {
    ctx.logger.debug(`Retrying mint ${mint} for ${interval}`, {
      mint,
      interval,
      previouslyFailedChains: Array.from(failedChains),
      willTryAllChains: true,
    });
    let foundChain = false;
    const triedChains: string[] = [];

    // Try all chains that haven't been tried yet
    for (const chain of allChains) {
      if (failedChains.has(chain)) {
        triedChains.push(chain);
        continue; // Already tried this chain
      }

      triedChains.push(chain);

      try {
        const ingestSpec: IngestOhlcvSpec = {
          duckdbPath: spec.duckdbPath,
          from,
          to,
          side: 'buy',
          chain,
          interval: workflowInterval,
          preWindowMinutes: 52,
          postWindowMinutes: 4948,
          errorMode: 'collect',
          checkCoverage: false,
          rateLimitMs: 100,
          maxRetries: 3,
          mints: [mint], // Try single mint
        };

        ctx.logger.debug(`Retrying ${mint} on ${chain} for ${interval}`, {
          mint,
          chain,
          interval,
        });

        const result = await ingestOhlcv(ingestSpec, ctx.ohlcvIngestionContext);

        if (result.totalCandlesFetched > 0) {
          succeeded.push(mint);
          foundChain = true;
          ctx.logger.info(`Retry succeeded: ${mint} on ${chain} for ${interval}`, {
            mint,
            chain,
            interval,
            candlesFetched: result.totalCandlesFetched,
          });
          break; // Found the right chain
        }
      } catch (error) {
        ctx.logger.debug(`Retry failed: ${mint} on ${chain} for ${interval}`, {
          mint,
          chain,
          interval,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // If all chains failed and this is 5m/1m, add to exclusions
    if (!foundChain && shouldExcludeOnAllFailure) {
      ctx.logger.info(`All chains failed for ${mint} on ${interval} - adding to exclusions`, {
        mint,
        interval,
        triedChains,
        shouldExclude: true,
      });

      // Add exclusion for each chain that was tried
      const { DuckDBStorageService } = await import('@quantbot/simulation');
      const storageService = new DuckDBStorageService(ctx.pythonEngine);

      for (const chain of triedChains) {
        try {
          ctx.logger.debug(`Adding exclusion: ${mint} on ${chain} for ${interval}`, {
            mint,
            chain,
            interval,
          });

          const exclusionResult = await storageService.addOhlcvExclusion(
            spec.duckdbPath,
            mint,
            chain,
            interval,
            `Failed to fetch OHLCV on all chains (solana, ethereum, bsc, base) for ${interval} interval`
          );

          if (exclusionResult.success) {
            excluded.push({
              tokenAddress: mint,
              chain,
              reason: `Failed on all chains for ${interval}`,
            });
            ctx.logger.debug(`Successfully added exclusion: ${mint} on ${chain} for ${interval}`);
          } else {
            ctx.logger.warn(`Failed to add exclusion: ${mint} on ${chain} for ${interval}`, {
              error: exclusionResult.error,
            });
          }
        } catch (error) {
          ctx.logger.error(`Exception adding exclusion for ${mint}`, {
            mint,
            chain,
            interval,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      ctx.logger.info(`Added ${excluded.length} exclusion entries for ${mint} on ${interval}`, {
        mint,
        interval,
        excludedCount: excluded.length,
        triedChains,
      });
    } else if (!foundChain) {
      ctx.logger.debug(
        `All chains failed for ${mint} on ${interval}, but skipping exclusion (only exclude 5m/1m)`,
        {
          mint,
          interval,
          shouldExcludeOnAllFailure,
        }
      );
    }
  }

  return { succeeded, excluded };
}

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

  // Get actual chains for mints from multiple sources:
  // 1. DuckDB worklist (has chain from call data)
  // 2. ClickHouse token_metadata (has chain from previous fetches)
  // 3. Fallback to trying all EVM chains for unknown EVM addresses
  const { getDuckDBWorklistService, getClickHouseClient } = await import('@quantbot/storage');

  // First, try DuckDB worklist
  const worklistService = getDuckDBWorklistService();
  const worklist = await worklistService.queryWorklist({
    duckdbPath: spec.duckdbPath,
    from,
    to,
    side: 'buy',
  });

  // Build mint -> chain map from worklist
  const mintChainMap = new Map<string, string>();
  for (const group of worklist.tokenGroups) {
    if (group.mint && task.missing_mints.includes(group.mint)) {
      // Use chain from worklist, or default based on address format
      const chain = group.chain || (isEvmAddress(group.mint) ? 'evm' : 'solana');
      mintChainMap.set(group.mint, chain);
    }
  }

  // For mints not found in worklist, query ClickHouse token_metadata
  const missingMints = task.missing_mints.filter((mint) => !mintChainMap.has(mint));
  if (missingMints.length > 0) {
    ctx.logger.debug('Querying ClickHouse for chains', { missingMints: missingMints.length });

    try {
      const ch = getClickHouseClient();
      const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

      // Query all missing mints in parallel (one query per mint to get all chains)
      const chainPromises = missingMints.map(async (mint) => {
        const escapedMint = mint.replace(/'/g, "''");
        try {
          const result = await ch.query({
            query: `
              SELECT DISTINCT chain
              FROM ${CLICKHOUSE_DATABASE}.token_metadata
              WHERE (token_address = '${escapedMint}' 
                     OR lower(token_address) = lower('${escapedMint}'))
              ORDER BY chain
              LIMIT 1
            `,
            format: 'JSONEachRow',
            clickhouse_settings: {
              max_execution_time: 10,
            },
          });

          const data = (await result.json()) as Array<{ chain: string }>;
          if (data && data.length > 0) {
            return { mint, chain: data[0].chain };
          }
        } catch (error) {
          ctx.logger.debug('Failed to query ClickHouse for chain', {
            mint,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return null;
      });

      const chainResults = await Promise.all(chainPromises);
      for (const result of chainResults) {
        if (result) {
          mintChainMap.set(result.mint, result.chain);
        }
      }

      ctx.logger.debug('Found chains from ClickHouse', {
        found: chainResults.filter((r) => r !== null).length,
        total: missingMints.length,
      });
    } catch (error) {
      ctx.logger.warn('Failed to query ClickHouse for chains', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Group mints by chain
  const mintsByChain = new Map<string, string[]>();
  for (const mint of task.missing_mints) {
    const chain = mintChainMap.get(mint) || (isEvmAddress(mint) ? 'evm' : 'solana');
    if (!mintsByChain.has(chain)) {
      mintsByChain.set(chain, []);
    }
    mintsByChain.get(chain)!.push(mint);
  }

  ctx.logger.info('Grouped mints by chain', {
    chains: Array.from(mintsByChain.keys()),
    counts: Object.fromEntries(
      Array.from(mintsByChain.entries()).map(([chain, mints]) => [chain, mints.length])
    ),
  });

  // Track failed mints per interval for retry and exclusion
  // Format: failedMints[interval][mint] = Set of chains that failed
  const failedMints = new Map<string, Map<string, Set<string>>>();

  // Run OHLCV ingestion for each interval and each chain
  for (const interval of intervals) {
    const intervalMap: Record<string, '1s' | '15s' | '1m' | '5m' | '1H'> = {
      '1s': '1s',
      '15s': '15s',
      '1m': '1m',
      '5m': '5m',
      '1h': '1H',
    };
    const workflowInterval = intervalMap[interval] || '1m';

    // Process each chain group separately
    for (const [chain, mints] of mintsByChain.entries()) {
      // Skip 'evm' - we need to try all EVM chains or get actual chain from worklist
      if (chain === 'evm') {
        // For EVM addresses without chain info, try all EVM chains
        const evmChains: Array<'ethereum' | 'bsc' | 'base'> = ['ethereum', 'bsc', 'base'];
        for (const evmChain of evmChains) {
          const ingestSpec: IngestOhlcvSpec = {
            duckdbPath: spec.duckdbPath,
            from,
            to,
            side: 'buy',
            chain: evmChain,
            interval: workflowInterval,
            preWindowMinutes: 52, // -52 candles before
            postWindowMinutes: 4948, // +4948 candles after = 5000 total
            errorMode: 'collect',
            checkCoverage: false, // Disable coverage check for surgical fetch - we know these mints need data
            rateLimitMs: 100,
            maxRetries: 3,
            mints, // Filter to only fetch OHLCV for missing mints in this chain
          };

          try {
            if (spec.verbose) {
              ctx.logger.info(
                `  Fetching ${interval} interval for ${task.caller} - ${task.month} (${evmChain})...`,
                {
                  task,
                  interval,
                  chain: evmChain,
                  mints: mints.length,
                }
              );
            }

            const result = await ingestOhlcv(ingestSpec, ctx.ohlcvIngestionContext);

            // Track which mints succeeded vs failed
            if (result.totalCandlesFetched > 0) {
              totalCandlesFetched += result.totalCandlesFetched;
              totalCandlesStored += result.totalCandlesStored;
              // Log success and break (found the right chain)
              if (spec.verbose) {
                ctx.logger.info(`  ✓ ${interval} interval complete for ${evmChain}`, {
                  task,
                  interval,
                  chain: evmChain,
                  candlesFetched: result.totalCandlesFetched,
                  candlesStored: result.totalCandlesStored,
                });
              }
              // Note: We found candles, but we don't know which specific mints succeeded
              // If some mints still need data, they'll be caught in a future coverage analysis
              break; // Found the right chain, don't try others
            } else {
              // No candles - track failure for all mints on this chain
              ctx.logger.debug(`No candles fetched for ${mints.length} mints on ${evmChain}`, {
                interval,
                chain: evmChain,
                mints: mints.length,
              });

              for (const mint of mints) {
                if (!failedMints.has(interval)) {
                  failedMints.set(interval, new Map());
                }
                if (!failedMints.get(interval)!.has(mint)) {
                  failedMints.get(interval)!.set(mint, new Set());
                }
                failedMints.get(interval)!.get(mint)!.add(evmChain);
              }

              // No candles - might be wrong chain, continue to next EVM chain
              if (spec.verbose) {
                ctx.logger.debug(`  No candles for ${evmChain}, trying next chain...`, {
                  task,
                  interval,
                  chain: evmChain,
                });
              }
            }

            if (result.errors.length > 0) {
              errors.push(`${interval} (${evmChain}): ${result.errors.length} errors`);
            }
          } catch (error) {
            // Track failure for all mints on this chain
            for (const mint of mints) {
              if (!failedMints.has(interval)) {
                failedMints.set(interval, new Map());
              }
              if (!failedMints.get(interval)!.has(mint)) {
                failedMints.get(interval)!.set(mint, new Set());
              }
              failedMints.get(interval)!.get(mint)!.add(evmChain);
            }

            // Continue to next chain on error
            const rawErrorMessage = error instanceof Error ? error.message : String(error);
            const sanitizedMessage = sanitizeErrorMessage(rawErrorMessage);
            errors.push(`${interval} (${evmChain}): ${sanitizedMessage}`);
            ctx.logger.debug(`Failed to fetch ${interval} for ${evmChain}, trying next chain`, {
              task,
              interval,
              chain: evmChain,
              error: sanitizedMessage,
            });
          }
        }
      } else {
        // Non-EVM or known chain - use directly
        const ingestSpec: IngestOhlcvSpec = {
          duckdbPath: spec.duckdbPath,
          from,
          to,
          side: 'buy',
          chain: chain as 'solana' | 'ethereum' | 'bsc' | 'base',
          interval: workflowInterval,
          preWindowMinutes: 52, // -52 candles before
          postWindowMinutes: 4948, // +4948 candles after = 5000 total
          errorMode: 'collect',
          checkCoverage: false, // Disable coverage check for surgical fetch - we know these mints need data
          rateLimitMs: 100,
          maxRetries: 3,
          mints, // Filter to only fetch OHLCV for missing mints in this chain
        };

        try {
          if (spec.verbose) {
            ctx.logger.info(
              `  Fetching ${interval} interval for ${task.caller} - ${task.month} (${chain})...`,
              {
                task,
                interval,
                chain,
                mints: mints.length,
              }
            );
          } else {
            ctx.logger.debug(`Fetching ${interval} interval for ${chain}`, {
              task,
              interval,
              chain,
            });
          }

          const result = await ingestOhlcv(ingestSpec, ctx.ohlcvIngestionContext);

          // Track which mints succeeded vs failed
          if (result.totalCandlesFetched === 0) {
            // No candles fetched - track failure for all mints on this chain
            ctx.logger.debug(`No candles fetched for ${mints.length} mints on ${chain}`, {
              interval,
              chain,
              mints: mints.length,
            });

            for (const mint of mints) {
              if (!failedMints.has(interval)) {
                failedMints.set(interval, new Map());
              }
              if (!failedMints.get(interval)!.has(mint)) {
                failedMints.get(interval)!.set(mint, new Set());
              }
              failedMints.get(interval)!.get(mint)!.add(chain);
            }
          }

          // Log worklist generation results for debugging
          if (spec.verbose || result.worklistGenerated === 0) {
            ctx.logger.info(`Worklist generation result for ${interval} (${chain})`, {
              interval,
              chain,
              worklistGenerated: result.worklistGenerated,
              workItemsProcessed: result.workItemsProcessed,
              workItemsSucceeded: result.workItemsSucceeded,
              workItemsFailed: result.workItemsFailed,
              workItemsSkipped: result.workItemsSkipped,
              totalCandlesFetched: result.totalCandlesFetched,
              totalCandlesStored: result.totalCandlesStored,
              errors: result.errors.length,
              mints: mints.length,
              dateRange: { from, to },
            });
          }

          totalCandlesFetched += result.totalCandlesFetched;
          totalCandlesStored += result.totalCandlesStored;

          if (result.errors.length > 0) {
            errors.push(`${interval} (${chain}): ${result.errors.length} errors`);
            // Log first few errors for debugging
            if (spec.verbose) {
              ctx.logger.warn(`Errors for ${interval} interval (${chain}):`, {
                errors: result.errors.slice(0, 5),
              });
            }
          }

          if (spec.verbose) {
            ctx.logger.info(`  ✓ ${interval} interval complete for ${chain}`, {
              task,
              interval,
              chain,
              candlesFetched: result.totalCandlesFetched,
              candlesStored: result.totalCandlesStored,
            });
          } else {
            ctx.logger.debug(`Completed ${interval} interval for ${chain}`, {
              task,
              interval,
              chain,
              candlesFetched: result.totalCandlesFetched,
              candlesStored: result.totalCandlesStored,
            });
          }
        } catch (error) {
          // Track failure for all mints on this chain
          for (const mint of mints) {
            if (!failedMints.has(interval)) {
              failedMints.set(interval, new Map());
            }
            if (!failedMints.get(interval)!.has(mint)) {
              failedMints.get(interval)!.set(mint, new Set());
            }
            failedMints.get(interval)!.get(mint)!.add(chain);
          }

          // Sanitize error message to prevent leaking sensitive information
          const rawErrorMessage = error instanceof Error ? error.message : String(error);
          const sanitizedMessage = sanitizeErrorMessage(rawErrorMessage);

          errors.push(`${interval} (${chain}): ${sanitizedMessage}`);
          ctx.logger.error(`Failed to fetch ${interval} interval for ${chain}`, {
            task,
            interval,
            chain,
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
    }
  }

  // Log failure tracking summary (always log this - critical for debugging)
  const totalFailedMintsCount = Array.from(failedMints.values()).reduce(
    (sum, map) => sum + map.size,
    0
  );
  
  if (totalFailedMintsCount > 0) {
    ctx.logger.info(`Failure tracking: ${totalFailedMintsCount} mints failed across all intervals`, {
      failedMintsSize: failedMints.size,
      intervalsWithFailures: Array.from(failedMints.keys()),
      failedMintsDetails: Array.from(failedMints.entries()).map(([interval, map]) => ({
        interval,
        count: map.size,
        sampleMints: Array.from(map.keys()).slice(0, 2),
        sampleChains: Array.from(map.values())[0] ? Array.from(Array.from(map.values())[0]).slice(0, 4) : [],
      })),
    });
  } else {
    ctx.logger.debug('No failed mints to retry - all fetches succeeded');
  }

  // Retry failed mints across all chains and add to exclusions if all fail
  if (failedMints.size > 0) {
    const totalFailedMints = Array.from(failedMints.values()).reduce(
      (sum, map) => sum + map.size,
      0
    );

    ctx.logger.info('Retrying failed mints across all chains', {
      intervalsWithFailures: Array.from(failedMints.keys()),
      totalFailedMints,
    });

    if (spec.verbose) {
      console.error(`\nRetrying ${totalFailedMints} failed mints across all chains...`);
    }

    for (const [interval, failedMintsForInterval] of failedMints.entries()) {
      if (failedMintsForInterval.size === 0) continue;

      ctx.logger.info(`Retrying ${failedMintsForInterval.size} failed mints for ${interval}`, {
        interval,
        failedMints: Array.from(failedMintsForInterval.keys()),
      });

      if (spec.verbose) {
        console.error(`  Retrying ${interval} interval: ${failedMintsForInterval.size} mints`);
      }

      const retryResult = await retryFailedMintsAcrossAllChains(
        failedMintsForInterval,
        interval,
        from,
        to,
        spec,
        ctx
      );

      if (retryResult.succeeded.length > 0) {
        totalCandlesFetched += retryResult.succeeded.length; // Approximate count
        ctx.logger.info(`Retry succeeded for ${retryResult.succeeded.length} mints`, {
          interval,
          succeeded: retryResult.succeeded,
        });
        if (spec.verbose) {
          console.error(`  ✓ ${retryResult.succeeded.length} mints succeeded on retry`);
        }
      }

      if (retryResult.excluded.length > 0) {
        ctx.logger.info(`Added ${retryResult.excluded.length} exclusion entries to DuckDB`, {
          interval,
          excluded: retryResult.excluded.map((e) => ({
            mint: e.tokenAddress,
            chain: e.chain,
          })),
        });
        if (spec.verbose) {
          console.error(
            `  ✗ Added ${retryResult.excluded.length} mints to exclusions (failed on all chains)`
          );
        }
      }
    }
  } else {
    ctx.logger.debug('No failed mints to retry - all fetches succeeded or no failures tracked');
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

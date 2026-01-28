/**
 * Fetch OHLCV from DuckDB Alerts Handler
 *
 * Reads alerts/calls from DuckDB and fetches OHLCV for EVERY alert.
 * Keeps fetching until full coverage is achieved for each alert.
 */

import { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { logger } from '@quantbot/infra/utils';
import { getDuckDBWorklistService } from '@quantbot/infra/storage';
import { storeCandles, getCoverage } from '@quantbot/ohlcv';
import type { Chain } from '@quantbot/core';
import { createTokenAddress } from '@quantbot/core';

// Console colors for filtered output
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

// Print colored progress to console (filtered, human-readable)
function print(msg: string) {
  process.stdout.write(msg + '\n');
}

// Progress indicator (optional, for future use)
function _printProgress(current: number, total: number, mint: string, status: string) {
  const pct = ((current / total) * 100).toFixed(0).padStart(3);
  const shortMint = mint.substring(0, 8) + '...' + mint.substring(mint.length - 4);
  process.stdout.write(
    `\r${c.gray}[${pct}%]${c.reset} ${c.cyan}${current}/${total}${c.reset} ${shortMint} ${status}`.padEnd(
      80
    )
  );
}

export const fetchFromDuckdbSchema = z.object({
  duckdb: z.string().min(1, 'DuckDB path is required'),
  interval: z.enum(['1s', '15s', '1m', '5m']).default('5m'),
  from: z.string().optional(), // ISO date string - filter alerts by date
  to: z.string().optional(), // ISO date string - filter alerts by date
  side: z.enum(['buy', 'sell']).default('buy'),
  format: z.enum(['json', 'table', 'csv']).default('table'),
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base']).optional(), // Filter by chain if provided
  concurrency: z.coerce.number().int().min(1).max(50).default(2), // Parallel fetch limit (max 50 to stay under API rate limits)
  delayMs: z.coerce.number().int().min(0).max(5000).default(200), // Delay between batch requests in milliseconds
  horizonSeconds: z.coerce.number().int().min(60).max(604800).default(7200), // Minimum forward time window in seconds (default: 2 hours, max: 7 days)
});

export type FetchFromDuckdbArgs = z.infer<typeof fetchFromDuckdbSchema>;

/**
 * Fetch OHLCV for all alerts in DuckDB
 */
export async function fetchFromDuckdbHandler(args: FetchFromDuckdbArgs, ctx: CommandContext) {
  const { resolve } = await import('path');
  const duckdbPath = resolve(process.cwd(), args.duckdb);

  const concurrency = args.concurrency ?? 2;
  const delayMs = args.delayMs ?? 200;
  const horizonSeconds = args.horizonSeconds ?? Number(process.env.OHLCV_HORIZON_SECONDS ?? 7200);

  logger.info('Fetching OHLCV for alerts from DuckDB', {
    duckdbPath,
    interval: args.interval,
    side: args.side,
    from: args.from,
    to: args.to,
    concurrency,
    delayMs,
    horizonSeconds,
  });

  // Console header
  print('');
  print(
    `${c.bold}${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`
  );
  print(
    `${c.bold}${c.cyan}  OHLCV Fetch${c.reset} ${c.gray}interval=${args.interval} concurrency=${concurrency}${c.reset}`
  );
  print(`${c.gray}  ${args.from || 'all'} → ${args.to || 'now'}${c.reset}`);
  print(
    `${c.bold}${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`
  );

  // Query DuckDB for worklist (alerts/calls)
  const worklistService = getDuckDBWorklistService();
  const worklist = await worklistService.queryWorklist({
    duckdbPath,
    from: args.from,
    to: args.to,
    side: args.side,
  });

  logger.info('Found alerts in DuckDB', {
    tokenGroups: worklist.tokenGroups.length,
    calls: worklist.calls.length,
  });

  print(
    `${c.blue}📋 Found ${c.bold}${worklist.calls.length}${c.reset}${c.blue} alerts to process${c.reset}`
  );
  print('');

  if (worklist.calls.length === 0) {
    return {
      alertsProcessed: 0,
      uniqueMints: 0,
      fetchesAttempted: 0,
      fetchesSucceeded: 0,
      fetchesFailed: 0,
      totalCandlesFetched: 0,
      totalCandlesStored: 0,
      alertsWithFullCoverage: 0,
      alertsWithIncompleteCoverage: 0,
      errors: [],
    };
  }

  // Process EVERY alert individually - no grouping, no deduplication
  // We want full coverage for each alert
  const alertsToProcess = worklist.calls
    .filter((call) => {
      if (!call.mint || call.alertTsMs === null || call.alertTsMs === undefined) return false;
      if (args.chain && call.chain && call.chain !== args.chain) return false;
      return true;
    })
    .map((call) => {
      // Use raw alertTsMs (milliseconds) directly from DuckDB
      // Convert to Unix seconds for Birdeye API (time_from parameter)
      const alertTsSeconds = Math.floor(call.alertTsMs! / 1000);
      return {
        mint: call.mint!,
        chain: (call.chain as Chain) || 'solana',
        alertTsSeconds,
        callerName: 'unknown', // Worklist doesn't include caller name
      };
    });

  logger.info(`Processing ${alertsToProcess.length} alerts individually (no grouping)`, {
    totalAlerts: alertsToProcess.length,
    interval: args.interval,
  });

  // Calculate interval seconds
  const intervalSeconds =
    args.interval === '1s' ? 1 : args.interval === '15s' ? 15 : args.interval === '1m' ? 60 : 300; // 5m

  // Coverage requirements: 5000 candles total starting from alert time
  // Birdeye API limit is 5000 candles per request
  // horizonSeconds can override this if a larger time window is needed
  // Time coverage per interval at 5000 candles:
  // - 1s: ~1.4 hours
  // - 15s: ~20.8 hours
  // - 1m: ~3.5 days
  // - 5m: ~17.4 days
  const baseTotalCandles = 5000; // 5000 candles total (1 API request)
  const horizonCandles = Math.ceil(horizonSeconds / intervalSeconds);
  const totalCandles = Math.max(baseTotalCandles, horizonCandles);
  const forwardSeconds = totalCandles * intervalSeconds;

  logger.debug('Forward window calculation', {
    interval: args.interval,
    intervalSeconds,
    horizonSeconds,
    baseTotalCandles,
    horizonCandles,
    totalCandles,
    forwardSeconds,
    forwardHours: (forwardSeconds / 3600).toFixed(2),
    estimatedApiRequests: Math.ceil(totalCandles / 5000),
  });

  // Minimum coverage threshold (95% = full coverage)
  const MIN_COVERAGE_RATIO = 0.95;
  const MIN_CANDLES = totalCandles; // 5000 candles total

  const results = {
    alertsProcessed: alertsToProcess.length,
    uniqueMints: new Set(alertsToProcess.map((a) => a.mint)).size,
    fetchesAttempted: 0,
    fetchesSucceeded: 0,
    fetchesFailed: 0,
    totalCandlesFetched: 0,
    totalCandlesStored: 0,
    alertsWithFullCoverage: 0,
    alertsWithIncompleteCoverage: 0,
    retries: 0,
    errors: [] as Array<{ mint: string; alertTsSeconds: number; error: string }>,
  };

  // Helper function to process a single alert
  async function processAlert(
    alertData: (typeof alertsToProcess)[0],
    alertNum: number
  ): Promise<{
    fetchesAttempted: number;
    fetchesSucceeded: number;
    fetchesFailed: number;
    totalCandlesFetched: number;
    totalCandlesStored: number;
    alertsWithFullCoverage: number;
    alertsWithIncompleteCoverage: number;
    retries: number;
    error?: { mint: string; alertTsSeconds: number; error: string };
  }> {
    const { mint, chain, alertTsSeconds, callerName } = alertData;
    const localResults = {
      fetchesAttempted: 0,
      fetchesSucceeded: 0,
      fetchesFailed: 0,
      totalCandlesFetched: 0,
      totalCandlesStored: 0,
      alertsWithFullCoverage: 0,
      alertsWithIncompleteCoverage: 0,
      retries: 0,
      error: undefined as { mint: string; alertTsSeconds: number; error: string } | undefined,
    };

    try {
      // Calculate required time window for this alert
      // Use raw Unix seconds directly - no datetime parsing needed!
      // Note: --from/--to filter ALERTS, not candle window
      // Each alert gets exactly 5000 candles starting from its alert time
      const fromUnix = alertTsSeconds;
      const toUnix = alertTsSeconds + forwardSeconds;

      logger.info(
        `[${alertNum}/${alertsToProcess.length}] Processing alert for ${mint.substring(0, 20)}...`,
        {
          mint,
          chain,
          interval: args.interval,
          alertTsSeconds,
          caller: callerName,
          fromUnix,
          toUnix,
          requiredCandles: MIN_CANDLES,
        }
      );

      // Check current coverage first
      localResults.fetchesAttempted++;
      const coverage = await getCoverage(
        mint,
        chain,
        new Date(fromUnix * 1000),
        new Date(toUnix * 1000),
        args.interval
      );

      logger.debug(`Coverage check for ${mint}`, {
        mint,
        hasData: coverage.hasData,
        candleCount: coverage.candleCount,
        coverageRatio: coverage.coverageRatio,
        requiredCandles: MIN_CANDLES,
        requiredRatio: MIN_COVERAGE_RATIO,
      });

      // Check if we already have enough coverage (skip fetch)
      const hasEnoughCandles = coverage.candleCount >= MIN_CANDLES;
      const hasEnoughRatio = coverage.coverageRatio >= MIN_COVERAGE_RATIO;
      const shortMint = mint.substring(0, 8) + '...' + mint.substring(mint.length - 4);

      if (hasEnoughCandles && hasEnoughRatio) {
        localResults.alertsWithFullCoverage++;
        logger.info(`✅ Full coverage achieved for ${mint} (alert ${alertNum})`, {
          mint,
          candleCount: coverage.candleCount,
          coverageRatio: coverage.coverageRatio,
        });
        // Console: coverage already exists
        print(
          `${c.green}✓${c.reset} ${c.gray}[${alertNum}/${alertsToProcess.length}]${c.reset} ${shortMint} ${c.dim}cached (${coverage.candleCount} candles)${c.reset}`
        );
      } else {
        // Need to fetch data (single attempt, no retry loop)
        logger.debug(`Fetching candles for ${mint} (alert ${alertNum})`, {
          mint,
          currentCandles: coverage.candleCount,
          requiredCandles: MIN_CANDLES,
        });

        // Fetch candles via MarketDataPort (single attempt, no retry loop)
        const marketDataPort = await ctx.getMarketDataPort();
        const fetchStart = Date.now();

        // Map interval to MarketDataPort format
        const marketDataInterval: '15s' | '1m' | '5m' | '1H' =
          args.interval === '1s' || args.interval === '15s'
            ? '15s'
            : args.interval === '5m'
              ? '5m'
              : '1m'; // Default to 1m for other intervals

        const candles = await marketDataPort.fetchOhlcv({
          tokenAddress: createTokenAddress(mint),
          chain,
          interval: marketDataInterval,
          from: fromUnix,
          to: toUnix,
        });
        const fetchDuration = Date.now() - fetchStart;

        if (candles.length > 0) {
          // Store candles
          const storeStart = Date.now();
          await storeCandles(mint, chain, candles, args.interval);
          const storeDuration = Date.now() - storeStart;

          localResults.fetchesSucceeded++;
          localResults.totalCandlesFetched += candles.length;
          localResults.totalCandlesStored += candles.length;
          localResults.alertsWithFullCoverage++;

          logger.info(`Fetched and stored ${candles.length} candles for ${mint}`, {
            mint,
            candlesFetched: candles.length,
            fetchDurationMs: fetchDuration,
            storeDurationMs: storeDuration,
          });

          // Console: fetched and stored
          print(
            `${c.green}✓${c.reset} ${c.gray}[${alertNum}/${alertsToProcess.length}]${c.reset} ${shortMint} ${c.bold}${candles.length}${c.reset} candles ${c.dim}(${fetchDuration}ms)${c.reset}`
          );
        } else {
          // No data available from API
          localResults.alertsWithIncompleteCoverage++;
          logger.warn(`No candles available from API for ${mint} (alert ${alertNum})`, {
            mint,
            chain,
            interval: args.interval,
            fromUnix,
            toUnix,
          });
          print(
            `${c.yellow}⚠${c.reset} ${c.gray}[${alertNum}/${alertsToProcess.length}]${c.reset} ${shortMint} ${c.dim}no data${c.reset}`
          );
        }
      }
    } catch (error) {
      localResults.fetchesFailed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      localResults.error = {
        mint,
        alertTsSeconds,
        error: errorMsg,
      };
      logger.error(`Failed to fetch OHLCV for ${mint} (alert ${alertNum})`, {
        mint,
        chain,
        alertTsSeconds,
        error: errorMsg,
      });

      // Console: error
      const shortMint = mint.substring(0, 8) + '...' + mint.substring(mint.length - 4);
      const shortError = errorMsg.length > 40 ? errorMsg.substring(0, 40) + '...' : errorMsg;
      print(
        `${c.red}✗${c.reset} ${c.gray}[${alertNum}/${alertsToProcess.length}]${c.reset} ${shortMint} ${c.red}${shortError}${c.reset}`
      );
    }

    return localResults;
  }

  // Process alerts in parallel batches (controlled by concurrency param)
  for (let i = 0; i < alertsToProcess.length; i += concurrency) {
    const batch = alertsToProcess.slice(i, i + concurrency);
    const batchStartNum = i + 1;
    const isLastBatch = i + concurrency >= alertsToProcess.length;

    logger.debug(`Processing batch of ${batch.length} alerts (starting at ${batchStartNum})`, {
      batchSize: batch.length,
      concurrency,
      totalAlerts: alertsToProcess.length,
      progress: `${i + batch.length}/${alertsToProcess.length}`,
    });

    const batchResults = await Promise.all(
      batch.map((alert, batchIndex) => processAlert(alert, i + batchIndex + 1))
    );

    // Aggregate batch results
    for (const localResult of batchResults) {
      results.fetchesAttempted += localResult.fetchesAttempted;
      results.fetchesSucceeded += localResult.fetchesSucceeded;
      results.fetchesFailed += localResult.fetchesFailed;
      results.totalCandlesFetched += localResult.totalCandlesFetched;
      results.totalCandlesStored += localResult.totalCandlesStored;
      results.alertsWithFullCoverage += localResult.alertsWithFullCoverage;
      results.alertsWithIncompleteCoverage += localResult.alertsWithIncompleteCoverage;
      results.retries += localResult.retries;
      if (localResult.error) {
        results.errors.push(localResult.error);
      }
    }

    // Rate limiting delay between batches (skip after last batch)
    if (!isLastBatch && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  logger.info('Completed fetching OHLCV for all alerts', {
    alertsProcessed: results.alertsProcessed,
    alertsWithFullCoverage: results.alertsWithFullCoverage,
    alertsWithIncompleteCoverage: results.alertsWithIncompleteCoverage,
    fetchesAttempted: results.fetchesAttempted,
    fetchesSucceeded: results.fetchesSucceeded,
    fetchesFailed: results.fetchesFailed,
    retries: results.retries,
    totalCandlesFetched: results.totalCandlesFetched,
    totalCandlesStored: results.totalCandlesStored,
    coverageSuccessRate: `${((results.alertsWithFullCoverage / results.alertsProcessed) * 100).toFixed(1)}%`,
  });

  // Console: completion summary
  const successRate = ((results.alertsWithFullCoverage / results.alertsProcessed) * 100).toFixed(1);
  print('');
  print(
    `${c.bold}${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`
  );
  print(`${c.bold}${c.green}✓ COMPLETE${c.reset}`);
  print(
    `  Alerts: ${c.bold}${results.alertsProcessed}${c.reset} processed, ${c.green}${results.alertsWithFullCoverage}${c.reset} success, ${c.red}${results.fetchesFailed}${c.reset} failed`
  );
  print(
    `  Candles: ${c.bold}${results.totalCandlesFetched.toLocaleString()}${c.reset} fetched, ${c.bold}${results.totalCandlesStored.toLocaleString()}${c.reset} stored`
  );
  print(`  Success rate: ${c.bold}${successRate}%${c.reset}`);
  print(
    `${c.bold}${c.cyan}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${c.reset}`
  );
  print('');

  return results;
}

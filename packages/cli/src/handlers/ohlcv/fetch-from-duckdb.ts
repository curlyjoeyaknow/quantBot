/**
 * Fetch OHLCV from DuckDB Alerts Handler
 *
 * Reads alerts/calls from DuckDB and fetches OHLCV for EVERY alert.
 * Keeps fetching until full coverage is achieved for each alert.
 */

import { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import { getDuckDBWorklistService } from '@quantbot/storage';
import { fetchBirdeyeCandles } from '@quantbot/api-clients';
import { storeCandles, getCoverage } from '@quantbot/ohlcv';
import type { Chain } from '@quantbot/core';

export const fetchFromDuckdbSchema = z.object({
  duckdb: z.string().min(1, 'DuckDB path is required'),
  interval: z.enum(['1s', '15s', '1m', '5m', '1H']).default('5m'),
  from: z.string().optional(), // ISO date string - filter alerts by date
  to: z.string().optional(), // ISO date string - filter alerts by date
  side: z.enum(['buy', 'sell']).default('buy'),
  format: z.enum(['json', 'table', 'csv']).default('table'),
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base']).optional(), // Filter by chain if provided
});

export type FetchFromDuckdbArgs = z.infer<typeof fetchFromDuckdbSchema>;

/**
 * Fetch OHLCV for all alerts in DuckDB
 */
export async function fetchFromDuckdbHandler(args: FetchFromDuckdbArgs, ctx: CommandContext) {
  const { resolve } = await import('path');
  const duckdbPath = resolve(process.cwd(), args.duckdb);

  logger.info('Fetching OHLCV for alerts from DuckDB', {
    duckdbPath,
    interval: args.interval,
    side: args.side,
    from: args.from,
    to: args.to,
  });

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
      if (!call.mint || !call.trigger_ts_ms) return false;
      if (args.chain && call.chain && call.chain !== args.chain) return false;
      return true;
    })
    .map((call) => {
      const alertTime = DateTime.fromMillis(call.trigger_ts_ms, { zone: 'utc' });
      return {
        mint: call.mint!,
        chain: (call.chain as Chain) || 'solana',
        alertTime,
        callerName: call.trigger_from_name || 'unknown',
      };
    });

  logger.info(`Processing ${alertsToProcess.length} alerts individually (no grouping)`, {
    totalAlerts: alertsToProcess.length,
    interval: args.interval,
  });

  // Calculate interval seconds
  const intervalSeconds =
    args.interval === '1s'
      ? 1
      : args.interval === '15s'
        ? 15
        : args.interval === '1m'
          ? 60
          : args.interval === '5m'
            ? 300
            : 3600; // 1H

  // Coverage requirements: -5 intervals before alert, +4000 candles after alert
  const lookbackIntervals = 5;
  const forwardCandles = 4000;
  const lookbackSeconds = lookbackIntervals * intervalSeconds;
  const forwardSeconds = forwardCandles * intervalSeconds;

  // Minimum coverage threshold (95% = full coverage)
  const MIN_COVERAGE_RATIO = 0.95;
  const MIN_CANDLES = forwardCandles + lookbackIntervals; // At least 4005 candles total

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
    errors: [] as Array<{ mint: string; alertTime: string; error: string }>,
  };

  // Process each alert individually
  for (let i = 0; i < alertsToProcess.length; i++) {
    const { mint, chain, alertTime, callerName } = alertsToProcess[i];
    const alertNum = i + 1;

    try {
      // Calculate required time window for this alert
      const fromUTC = alertTime.minus({ seconds: lookbackSeconds });
      const toUTC = args.to
        ? DateTime.fromISO(args.to, { zone: 'utc' }).toUTC()
        : alertTime.plus({ seconds: forwardSeconds });

      const fromUnix = Math.floor(fromUTC.toSeconds());
      const toUnix = Math.floor(toUTC.toSeconds());

      logger.info(
        `[${alertNum}/${alertsToProcess.length}] Processing alert for ${mint.substring(0, 20)}...`,
        {
          mint,
          chain,
          interval: args.interval,
          alertTime: alertTime.toISO()!,
          caller: callerName,
          from: fromUTC.toISO()!,
          to: toUTC.toISO()!,
          requiredCandles: MIN_CANDLES,
        }
      );

      // Keep fetching until we have full coverage
      let hasFullCoverage = false;
      let fetchAttempts = 0;
      const MAX_FETCH_ATTEMPTS = 10; // Prevent infinite loops

      while (!hasFullCoverage && fetchAttempts < MAX_FETCH_ATTEMPTS) {
        fetchAttempts++;
        results.fetchesAttempted++;

        // Check current coverage
        const coverage = await getCoverage(
          mint,
          chain,
          fromUTC.toJSDate(),
          toUTC.toJSDate(),
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

        // Check if we have full coverage
        const hasEnoughCandles = coverage.candleCount >= MIN_CANDLES;
        const hasEnoughRatio = coverage.coverageRatio >= MIN_COVERAGE_RATIO;

        if (hasEnoughCandles && hasEnoughRatio) {
          hasFullCoverage = true;
          results.alertsWithFullCoverage++;
          logger.info(`✅ Full coverage achieved for ${mint} (alert ${alertNum})`, {
            mint,
            candleCount: coverage.candleCount,
            coverageRatio: coverage.coverageRatio,
            fetchAttempts,
          });
          break;
        }

        // Need to fetch more data
        logger.info(`⚠️  Incomplete coverage for ${mint} (alert ${alertNum}) - fetching...`, {
          mint,
          currentCandles: coverage.candleCount,
          requiredCandles: MIN_CANDLES,
          currentRatio: coverage.coverageRatio,
          requiredRatio: MIN_COVERAGE_RATIO,
          fetchAttempt: fetchAttempts,
          maxAttempts: MAX_FETCH_ATTEMPTS,
        });

        // Fetch candles
        const fetchStart = Date.now();
        const candles = await fetchBirdeyeCandles(mint, args.interval, fromUnix, toUnix, chain);
        const fetchDuration = Date.now() - fetchStart;

        if (candles.length > 0) {
          // Store candles
          const storeStart = Date.now();
          await storeCandles(mint, chain, candles, args.interval);
          const storeDuration = Date.now() - storeStart;

          results.fetchesSucceeded++;
          results.totalCandlesFetched += candles.length;
          results.totalCandlesStored += candles.length;

          logger.info(`Fetched and stored ${candles.length} candles for ${mint}`, {
            mint,
            candlesFetched: candles.length,
            fetchDurationMs: fetchDuration,
            storeDurationMs: storeDuration,
            fetchAttempt: fetchAttempts,
          });

          // Small delay before checking coverage again
          await new Promise((resolve) => setTimeout(resolve, 100));
        } else {
          // No more data available from API
          logger.warn(`No candles available from API for ${mint} (alert ${alertNum})`, {
            mint,
            chain,
            interval: args.interval,
            from: fromUTC.toISO()!,
            to: toUTC.toISO()!,
          });
          break; // Can't get more data, exit retry loop
        }

        if (fetchAttempts > 1) {
          results.retries++;
        }
      }

      if (!hasFullCoverage) {
        results.alertsWithIncompleteCoverage++;
        const finalCoverage = await getCoverage(
          mint,
          chain,
          fromUTC.toJSDate(),
          toUTC.toJSDate(),
          args.interval
        );
        logger.warn(
          `❌ Incomplete coverage after ${fetchAttempts} attempts for ${mint} (alert ${alertNum})`,
          {
            mint,
            finalCandles: finalCoverage.candleCount,
            requiredCandles: MIN_CANDLES,
            finalRatio: finalCoverage.coverageRatio,
            requiredRatio: MIN_COVERAGE_RATIO,
          }
        );
      }
    } catch (error) {
      results.fetchesFailed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.errors.push({
        mint,
        alertTime: alertTime.toISO()!,
        error: errorMsg,
      });
      logger.error(`Failed to fetch OHLCV for ${mint} (alert ${alertNum})`, {
        mint,
        chain,
        alertTime: alertTime.toISO()!,
        error: errorMsg,
      });
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

  return results;
}

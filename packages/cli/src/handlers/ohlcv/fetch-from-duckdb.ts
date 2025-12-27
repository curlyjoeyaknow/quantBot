/**
 * Fetch OHLCV from DuckDB Alerts Handler
 *
 * Reads alerts/calls from DuckDB and runs direct fetch for each unique mint.
 * Groups by mint to avoid duplicate fetches.
 */

import { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import { getDuckDBWorklistService } from '@quantbot/storage';
import { fetchBirdeyeCandles } from '@quantbot/api-clients';
import { storeCandles } from '@quantbot/ohlcv';
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

  if (worklist.tokenGroups.length === 0) {
    return {
      alertsProcessed: 0,
      uniqueMints: 0,
      fetchesAttempted: 0,
      fetchesSucceeded: 0,
      fetchesFailed: 0,
      totalCandlesFetched: 0,
      totalCandlesStored: 0,
      errors: [],
    };
  }

  // Group by mint to get unique mints with earliest alert time
  const mintMap = new Map<
    string,
    {
      mint: string;
      chain: string;
      earliestAlertTime: DateTime;
      callCount: number;
    }
  >();

  for (const group of worklist.tokenGroups) {
    if (!group.mint || !group.earliestAlertTime) continue;

    // Filter by chain if provided
    if (args.chain && group.chain && group.chain !== args.chain) {
      continue;
    }

    const alertTime = DateTime.fromISO(group.earliestAlertTime, { zone: 'utc' });
    if (!alertTime.isValid) continue;

    const existing = mintMap.get(group.mint);
    if (!existing || alertTime < existing.earliestAlertTime) {
      mintMap.set(group.mint, {
        mint: group.mint,
        chain: group.chain || 'solana', // Default to solana if not specified
        earliestAlertTime: alertTime,
        callCount: group.callCount || 0,
      });
    }
  }

  const uniqueMints = Array.from(mintMap.values());
  logger.info(`Processing ${uniqueMints.length} unique mints`, {
    uniqueMints: uniqueMints.length,
  });

  // Calculate interval seconds for -52 candles lookback
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

  const lookbackSeconds = 52 * intervalSeconds;

  // Fetch candles for each unique mint
  const results = {
    alertsProcessed: worklist.calls.length,
    uniqueMints: uniqueMints.length,
    fetchesAttempted: 0,
    fetchesSucceeded: 0,
    fetchesFailed: 0,
    totalCandlesFetched: 0,
    totalCandlesStored: 0,
    errors: [] as Array<{ mint: string; error: string }>,
  };

  for (const { mint, chain, earliestAlertTime } of uniqueMints) {
    try {
      results.fetchesAttempted++;

      // Calculate fetch window: -52 candles before alert, and 4 sets of 5000 candles (20000) after alert
      // If --to is provided, use that instead of the default 20000 candles
      const defaultForwardCandles = 4 * 5000; // 20000 candles
      const defaultForwardSeconds = defaultForwardCandles * intervalSeconds;
      const toUTC = args.to
        ? DateTime.fromISO(args.to, { zone: 'utc' }).toUTC()
        : earliestAlertTime.plus({ seconds: defaultForwardSeconds });
      const fromUTC = earliestAlertTime.minus({ seconds: lookbackSeconds });

      logger.info(`Fetching OHLCV for mint ${mint.substring(0, 20)}...`, {
        mint,
        chain,
        interval: args.interval,
        alertTime: earliestAlertTime.toISO()!,
        from: fromUTC.toISO()!,
        to: toUTC.toISO()!,
        lookbackCandles: 52,
        forwardCandles: args.to ? 'custom' : defaultForwardCandles, // 20000 candles (4 × 5000)
      });

      const fromUnix = Math.floor(fromUTC.toSeconds());
      const toUnix = Math.floor(toUTC.toSeconds());

      // Fetch candles
      const fetchStart = Date.now();
      const candles = await fetchBirdeyeCandles(mint, args.interval, fromUnix, toUnix, chain);
      const fetchDuration = Date.now() - fetchStart;

      if (candles.length > 0) {
        // Store candles
        const storeStart = Date.now();
        await storeCandles(mint, chain as Chain, candles, args.interval);
        const storeDuration = Date.now() - storeStart;

        results.fetchesSucceeded++;
        results.totalCandlesFetched += candles.length;
        results.totalCandlesStored += candles.length;

        logger.info(`Successfully fetched and stored ${candles.length} candles for ${mint}`, {
          mint,
          candlesFetched: candles.length,
          fetchDurationMs: fetchDuration,
          storeDurationMs: storeDuration,
        });
      } else {
        results.fetchesFailed++;
        const errorMsg = `No candles available for mint ${mint} on ${chain}`;
        results.errors.push({ mint, error: errorMsg });
        logger.info(`No candles found for ${mint}`, {
          mint,
          chain,
          interval: args.interval,
          from: fromUTC.toISO()!,
          to: toUTC.toISO()!,
        });
      }
    } catch (error) {
      results.fetchesFailed++;
      const errorMsg = error instanceof Error ? error.message : String(error);
      results.errors.push({ mint, error: errorMsg });
      logger.error(`Failed to fetch OHLCV for ${mint}`, {
        mint,
        chain,
        error: errorMsg,
      });
    }
  }

  logger.info('Completed fetching OHLCV for all alerts', {
    fetchesAttempted: results.fetchesAttempted,
    fetchesSucceeded: results.fetchesSucceeded,
    fetchesFailed: results.fetchesFailed,
    totalCandlesFetched: results.totalCandlesFetched,
    totalCandlesStored: results.totalCandlesStored,
  });

  return results;
}


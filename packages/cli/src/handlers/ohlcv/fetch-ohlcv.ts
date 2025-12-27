/**
 * Direct OHLCV Fetch Handler
 *
 * Fetches candles for a single mint directly from Birdeye API and stores in ClickHouse.
 * Bypasses worklist generation - useful for quick single-mint fetches.
 */

import { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { fetchBirdeyeCandles } from '@quantbot/api-clients';
import { storeCandles } from '@quantbot/ohlcv';
import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';

export const fetchOhlcvSchema = z.object({
  mint: z.string().min(1, 'Mint address is required'),
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base']).default('solana'),
  interval: z.enum(['1s', '15s', '1m', '5m', '1H']).default('5m'), // Note: '1H' not '1h' for Birdeye API
  from: z.string().optional(), // ISO date string
  to: z.string().optional(), // ISO date string
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export type FetchOhlcvArgs = z.infer<typeof fetchOhlcvSchema>;

/**
 * Direct fetch handler - fetches candles for a single mint and stores them
 */
export async function fetchOhlcvHandler(args: FetchOhlcvArgs, ctx: CommandContext) {
  // Parse dates - default to today if not provided
  // Ensure all dates are in UTC
  const now = DateTime.utc();
  const specifiedFrom = args.from
    ? DateTime.fromISO(args.from, { zone: 'utc' })
    : now.startOf('day');
  const to = args.to ? DateTime.fromISO(args.to, { zone: 'utc' }) : now;

  // Ensure dates are in UTC (convert if they weren't already)
  const specifiedFromUTC = specifiedFrom.isValid ? specifiedFrom.toUTC() : null;
  const toUTC = to.isValid ? to.toUTC() : null;

  if (!specifiedFromUTC || !specifiedFromUTC.isValid) {
    throw new Error(`Invalid 'from' date: ${args.from}`);
  }
  if (!toUTC || !toUTC.isValid) {
    throw new Error(`Invalid 'to' date: ${args.to}`);
  }

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

  // By default, fetch -52 candles prior to the specified from date
  const lookbackSeconds = 52 * intervalSeconds;
  const from = specifiedFromUTC.minus({ seconds: lookbackSeconds });

  const fromUnix = Math.floor(from.toSeconds());
  const toUnix = Math.floor(toUTC.toSeconds());

  logger.info('Fetching OHLCV with -52 candle lookback', {
    mint: args.mint,
    chain: args.chain,
    interval: args.interval,
    specifiedFrom: specifiedFromUTC.toISO()!,
    actualFrom: from.toISO()!,
    to: toUTC.toISO()!,
    lookbackCandles: 52,
    lookbackSeconds,
  });

  // Fetch candles directly from Birdeye
  const fetchStart = Date.now();
  const candles = await fetchBirdeyeCandles(
    args.mint,
    args.interval,
    fromUnix,
    toUnix,
    args.chain
  );
  const fetchDuration = Date.now() - fetchStart;

  logger.info('Fetched candles from Birdeye', {
    mint: args.mint,
    candlesFetched: candles.length,
    durationMs: fetchDuration,
  });

  // Store candles in ClickHouse
  if (candles.length > 0) {
    const storeStart = Date.now();
    await storeCandles(args.mint, args.chain, candles, args.interval);
    const storeDuration = Date.now() - storeStart;
    logger.info('Stored candles in ClickHouse', {
      mint: args.mint,
      candlesStored: candles.length,
      durationMs: storeDuration,
    });
  } else {
    logger.info('No candles fetched - token may not have data for this time range', {
      mint: args.mint,
      chain: args.chain,
      interval: args.interval,
      from: from.toISO()!,
      to: toUTC.toISO()!,
    });
  }

  return {
    mint: args.mint,
    chain: args.chain,
    interval: args.interval,
    specifiedFrom: specifiedFrom.toISO()!, // User-specified from date
    actualFrom: from.toISO()!, // Actual from date (includes -52 candles lookback)
    to: to.toISO()!,
    lookbackCandles: 52,
    candlesFetched: candles.length,
    candlesStored: candles.length,
    firstCandle: candles.length > 0 ? DateTime.fromSeconds(candles[0].timestamp).toISO()! : null,
    lastCandle:
      candles.length > 0
        ? DateTime.fromSeconds(candles[candles.length - 1].timestamp).toISO()!
        : null,
  };
}


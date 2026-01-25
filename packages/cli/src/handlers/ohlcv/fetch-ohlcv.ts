/**
 * Direct OHLCV Fetch Handler
 *
 * Fetches candles for a single mint directly from Birdeye API and stores in ClickHouse.
 * Bypasses worklist generation - useful for quick single-mint fetches.
 */

import { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { storeCandles } from '@quantbot/ohlcv';
import { DateTime } from 'luxon';
import { logger } from '@quantbot/infra/utils';
import { createTokenAddress } from '@quantbot/core';

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
  const specifiedTo = args.to ? DateTime.fromISO(args.to, { zone: 'utc' }) : null;

  // Ensure dates are in UTC (convert if they weren't already)
  const specifiedFromUTC = specifiedFrom.isValid ? specifiedFrom.toUTC() : null;

  if (!specifiedFromUTC || !specifiedFromUTC.isValid) {
    throw new Error(`Invalid 'from' date: ${args.from}`);
  }

  // Calculate interval seconds for -52 candles lookback and 4 sets of 5000 candles forward
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

  // By default, fetch 4 sets of 5000 candles (20000 candles) after the specified from date
  // If --to is provided, use that instead
  const defaultForwardCandles = 4 * 5000; // 20000 candles
  const defaultForwardSeconds = defaultForwardCandles * intervalSeconds;
  const toUTC =
    specifiedTo && specifiedTo.isValid
      ? specifiedTo.toUTC()
      : specifiedFromUTC.plus({ seconds: defaultForwardSeconds });

  if (!toUTC.isValid) {
    throw new Error(`Invalid 'to' date: ${args.to}`);
  }

  const fromUnix = Math.floor(from.toSeconds());
  const toUnix = Math.floor(toUTC.toSeconds());

  logger.info('Fetching OHLCV with -52 candle lookback and 4 sets of 5000 candles forward', {
    mint: args.mint,
    chain: args.chain,
    interval: args.interval,
    specifiedFrom: specifiedFromUTC.toISO()!,
    actualFrom: from.toISO()!,
    to: toUTC.toISO()!,
    lookbackCandles: 52,
    forwardCandles: args.to ? 'custom' : defaultForwardCandles,
    lookbackSeconds,
    forwardSeconds: args.to ? undefined : defaultForwardSeconds,
  });

  // Fetch candles via MarketDataPort
  const marketDataPort = await ctx.getMarketDataPort();
  const fetchStart = Date.now();
  
  // Map interval to MarketDataPort format
  const marketDataInterval: '15s' | '1m' | '5m' | '1H' =
    args.interval === '1s' || args.interval === '15s'
      ? '15s'
      : args.interval === '5m'
        ? '5m'
        : args.interval === '1m'
          ? '1m'
          : '1m'; // Default to 1m
  
  const candles = await marketDataPort.fetchOhlcv({
    tokenAddress: createTokenAddress(args.mint),
    chain: args.chain,
    interval: marketDataInterval,
    from: fromUnix,
    to: toUnix,
  });
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
    specifiedFrom: specifiedFromUTC.toISO()!, // User-specified from date (UTC)
    actualFrom: from.toISO()!, // Actual from date (includes -52 candles lookback, UTC)
    to: toUTC.toISO()!, // To date (4 sets of 5000 candles forward, or custom if --to provided)
    lookbackCandles: 52,
    forwardCandles: args.to ? undefined : defaultForwardCandles, // 20000 candles (4 × 5000)
    candlesFetched: candles.length,
    candlesStored: candles.length,
    firstCandle:
      candles.length > 0
        ? DateTime.fromSeconds(candles[0].timestamp, { zone: 'utc' }).toISO()!
        : null,
    lastCandle:
      candles.length > 0
        ? DateTime.fromSeconds(candles[candles.length - 1].timestamp, { zone: 'utc' }).toISO()!
        : null,
  };
}

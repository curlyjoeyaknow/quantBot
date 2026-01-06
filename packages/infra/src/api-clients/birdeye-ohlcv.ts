/**
 * Birdeye OHLCV Fetching Utilities
 * ==================================
 *
 * High-level functions for fetching OHLCV candles from Birdeye API with automatic chunking.
 * These functions wrap BirdeyeClient.fetchOHLCVData() and handle:
 * - Automatic chunking for requests > 5000 candles
 * - Conversion from BirdeyeOHLCVResponse to Candle[] format
 * - Error handling and retries (via BirdeyeClient)
 *
 * This module centralizes all Birdeye OHLCV fetching logic that was previously
 * scattered across the codebase.
 */

import type { Candle } from '@quantbot/core';
import { logger } from '../utils/index.js';
import { BirdeyeClient, getBirdeyeClient, type BirdeyeOHLCVResponse } from './birdeye-client.js';

/**
 * Convert BirdeyeOHLCVResponse to Candle[] format
 */
function convertBirdeyeResponseToCandles(response: BirdeyeOHLCVResponse | null): Candle[] {
  if (!response || !response.items) {
    return [];
  }

  return response.items.map((item) => ({
    timestamp: item.unixTime,
    open: item.open,
    high: item.high,
    low: item.low,
    close: item.close,
    volume: item.volume,
  }));
}

/**
 * Fetches candles from Birdeye API with automatic chunking for large requests.
 *
 * Handles requests that exceed 5000 candles by automatically chunking them
 * into multiple API calls. Returns all candles sorted by timestamp.
 *
 * @param mint - Token address (Solana mint or EVM address)
 * @param interval - Candle interval: '1s', '15s', '1m', '5m', or '1H'
 *   Note: '1s' may not be supported by Birdeye for all tokens/time ranges
 * @param from - Start time (UNIX seconds)
 * @param to - End time (UNIX seconds)
 * @param chain - Blockchain name, e.g. 'solana' (default: 'solana')
 * @param client - Optional BirdeyeClient instance (defaults to getBirdeyeClient())
 * @returns Array of Candle objects, sorted by timestamp
 */
export async function fetchBirdeyeCandles(
  mint: string,
  interval: '1s' | '15s' | '1m' | '5m' | '1H',
  from: number,
  to: number,
  chain: string = 'solana',
  client?: BirdeyeClient
): Promise<Candle[]> {
  const birdeyeClient = client || getBirdeyeClient();

  // Normalize chain to lowercase for Birdeye API compatibility
  const normalizedChain = chain.toLowerCase();

  // Calculate interval seconds and max candles per request (5000 limit)
  const intervalSeconds =
    interval === '1s'
      ? 1
      : interval === '15s'
        ? 15
        : interval === '1m'
          ? 60
          : interval === '5m'
            ? 300
            : 3600; // 1H
  const MAX_CANDLES_PER_REQUEST = 5000;
  const maxWindowSeconds = MAX_CANDLES_PER_REQUEST * intervalSeconds;

  // Calculate total duration and number of chunks needed
  const durationSeconds = to - from;
  const estimatedCandles = Math.ceil(durationSeconds / intervalSeconds);

  // If we need more than 5000 candles, chunk the requests
  if (estimatedCandles > MAX_CANDLES_PER_REQUEST) {
    logger.debug(
      `Chunking request for ${mint}... (${estimatedCandles} candles estimated, ${Math.ceil(estimatedCandles / MAX_CANDLES_PER_REQUEST)} chunks needed)`
    );

    const allCandles: Candle[] = [];
    let currentFrom = from;

    while (currentFrom < to) {
      // Calculate chunk end time (max 5000 candles worth)
      const chunkTo = Math.min(currentFrom + maxWindowSeconds, to);

      const chunkStartDate = new Date(currentFrom * 1000);
      const chunkEndDate = new Date(chunkTo * 1000);

      const response = await birdeyeClient.fetchOHLCVData(
        mint,
        chunkStartDate,
        chunkEndDate,
        interval,
        normalizedChain
      );

      const chunkCandles = convertBirdeyeResponseToCandles(response);

      if (chunkCandles.length === 0) {
        // No more data available, break
        break;
      }

      allCandles.push(...chunkCandles);

      // Move to next chunk (start from last candle timestamp + 1 interval)
      const lastTimestamp = chunkCandles[chunkCandles.length - 1]?.timestamp;
      if (lastTimestamp) {
        currentFrom = lastTimestamp + intervalSeconds;
      } else {
        currentFrom = chunkTo;
      }

      // Small delay between chunks to avoid rate limits
      if (currentFrom < to) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    // Sort and deduplicate by timestamp
    const uniqueCandles = new Map<number, Candle>();
    for (const candle of allCandles) {
      if (!uniqueCandles.has(candle.timestamp)) {
        uniqueCandles.set(candle.timestamp, candle);
      }
    }

    return Array.from(uniqueCandles.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  // Single request (<= 5000 candles)
  const startDate = new Date(from * 1000);
  const endDate = new Date(to * 1000);
  const response = await birdeyeClient.fetchOHLCVData(
    mint,
    startDate,
    endDate,
    interval,
    normalizedChain
  );
  const candles = convertBirdeyeResponseToCandles(response);

  // Ensure chronological order for all downstream consumers
  return candles.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Fetches candles from Birdeye API with automatic chunking.
 * Exported for use in scripts that need direct access.
 *
 * This is an alias for fetchBirdeyeCandles for backward compatibility.
 */
export async function fetchBirdeyeCandlesDirect(
  mint: string,
  interval: '15s' | '1m' | '5m' | '1H',
  from: number,
  to: number,
  chain: string = 'solana',
  client?: BirdeyeClient
): Promise<Candle[]> {
  return fetchBirdeyeCandles(mint, interval, from, to, chain, client);
}

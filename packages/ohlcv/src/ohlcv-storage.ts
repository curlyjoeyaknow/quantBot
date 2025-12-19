/**
 * OHLCV Storage Service (Offline-Only)
 * =====================================
 *
 * Provides offline candle storage operations. This service does NOT fetch
 * data from APIs - it only stores candles that have already been fetched.
 *
 * All API fetching should happen in @quantbot/ingestion workflows using
 * @quantbot/api-clients, then candles should be stored via this service.
 */

import { DateTime } from 'luxon';
import type { Candle, Chain } from '@quantbot/core';
import { logger } from '@quantbot/utils';
import { getStorageEngine } from '@quantbot/storage';

/**
 * Options for storing candles
 */
export interface StoreCandlesOptions {
  /**
   * Use cache (invalidate cache after storing)
   * @default true
   */
  useCache?: boolean;

  /**
   * Force refresh (currently unused, reserved for future use)
   * @default false
   */
  forceRefresh?: boolean;
}

/**
 * Store candles to ClickHouse via StorageEngine (offline operation)
 *
 * This function does NOT fetch candles from APIs. It only stores candles
 * that have already been fetched. For fetching, use @quantbot/api-clients
 * in @quantbot/ingestion workflows.
 *
 * @param tokenAddress - Token address (full mint address, case-preserved)
 * @param chain - Blockchain name (e.g., 'solana', 'ethereum')
 * @param candles - Array of Candle objects to store
 * @param interval - Candle interval ('1m', '5m', '15m', '1h', etc.)
 * @param options - Storage options
 * @returns Promise that resolves when candles are stored
 *
 * @example
 * ```typescript
 * // In ingestion workflow:
 * const candles = await fetchBirdeyeCandles(mint, '1m', from, to, chain);
 * await storeCandles(mint, chain, candles, '1m');
 * ```
 */
export async function storeCandles(
  tokenAddress: string,
  chain: Chain,
  candles: Candle[],
  interval: '1m' | '5m' | '15m' | '1h' | '15s' | '1H' = '5m',
  options: StoreCandlesOptions = {}
): Promise<void> {
  if (candles.length === 0) {
    logger.debug('No candles to store', {
      token: tokenAddress.substring(0, 20) + '...',
      chain,
      interval,
    });
    return;
  }

  const { useCache = true } = options;

  try {
    const storageEngine = getStorageEngine();
    await storageEngine.storeCandles(tokenAddress, chain, candles, interval);

    logger.debug('Stored candles (offline)', {
      token: tokenAddress.substring(0, 20) + '...',
      chain,
      interval,
      count: candles.length,
      useCache,
    });
  } catch (error) {
    logger.error('Failed to store candles (offline)', error as Error, {
      token: tokenAddress.substring(0, 20) + '...',
      chain,
      interval,
      count: candles.length,
    });
    throw error;
  }
}

/**
 * Store multiple candle sets for different intervals
 *
 * Useful for storing both 1m and 5m candles for the same token.
 *
 * @param tokenAddress - Token address
 * @param chain - Blockchain name
 * @param candleSets - Map of interval to candles
 * @param options - Storage options
 */
export async function storeCandlesMultiInterval(
  tokenAddress: string,
  chain: Chain,
  candleSets: Map<'1m' | '5m' | '15m' | '1h' | '15s' | '1H', Candle[]>,
  options: StoreCandlesOptions = {}
): Promise<void> {
  const promises: Promise<void>[] = [];

  for (const [interval, candles] of candleSets.entries()) {
    if (candles.length > 0) {
      promises.push(storeCandles(tokenAddress, chain, candles, interval, options));
    }
  }

  await Promise.all(promises);

  logger.debug('Stored candles for multiple intervals (offline)', {
    token: tokenAddress.substring(0, 20) + '...',
    chain,
    intervals: Array.from(candleSets.keys()),
    totalCandles: Array.from(candleSets.values()).reduce((sum, candles) => sum + candles.length, 0),
  });
}

/**
 * Check coverage for a given mint, interval, and time range (offline operation)
 *
 * Returns coverage information indicating what data exists in ClickHouse.
 * This is useful for avoiding unnecessary API calls.
 *
 * @param mint - Token mint address
 * @param chain - Blockchain name
 * @param startTime - Start time for coverage check
 * @param endTime - End time for coverage check
 * @param interval - Candle interval to check
 * @returns Coverage information
 */
export async function getCoverage(
  mint: string,
  chain: Chain,
  startTime: Date,
  endTime: Date,
  interval: string = '1m'
): Promise<{
  hasData: boolean;
  candleCount: number;
  coverageRatio: number; // 0.0 to 1.0, ratio of time range covered
  gaps: Array<{ start: Date; end: Date }>; // Time gaps in coverage
}> {
  const storageEngine = getStorageEngine();

  try {
    const startDateTime = DateTime.fromJSDate(startTime);
    const endDateTime = DateTime.fromJSDate(endTime);
    const candles = await storageEngine.getCandles(mint, chain, startDateTime, endDateTime, { interval });

    if (candles.length === 0) {
      return {
        hasData: false,
        candleCount: 0,
        coverageRatio: 0,
        gaps: [{ start: startTime, end: endTime }],
      };
    }

    // Calculate coverage ratio
    const totalSeconds = Math.floor((endTime.getTime() - startTime.getTime()) / 1000);
    const intervalSeconds =
      interval === '1m' ? 60 : interval === '5m' ? 300 : interval === '15s' ? 15 : 3600;
    const expectedCandles = Math.floor(totalSeconds / intervalSeconds);
    const coverageRatio = expectedCandles > 0 ? Math.min(candles.length / expectedCandles, 1.0) : 0;

    // Detect gaps (simplified - just check if we have significantly fewer candles than expected)
    const gaps: Array<{ start: Date; end: Date }> = [];
    if (coverageRatio < 0.8 && candles.length > 0) {
      // If coverage is less than 80%, there are likely gaps
      // For simplicity, report the entire missing range as a gap
      // A more sophisticated implementation would detect specific gaps
      gaps.push({ start: startTime, end: endTime });
    }

    return {
      hasData: true,
      candleCount: candles.length,
      coverageRatio,
      gaps,
    };
  } catch (error) {
    logger.error('Failed to check coverage', error as Error, {
      mint: mint.substring(0, 20),
      chain,
      interval,
    });
    return {
      hasData: false,
      candleCount: 0,
      coverageRatio: 0,
      gaps: [{ start: startTime, end: endTime }],
    };
  }
}

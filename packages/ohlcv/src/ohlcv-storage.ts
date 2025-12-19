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
    const candles = await storageEngine.getCandles(mint, chain, startDateTime, endDateTime, {
      interval,
    });

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
    
    // Minimum required candles: 5000 for each interval
    // This ensures we have enough data for simulation
    const MIN_REQUIRED_CANDLES = 5000;
    const hasMinimumCandles = candles.length >= MIN_REQUIRED_CANDLES;
    
    // Check if candles actually cover the time range (not just count)
    // Sort candles by timestamp to check for gaps
    const sortedCandles = [...candles].sort((a, b) => a.timestamp - b.timestamp);
    const startTimestamp = Math.floor(startTime.getTime() / 1000);
    const endTimestamp = Math.floor(endTime.getTime() / 1000);
    
    // Check if first candle is at or near start time (within 1 interval)
    // Allow some tolerance for rounding/alignment issues, but be strict
    const firstCandleTime = sortedCandles[0]?.timestamp ?? 0;
    const lastCandleTime = sortedCandles[sortedCandles.length - 1]?.timestamp ?? 0;
    // Start: first candle should be at or before start (allow up to 1 interval after for alignment)
    const startsAtBeginning = firstCandleTime <= startTimestamp + intervalSeconds;
    // End: last candle should be at or after end (allow up to 1 interval before for alignment)
    const endsAtEnd = lastCandleTime >= endTimestamp - intervalSeconds;
    
    // Additional check: verify we have candles covering the full range
    // Count how many expected timestamps are actually present
    const expectedTimestamps = new Set<number>();
    for (let ts = startTimestamp; ts <= endTimestamp; ts += intervalSeconds) {
      expectedTimestamps.add(ts);
    }
    
    // Count how many of these expected timestamps we actually have
    const actualTimestamps = new Set<number>();
    for (const candle of sortedCandles) {
      if (candle.timestamp >= startTimestamp && candle.timestamp <= endTimestamp) {
        actualTimestamps.add(candle.timestamp);
      }
    }
    
    // Calculate coverage based on actual timestamp coverage
    const timestampCoverageRatio = expectedTimestamps.size > 0 
      ? actualTimestamps.size / expectedTimestamps.size 
      : 0;
    
    // Calculate actual coverage: count unique timestamps that fall within the range
    const timestampsInRange = new Set<number>();
    for (const candle of sortedCandles) {
      if (candle.timestamp >= startTimestamp && candle.timestamp <= endTimestamp) {
        timestampsInRange.add(candle.timestamp);
      }
    }
    
    // Coverage ratio based on actual timestamps in range
    // Use the more accurate timestamp-based coverage ratio
    const actualCandlesInRange = timestampsInRange.size;
    let coverageRatio = expectedCandles > 0 
      ? Math.min(timestampCoverageRatio, actualCandlesInRange / expectedCandles, 1.0) 
      : 0;
    
    // CRITICAL: If we don't have the minimum required 5000 candles, coverage is insufficient
    // Even if the time range is covered, we need 5000 candles minimum
    // ALWAYS enforce minimum requirement - override coverage ratio if below minimum
    if (!hasMinimumCandles) {
      // Calculate what coverage ratio we actually have based on minimum requirement
      // This ensures coverageRatio is always < 0.95 (below skip threshold) if we don't have 5000 candles
      coverageRatio = candles.length / MIN_REQUIRED_CANDLES; // Will be < 1.0 if candles.length < 5000
      logger.debug('Insufficient candles - below minimum requirement of 5000', {
        mint: mint.substring(0, 20),
        actualCandles: candles.length,
        minRequired: MIN_REQUIRED_CANDLES,
        coverageRatio,
        expectedCandles,
        willSkip: coverageRatio >= 0.95,
      });
    } else {
      // We have 5000+ candles, but still check if they cover the requested time range
      // If time range coverage is less than 95%, reduce ratio
      if (coverageRatio < 0.95) {
        logger.debug('Have 5000+ candles but time range coverage is insufficient', {
          mint: mint.substring(0, 20),
          actualCandles: candles.length,
          coverageRatio,
          expectedCandles,
        });
      }
    }
    
    // If we have the expected count but candles don't cover the range, reduce coverage ratio
    // This handles cases where candles are in the wrong time range
    // Also check timestamp coverage ratio - if it's less than 0.95, we don't have full coverage
    if (candles.length >= expectedCandles && (!startsAtBeginning || !endsAtEnd || timestampCoverageRatio < 0.95)) {
      // Candles exist but don't cover the full range - reduce coverage ratio
      const adjustedRatio = Math.min(actualCandlesInRange / expectedCandles, 0.95); // Cap at 95% if range not covered
      logger.debug('Candles exist but don\'t cover full time range', {
        mint: mint.substring(0, 20),
        expectedCandles,
        actualCandles: candles.length,
        actualCandlesInRange,
        expectedTimestamps: expectedTimestamps.size,
        actualTimestamps: actualTimestamps.size,
        timestampCoverageRatio,
        startsAtBeginning,
        endsAtEnd,
        firstCandleTime: new Date(firstCandleTime * 1000).toISOString(),
        lastCandleTime: new Date(lastCandleTime * 1000).toISOString(),
        startTime: startTime.toISOString(),
        endTime: endTime.toISOString(),
        startTimestamp,
        endTimestamp,
        originalCoverageRatio: coverageRatio,
        adjustedCoverageRatio: adjustedRatio,
      });
      // Use adjusted ratio if it's lower
      const finalCoverageRatio = Math.min(coverageRatio, adjustedRatio);
      
      return {
        hasData: true,
        candleCount: candles.length,
        coverageRatio: finalCoverageRatio,
        gaps: [{ start: startTime, end: endTime }],
      };
    }

    // Log coverage details for debugging
    logger.debug('Coverage calculation', {
      mint: mint.substring(0, 20),
      chain,
      interval,
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      totalSeconds,
      intervalSeconds,
      expectedCandles,
      actualCandles: candles.length,
      actualCandlesInRange,
      expectedTimestamps: expectedTimestamps.size,
      actualTimestamps: actualTimestamps.size,
      timestampCoverageRatio,
      coverageRatio,
      timeRangeHours: (totalSeconds / 3600).toFixed(2),
      startsAtBeginning,
      endsAtEnd,
      firstCandleTime: sortedCandles[0] ? new Date(sortedCandles[0].timestamp * 1000).toISOString() : 'none',
      lastCandleTime: sortedCandles[sortedCandles.length - 1] ? new Date(sortedCandles[sortedCandles.length - 1].timestamp * 1000).toISOString() : 'none',
    });

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

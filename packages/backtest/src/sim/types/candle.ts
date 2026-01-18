/**
 * Candle Type Definitions
 * =======================
 * Core OHLCV candle types for the simulation engine.
 */

import { ValidationError } from '@quantbot/infra/utils';

/**
 * OHLCV candle data structure
 */
export interface Candle {
  /** Unix timestamp in seconds */
  timestamp: number;
  /** Opening price */
  open: number;
  /** Highest price in interval */
  high: number;
  /** Lowest price in interval */
  low: number;
  /** Closing price */
  close: number;
  /** Volume in quote currency */
  volume: number;
}

/**
 * Candle with additional metadata
 */
export interface EnrichedCandle extends Candle {
  /** Candle interval in seconds */
  intervalSeconds: number;
  /** Chain identifier */
  chain: string;
  /** Token address */
  tokenAddress: string;
}

/**
 * Supported candle intervals
 */
export type CandleInterval = '15s' | '1m' | '5m' | '15m' | '1H' | '4H' | '1D';

/**
 * Aggregation interval for derived candles
 */
export type AggregationInterval = '5m' | '15m' | '1H' | '4H' | '1D';

/**
 * Get interval duration in seconds
 */
export function getIntervalSeconds(interval: CandleInterval): number {
  const intervals: Record<CandleInterval, number> = {
    '15s': 15,
    '1m': 60,
    '5m': 300,
    '15m': 900,
    '1H': 3600,
    '4H': 14400,
    '1D': 86400,
  };
  return intervals[interval];
}

/**
 * Check if a candle is valid (no NaN values)
 */
export function isValidCandle(candle: Candle): boolean {
  return (
    !Number.isNaN(candle.timestamp) &&
    !Number.isNaN(candle.open) &&
    !Number.isNaN(candle.high) &&
    !Number.isNaN(candle.low) &&
    !Number.isNaN(candle.close) &&
    !Number.isNaN(candle.volume) &&
    candle.high >= candle.low &&
    candle.high >= candle.open &&
    candle.high >= candle.close &&
    candle.low <= candle.open &&
    candle.low <= candle.close
  );
}

/**
 * Sort candles by timestamp ascending
 */
export function sortCandles(candles: readonly Candle[]): Candle[] {
  return [...candles].sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Deduplicate candles by timestamp
 */
export function deduplicateCandles(candles: readonly Candle[]): Candle[] {
  const seen = new Map<number, Candle>();
  for (const candle of candles) {
    if (!seen.has(candle.timestamp)) {
      seen.set(candle.timestamp, candle);
    }
  }
  return Array.from(seen.values());
}

/**
 * Aggregate candles to a higher timeframe
 * @param candles - Array of candles to aggregate (should be sorted by timestamp)
 * @param interval - Target interval ('1H', '4H', '1D', etc.)
 * @returns Array of aggregated candles
 */
export function aggregateCandles(candles: Candle[], interval: string): Candle[] {
  if (candles.length === 0) {
    return [];
  }

  // Sort candles by timestamp
  const sorted = sortCandles(candles);

  // Get interval in seconds
  const intervalSeconds = getIntervalSeconds(interval as CandleInterval);
  if (intervalSeconds === undefined || intervalSeconds === 0) {
    throw new ValidationError(`Unsupported interval: ${interval}`, { interval });
  }

  const aggregated: Candle[] = [];
  let currentBucket: Candle[] = [];
  let bucketStart = Math.floor(sorted[0].timestamp / intervalSeconds) * intervalSeconds;

  for (const candle of sorted) {
    const candleBucketStart = Math.floor(candle.timestamp / intervalSeconds) * intervalSeconds;

    if (candleBucketStart >= bucketStart + intervalSeconds) {
      // Process current bucket
      if (currentBucket.length > 0) {
        aggregated.push(createAggregatedCandle(currentBucket));
      }

      // Start new bucket
      currentBucket = [candle];
      bucketStart = candleBucketStart;
    } else {
      currentBucket.push(candle);
    }
  }

  // Process last bucket
  if (currentBucket.length > 0) {
    aggregated.push(createAggregatedCandle(currentBucket));
  }

  return aggregated;
}

/**
 * Create aggregated candle from multiple candles
 */
function createAggregatedCandle(candles: Candle[]): Candle {
  const firstCandle = candles[0];
  const lastCandle = candles[candles.length - 1];

  return {
    timestamp: firstCandle.timestamp,
    open: firstCandle.open,
    close: lastCandle.close,
    high: Math.max(...candles.map((c) => c.high)),
    low: Math.min(...candles.map((c) => c.low)),
    volume: candles.reduce((sum, c) => sum + c.volume, 0),
  };
}

/**
 * Candle provider interface for fetching high-resolution candles
 * Used for sub-candle conflict resolution
 * Note: This is different from the CandleProvider in './data/provider'
 * This one is for sub-candle resolution with a simpler interface
 */
export interface SubCandleProvider {
  /**
   * Fetch candles for a specific time range and interval
   *
   * @param params - Fetch parameters
   * @returns Promise resolving to array of candles
   */
  fetchCandles(params: {
    startTime: number;
    endTime: number;
    interval: CandleInterval;
    limit?: number;
  }): Promise<Candle[]>;
}

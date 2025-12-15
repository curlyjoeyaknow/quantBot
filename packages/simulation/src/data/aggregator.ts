/**
 * Candle Aggregation Utilities
 * ============================
 * Functions for aggregating lower-timeframe candles into higher timeframes.
 */

import type { Candle, AggregationInterval } from '../types';

/**
 * Get aggregation interval in seconds
 */
export function getAggregationIntervalSeconds(interval: AggregationInterval): number {
  const intervals: Record<AggregationInterval, number> = {
    '5m': 300,
    '15m': 900,
    '1H': 3600,
    '4H': 14400,
    '1D': 86400,
  };
  return intervals[interval];
}

/**
 * Aggregate lower-timeframe candles into higher-timeframe candles.
 * 
 * @param candles - Input candles (sorted ascending by timestamp)
 * @param interval - Target aggregation interval
 * @returns Aggregated candles
 */
export function aggregateCandles(
  candles: readonly Candle[],
  interval: AggregationInterval
): Candle[] {
  if (candles.length === 0) {
    return [];
  }

  const intervalSeconds = getAggregationIntervalSeconds(interval);
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);

  const aggregated: Candle[] = [];
  let bucketStart = Math.floor(sorted[0].timestamp / intervalSeconds) * intervalSeconds;
  let bucketCandles: Candle[] = [];

  const flushBucket = (): void => {
    if (bucketCandles.length === 0) return;
    
    const first = bucketCandles[0];
    const last = bucketCandles[bucketCandles.length - 1];
    let high = first.high;
    let low = first.low;
    let volume = 0;

    for (const c of bucketCandles) {
      if (c.high > high) high = c.high;
      if (c.low < low) low = c.low;
      volume += c.volume;
    }

    aggregated.push({
      timestamp: bucketStart,
      open: first.open,
      high,
      low,
      close: last.close,
      volume,
    });
  };

  for (const candle of sorted) {
    if (candle.timestamp >= bucketStart + intervalSeconds) {
      flushBucket();
      bucketCandles = [candle];
      bucketStart = Math.floor(candle.timestamp / intervalSeconds) * intervalSeconds;
    } else {
      bucketCandles.push(candle);
    }
  }

  flushBucket();
  return aggregated;
}

/**
 * Fill gaps in candle data with synthetic candles
 * 
 * @param candles - Input candles
 * @param intervalSeconds - Expected interval between candles
 * @returns Candles with gaps filled
 */
export function fillCandleGaps(
  candles: readonly Candle[],
  intervalSeconds: number
): Candle[] {
  if (candles.length < 2) return [...candles];
  
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);
  const filled: Candle[] = [sorted[0]];
  
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const gap = curr.timestamp - prev.timestamp;
    
    // Fill gaps with synthetic candles
    if (gap > intervalSeconds) {
      const numGaps = Math.floor(gap / intervalSeconds) - 1;
      for (let j = 1; j <= numGaps; j++) {
        const syntheticTimestamp = prev.timestamp + (j * intervalSeconds);
        filled.push({
          timestamp: syntheticTimestamp,
          open: prev.close,
          high: prev.close,
          low: prev.close,
          close: prev.close,
          volume: 0,
        });
      }
    }
    
    filled.push(curr);
  }
  
  return filled;
}

/**
 * Slice candles to a specific time range
 * 
 * @param candles - Input candles
 * @param startTime - Start timestamp (Unix seconds)
 * @param endTime - End timestamp (Unix seconds)
 * @returns Filtered candles
 */
export function sliceCandlesByTime(
  candles: readonly Candle[],
  startTime: number,
  endTime: number
): Candle[] {
  return candles.filter(c => c.timestamp >= startTime && c.timestamp <= endTime);
}

/**
 * Get candle at or before a specific timestamp
 * 
 * @param candles - Input candles (sorted ascending)
 * @param timestamp - Target timestamp
 * @returns Candle at or before timestamp, or undefined
 */
export function getCandleAtOrBefore(
  candles: readonly Candle[],
  timestamp: number
): Candle | undefined {
  let result: Candle | undefined;
  
  for (const candle of candles) {
    if (candle.timestamp <= timestamp) {
      result = candle;
    } else {
      break;
    }
  }
  
  return result;
}

/**
 * Get candle at or after a specific timestamp
 * 
 * @param candles - Input candles (sorted ascending)
 * @param timestamp - Target timestamp
 * @returns Candle at or after timestamp, or undefined
 */
export function getCandleAtOrAfter(
  candles: readonly Candle[],
  timestamp: number
): Candle | undefined {
  for (const candle of candles) {
    if (candle.timestamp >= timestamp) {
      return candle;
    }
  }
  return undefined;
}


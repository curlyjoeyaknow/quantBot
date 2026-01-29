/**
 * OHLCV Coverage Validator
 *
 * Validates OHLCV coverage and detects gaps in candle data.
 */

import type { Candle } from '@quantbot/core';

export interface Gap {
  from: string;
  to: string;
  missingCandles: number;
}

export interface CoverageMetrics {
  expectedCandles: number;
  actualCandles: number;
  coveragePercent: number;
  gaps: Gap[];
}

/**
 * Validate OHLCV coverage and detect gaps
 *
 * @param candles - Array of candles (sorted by timestamp)
 * @param interval - Time interval (e.g., '1m', '5m', '15m', '1h')
 * @param dateRange - Expected date range
 * @returns Coverage metrics
 */
export function validateCoverage(
  candles: Candle[],
  interval: string,
  dateRange: { from: string; to: string }
): CoverageMetrics {
  const intervalMs = intervalToMs(interval);
  const startMs = Date.parse(dateRange.from);
  const endMs = Date.parse(dateRange.to);

  // Calculate expected candles
  const expectedCandles = Math.floor((endMs - startMs) / intervalMs) + 1;
  const actualCandles = candles.length;

  // Detect gaps
  const gaps: Gap[] = [];

  if (candles.length === 0) {
    // Entire range is a gap
    gaps.push({
      from: dateRange.from,
      to: dateRange.to,
      missingCandles: expectedCandles,
    });
  } else {
    // Check for gap at the start
    const firstCandleMs = candles[0].timestamp * 1000; // Convert seconds to ms
    if (firstCandleMs > startMs + intervalMs) {
      const missingCandles = Math.floor((firstCandleMs - startMs) / intervalMs);
      gaps.push({
        from: new Date(startMs).toISOString(),
        to: new Date(firstCandleMs).toISOString(),
        missingCandles,
      });
    }

    // Check for gaps between candles
    for (let i = 1; i < candles.length; i++) {
      const prevCandleMs = candles[i - 1].timestamp * 1000;
      const currentCandleMs = candles[i].timestamp * 1000;
      const expectedMs = prevCandleMs + intervalMs;

      if (currentCandleMs > expectedMs) {
        const missingCandles = Math.floor((currentCandleMs - expectedMs) / intervalMs);
        gaps.push({
          from: new Date(expectedMs).toISOString(),
          to: new Date(currentCandleMs).toISOString(),
          missingCandles,
        });
      }
    }

    // Check for gap at the end
    const lastCandleMs = candles[candles.length - 1].timestamp * 1000;
    if (lastCandleMs < endMs - intervalMs) {
      const missingCandles = Math.floor((endMs - lastCandleMs - intervalMs) / intervalMs);
      gaps.push({
        from: new Date(lastCandleMs + intervalMs).toISOString(),
        to: new Date(endMs).toISOString(),
        missingCandles,
      });
    }
  }

  // Calculate coverage percentage
  const coveragePercent = expectedCandles > 0 ? (actualCandles / expectedCandles) * 100 : 0;

  return {
    expectedCandles,
    actualCandles,
    coveragePercent,
    gaps,
  };
}

/**
 * Convert interval string to milliseconds
 *
 * @param interval - Time interval (e.g., '1m', '5m', '15m', '1h')
 * @returns Interval in milliseconds
 */
export function intervalToMs(interval: string): number {
  const intervalMap: Record<string, number> = {
    '1s': 1000,
    '1m': 60 * 1000,
    '5m': 5 * 60 * 1000,
    '15m': 15 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '4h': 4 * 60 * 60 * 1000,
    '1d': 24 * 60 * 60 * 1000,
  };

  const ms = intervalMap[interval];
  if (!ms) {
    throw new Error(`Unsupported interval: ${interval}`);
  }

  return ms;
}

/**
 * Get coverage status based on percentage
 *
 * @param coveragePercent - Coverage percentage (0-100)
 * @returns Status string
 */
export function getCoverageStatus(coveragePercent: number): 'good' | 'partial' | 'poor' {
  if (coveragePercent >= 95) {
    return 'good';
  } else if (coveragePercent >= 80) {
    return 'partial';
  } else {
    return 'poor';
  }
}


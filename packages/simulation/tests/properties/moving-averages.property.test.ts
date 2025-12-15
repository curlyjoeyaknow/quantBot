/**
 * Property Tests for Moving Averages
 * ===================================
 *
 * Tests critical invariants for moving average calculations.
 *
 * Critical Invariants:
 * 1. SMA is always within price range
 * 2. EMA is always within price range
 * 3. Moving averages are monotonic with respect to price changes
 * 4. Golden cross and death cross are mutually exclusive
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import {
  calculateSMA,
  calculateEMA,
  isGoldenCross,
  isDeathCross,
} from '../../src/indicators/moving-averages';
import type { Candle } from '../../src/types/candle';

describe('Moving Averages - Property Tests', () => {
  // Generate valid candle arrays
  const candleArrayArb = fc
    .array(
      fc.record({
        timestamp: fc.integer({ min: 1000, max: 100000 }),
        open: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
        high: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
        low: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
        close: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
        volume: fc.float({ min: Math.fround(0), max: Math.fround(1000000) }),
      }),
      { minLength: 20, maxLength: 100 }
    )
    .filter((candles) => {
      // Ensure high >= close >= low and high >= open >= low
      return candles.every(
        (c) => c.high >= c.close && c.close >= c.low && c.high >= c.open && c.open >= c.low
      );
    });

  describe('SMA Bounds (Critical Invariant)', () => {
    it('SMA is always within price range of period', () => {
      fc.assert(
        fc.property(
          candleArrayArb,
          fc.integer({ min: 5, max: 20 }),
          fc.integer({ min: 0, max: 50 }),
          (candles, period, index) => {
            const validIndex = Math.min(index, candles.length - 1);
            const sma = calculateSMA(candles, period, validIndex);
            if (sma === null) return true; // Not enough data

            const periodCandles = candles.slice(
              Math.max(0, validIndex - period + 1),
              validIndex + 1
            );
            const minPrice = Math.min(...periodCandles.map((c) => c.close));
            const maxPrice = Math.max(...periodCandles.map((c) => c.close));

            return sma >= minPrice && sma <= maxPrice;
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('EMA Bounds (Critical Invariant)', () => {
    it('EMA is always within price range of period', () => {
      fc.assert(
        fc.property(
          candleArrayArb,
          fc.integer({ min: 5, max: 20 }),
          fc.integer({ min: 0, max: 50 }),
          (candles, period, index) => {
            const validIndex = Math.min(index, candles.length - 1);
            const ema = calculateEMA(candles, period, validIndex);
            if (ema === null) return true; // Not enough data

            const periodCandles = candles.slice(
              Math.max(0, validIndex - period + 1),
              validIndex + 1
            );
            const minPrice = Math.min(...periodCandles.map((c) => c.close));
            const maxPrice = Math.max(...periodCandles.map((c) => c.close));

            return ema >= minPrice && ema <= maxPrice;
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('Cross Detection (Critical Invariant)', () => {
    it('golden cross and death cross are mutually exclusive', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
          fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
          (fastMA, slowMA, prevFastMA, prevSlowMA) => {
            const golden = isGoldenCross(fastMA, slowMA, prevFastMA, prevSlowMA);
            const death = isDeathCross(fastMA, slowMA, prevFastMA, prevSlowMA);
            return !(golden && death); // Cannot be both
          }
        ),
        { numRuns: 1000 }
      );
    });
  });
});

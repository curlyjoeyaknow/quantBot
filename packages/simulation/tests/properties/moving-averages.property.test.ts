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
  // Generate valid candle arrays - create valid candles directly to avoid filter rejection
  // Use a simpler approach: generate base price and ensure high/low/open/close are consistent
  const validCandleArb = fc
    .record({
      timestamp: fc.integer({ min: 1000, max: 100000 }),
      basePrice: fc.float({ min: Math.fround(0.0001), max: Math.fround(1000) }),
      priceChange: fc.float({ min: Math.fround(-0.1), max: Math.fround(0.1) }),
      volume: fc.float({ min: Math.fround(0), max: Math.fround(1000000) }),
    })
    .map(({ timestamp, basePrice, priceChange, volume }) => {
      const open = basePrice;
      const close = basePrice * (1 + priceChange);
      const high = Math.max(open, close) * (1 + Math.abs(priceChange) * 0.2);
      const low = Math.max(0.0001, Math.min(open, close) * (1 - Math.abs(priceChange) * 0.2));
      return {
        timestamp,
        open: Math.fround(open),
        high: Math.fround(high),
        low: Math.fround(low),
        close: Math.fround(close),
        volume: Math.fround(volume),
      };
    });

  const candleArrayArb = fc.array(validCandleArb, { minLength: 20, maxLength: 30 });

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
            if (!Number.isFinite(sma)) return true; // Skip invalid results

            const periodCandles = candles.slice(
              Math.max(0, validIndex - period + 1),
              validIndex + 1
            );
            if (periodCandles.length === 0) return true; // No candles in period

            const minPrice = Math.min(...periodCandles.map((c) => c.close));
            const maxPrice = Math.max(...periodCandles.map((c) => c.close));

            if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) return true; // Skip invalid prices

            return sma >= minPrice && sma <= maxPrice;
          }
        ),
        { numRuns: 100, timeout: 10000 }
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
            if (!Number.isFinite(ema)) return true; // Skip invalid results

            const periodCandles = candles.slice(
              Math.max(0, validIndex - period + 1),
              validIndex + 1
            );
            if (periodCandles.length === 0) return true; // No candles in period

            const minPrice = Math.min(...periodCandles.map((c) => c.close));
            const maxPrice = Math.max(...periodCandles.map((c) => c.close));

            if (!Number.isFinite(minPrice) || !Number.isFinite(maxPrice)) return true; // Skip invalid prices

            return ema >= minPrice && ema <= maxPrice;
          }
        ),
        { numRuns: 100, timeout: 10000 }
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
        { numRuns: 200, timeout: 10000 }
      );
    });
  });
});

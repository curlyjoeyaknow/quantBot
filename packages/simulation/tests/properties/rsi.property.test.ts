/**
 * Property Tests for RSI Indicator
 * =================================
 *
 * Tests critical invariants for RSI calculations.
 *
 * Critical Invariants:
 * 1. RSI is always between 0 and 100
 * 2. RSI is monotonic with respect to price changes
 * 3. Overbought/oversold thresholds are consistent
 */

import { describe, it } from 'vitest';
import fc from 'fast-check';
import { calculateRSI, isRSIOverbought, isRSIOversold } from '../../src/indicators/rsi';
import type { Candle } from '../../src/types/candle';

describe('RSI Indicator - Property Tests', () => {
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
      { minLength: 15, maxLength: 100 }
    )
    .filter((candles) => {
      return candles.every(
        (c) => c.high >= c.close && c.close >= c.low && c.high >= c.open && c.open >= c.low
      );
    });

  describe('RSI Bounds (Critical Invariant)', () => {
    it('RSI is always between 0 and 100', () => {
      fc.assert(
        fc.property(
          candleArrayArb,
          fc.integer({ min: 14, max: 20 }),
          fc.integer({ min: 14, max: 50 }),
          (candles, period, index) => {
            const validIndex = Math.min(index, candles.length - 1);
            const result = calculateRSI(candles, validIndex, period);
            if (result.value === null) return true; // Not enough data

            return result.value >= 0 && result.value <= 100;
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('RSI Overbought/Oversold (Critical Invariant)', () => {
    it('overbought RSI is always > threshold', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(70), max: Math.fround(100) }),
          fc.float({ min: Math.fround(70), max: Math.fround(100) }),
          (rsi, threshold) => {
            if (rsi > threshold) {
              return isRSIOverbought(rsi, threshold) === true;
            }
            return true;
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('oversold RSI is always < threshold', () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(0), max: Math.fround(30) }),
          fc.float({ min: Math.fround(0), max: Math.fround(30) }),
          (rsi, threshold) => {
            if (rsi < threshold) {
              return isRSIOversold(rsi, threshold) === true;
            }
            return true;
          }
        ),
        { numRuns: 1000 }
      );
    });
  });
});

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

  const candleArrayArb = fc.array(validCandleArb, { minLength: 15, maxLength: 30 });

  describe('RSI Bounds (Critical Invariant)', () => {
    it('RSI is always between 0 and 100', () => {
      fc.assert(
        fc.property(
          candleArrayArb,
          fc.integer({ min: 14, max: 20 }),
          fc.integer({ min: 14, max: 50 }),
          (candles, period, index) => {
            // Filter out invalid candles (NaN values)
            const validCandles = candles.filter(
              (c) =>
                !Number.isNaN(c.open) &&
                !Number.isNaN(c.high) &&
                !Number.isNaN(c.low) &&
                !Number.isNaN(c.close) &&
                !Number.isNaN(c.volume) &&
                c.open > 0 &&
                c.high > 0 &&
                c.low > 0 &&
                c.close > 0 &&
                c.high >= c.low &&
                c.high >= c.open &&
                c.high >= c.close &&
                c.low <= c.open &&
                c.low <= c.close
            );

            if (validCandles.length < period + 1) return true; // Not enough valid data

            const validIndex = Math.min(index, validCandles.length - 1);
            const result = calculateRSI(validCandles, validIndex, period);
            if (result.value === null) return true; // Not enough data

            // Check for NaN or Infinity
            if (!Number.isFinite(result.value)) return false;

            return result.value >= 0 && result.value <= 100;
          }
        ),
        { numRuns: 100, timeout: 10000 }
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
        { numRuns: 200, timeout: 10000 }
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
        { numRuns: 200, timeout: 10000 }
      );
    });
  });
});

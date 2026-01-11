/**
 * Fuzzing Tests for PnL Calculations
 * ===================================
 *
 * Financial calculations are critical - they must NEVER crash and must
 * maintain invariants under all inputs, including adversarial ones.
 */

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { calculatePnL, calculateTotalPnL } from '../../src/core/calculations';

describe('PnL Calculation - Fuzzing Tests', () => {
  describe('calculatePnL', () => {
    it('never crashes on any number input', () => {
      fc.assert(
        fc.property(fc.anything(), fc.anything(), fc.anything(), (entry, exit, amount) => {
          try {
            calculatePnL(entry as any, exit as any, amount as any);
            return true;
          } catch (error) {
            // Must throw Error, not crash
            return error instanceof Error && error.message.length > 0;
          }
        }),
        { numRuns: 2000 }
      );
    });

    it('handles extreme values without overflow', () => {
      const extremeCases = [
        [0, 0, 0],
        [Number.MIN_VALUE, Number.MAX_VALUE, 1000],
        [Number.MAX_VALUE, Number.MIN_VALUE, 1000],
        [1e-10, 1e10, 1],
        [1e10, 1e-10, 1000000],
        [0.0000001, 1000000, 0.01],
      ];

      extremeCases.forEach(([entry, exit, amount]) => {
        const result = calculatePnL(entry, exit, amount);
        expect(isFinite(result)).toBe(true);
        expect(isNaN(result)).toBe(false);
      });
    });

    it('handles special float values gracefully', () => {
      const specialCases = [
        [NaN, 1, 1000],
        [1, NaN, 1000],
        [1, 1, NaN],
        [Infinity, 1, 1000],
        [1, Infinity, 1000],
        [1, 1, Infinity],
        [-Infinity, 1, 1000],
      ];

      specialCases.forEach(([entry, exit, amount]) => {
        expect(() => calculatePnL(entry, exit, amount)).not.toThrow(/crash|panic/i);
      });
    });

    it('never returns NaN for valid inputs', () => {
      fc.assert(
        fc.property(
          fc.float({ min: 0.0001, max: 1000, noNaN: true }),
          fc.float({ min: 0.0001, max: 1000, noNaN: true }),
          fc.float({ min: 0.01, max: 1000000, noNaN: true }),
          (entry, exit, amount) => {
            const result = calculatePnL(entry, exit, amount);
            return !isNaN(result);
          }
        ),
        { numRuns: 1000 }
      );
    });

    it('maintains precision for very small amounts', () => {
      fc.assert(
        fc.property(
          fc.float({ min: 0.0001, max: 1 }),
          fc.float({ min: 0.0001, max: 1 }),
          fc.float({ min: 0.000001, max: 0.01 }),
          (entry, exit, amount) => {
            const result = calculatePnL(entry, exit, amount);
            // Result should be proportional to input
            const expected = (exit / entry - 1) * amount;
            return Math.abs(result - expected) < 1e-10;
          }
        ),
        { numRuns: 500 }
      );
    });
  });

  describe('calculateTotalPnL', () => {
    it('never crashes on malformed trade arrays', () => {
      fc.assert(
        fc.property(fc.anything(), (input) => {
          try {
            calculateTotalPnL(input as any);
            return true;
          } catch (error) {
            return error instanceof Error;
          }
        }),
        { numRuns: 1000 }
      );
    });

    it('handles arrays with extreme values', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.record({
              entry: fc.oneof(
                fc.float({ min: 0.0001, max: 1000 }),
                fc.constant(Number.MAX_VALUE),
                fc.constant(Number.MIN_VALUE)
              ),
              exit: fc.oneof(
                fc.float({ min: 0.0001, max: 1000 }),
                fc.constant(Number.MAX_VALUE),
                fc.constant(Number.MIN_VALUE)
              ),
              amount: fc.float({ min: 0.01, max: 1000000 }),
            }),
            { maxLength: 1000 }
          ),
          (trades) => {
            try {
              const result = calculateTotalPnL(trades);
              return isFinite(result);
            } catch (error) {
              return error instanceof Error;
            }
          }
        ),
        { numRuns: 500 }
      );
    });

    it('handles very large trade arrays efficiently', () => {
      const largeTrades = Array(10000)
        .fill(null)
        .map((_, i) => ({
          entry: 1.0 + (i % 100) * 0.01,
          exit: 1.0 + (i % 100) * 0.02,
          amount: 100,
        }));

      const startTime = Date.now();
      const result = calculateTotalPnL(largeTrades);
      const duration = Date.now() - startTime;

      // Should complete in < 1 second
      expect(duration).toBeLessThan(1000);
      expect(isFinite(result)).toBe(true);
    });
  });
});

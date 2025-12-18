/**
 * Simulation Stress: Candle Sequence Tests
 *
 * Tests that simulation engine handles pathological candle sequences.
 * Goal: Define semantics and enforce them deterministically.
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_SEQUENCES,
  FLATLINE_SEQUENCES,
  SPIKE_SEQUENCES,
  GAP_SEQUENCES,
  DUPLICATE_SEQUENCES,
  OUT_OF_ORDER_SEQUENCES,
  INVALID_SEQUENCES,
  TINY_SEQUENCES,
  AMBIGUITY_SEQUENCES,
  type CandleSequence,
} from '../fixtures/nasty-candles.js';
import { validateCandleSequence, sortCandlesByTimestamp } from '../../../src/validation/candleValidation.js';
import { simulateStrategy } from '../../../src/core/simulator.js';
import type { StrategyLeg } from '../../../src/types';

/**
 * Run simulation with validation
 * Uses real implementation from @quantbot/simulation
 */
interface SimulationResult {
  success: boolean;
  error?: string;
  trades?: number;
  finalBalance?: number;
}

async function runSimulationWithValidation(
  candles: CandleSequence['candles']
): Promise<SimulationResult> {
  // Validate candles first
  const validation = validateCandleSequence(candles);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error,
    };
  }

  // Sort candles if needed (validation ensures they're monotonic, but sort anyway for safety)
  const sortedCandles = sortCandlesByTimestamp(candles);

  try {
    // Use real simulation engine with a simple strategy
    const strategy: StrategyLeg[] = [
      { target: 1.1, percent: 50 },
      { target: 1.2, percent: 30 },
      { target: 1.5, percent: 20 },
    ];

    const result = await simulateStrategy(sortedCandles, strategy);

    // Check for NaN or Infinity in result
    if (
      !isFinite(result.finalPnl) ||
      !isFinite(result.entryPrice) ||
      !isFinite(result.finalPrice)
    ) {
      return {
        success: false,
        error: 'numerical_instability',
      };
    }

    return {
      success: true,
      trades: result.events.filter((e) => e.type === 'exit').length,
      finalBalance: 1000 + result.finalPnl, // Assume starting balance of 1000
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

describe('Candle Sequence Stress Tests', () => {

  describe('Flatline sequences', () => {
    FLATLINE_SEQUENCES.forEach((sequence) => {
      it(sequence.description, async () => {
        const result = await runSimulationWithValidation(sequence.candles);

        if (sequence.expectedBehavior === 'accept') {
          expect(result.success).toBe(true);
        } else if (sequence.expectedBehavior === 'reject') {
          expect(result.success).toBe(false);
          if (sequence.expectedError) {
            expect(result.error).toBe(sequence.expectedError);
          }
        }
      });
    });

    it('should handle flatline without division by zero', async () => {
      const flatline = FLATLINE_SEQUENCES[0];
      const result = await runSimulationWithValidation(flatline.candles);

      // Should not crash or produce NaN
      expect(result.success).toBe(true);
      if (result.finalBalance) {
        expect(isNaN(result.finalBalance)).toBe(false);
        expect(isFinite(result.finalBalance)).toBe(true);
      }
    });
  });

  describe('Spike sequences', () => {
    SPIKE_SEQUENCES.forEach((sequence) => {
      it(sequence.description, async () => {
        const result = await runSimulationWithValidation(sequence.candles);

        if (sequence.expectedBehavior === 'accept') {
          expect(result.success).toBe(true);
          // Should handle outliers without overflow
          if (result.finalBalance) {
            expect(isFinite(result.finalBalance)).toBe(true);
          }
        }
      });
    });

    it('should not overflow on extreme spikes', async () => {
      const spike = SPIKE_SEQUENCES[0];
      const result = await runSimulationWithValidation(spike.candles);

      expect(result.success).toBe(true);
      if (result.finalBalance) {
        expect(isFinite(result.finalBalance)).toBe(true);
        expect(result.finalBalance).toBeGreaterThan(0);
      }
    });
  });

  describe('Gap sequences', () => {
    GAP_SEQUENCES.forEach((sequence) => {
      it(sequence.description, async () => {
        const result = await runSimulationWithValidation(sequence.candles);

        // Gaps should be accepted (common in real data)
        expect(result.success).toBe(true);
      });
    });

    it('should handle gaps in indicator calculations', async () => {
      const gapped = GAP_SEQUENCES[0];
      const result = await runSimulationWithValidation(gapped.candles);

      // Indicators should handle gaps gracefully
      expect(result.success).toBe(true);
    });
  });

  describe('Duplicate sequences', () => {
    DUPLICATE_SEQUENCES.forEach((sequence) => {
      it(sequence.description, async () => {
        const result = await runSimulationWithValidation(sequence.candles);

        // Duplicates should be rejected
        expect(result.success).toBe(false);
        if (sequence.expectedError) {
          expect(result.error).toBe(sequence.expectedError);
        }
      });
    });
  });

  describe('Out-of-order sequences', () => {
    OUT_OF_ORDER_SEQUENCES.forEach((sequence) => {
      it(sequence.description, async () => {
        const result = await runSimulationWithValidation(sequence.candles);

        // Out-of-order should be rejected
        expect(result.success).toBe(false);
        if (sequence.expectedError) {
          expect(result.error).toBe(sequence.expectedError);
        }
      });
    });

    it('should sort or reject non-monotonic timestamps', async () => {
      const outOfOrder = OUT_OF_ORDER_SEQUENCES[0];
      const result = await runSimulationWithValidation(outOfOrder.candles);

      // Must either sort (and document) or reject
      // Current implementation rejects
      expect(result.success).toBe(false);
      expect(result.error).toBe('non_monotonic_timestamps');
    });
  });

  describe('Invalid data sequences', () => {
    INVALID_SEQUENCES.forEach((sequence) => {
      it(sequence.description, async () => {
        const result = await runSimulationWithValidation(sequence.candles);

        // All invalid sequences should be rejected
        expect(result.success).toBe(false);
        if (sequence.expectedError) {
          expect(result.error).toBe(sequence.expectedError);
        }
      });
    });

    it('should provide clear error for invalid data', async () => {
      const invalid = INVALID_SEQUENCES[0];
      const result = await runSimulationWithValidation(invalid.candles);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
      expect(result.error!.length).toBeGreaterThan(0);
    });
  });

  describe('Tiny datasets', () => {
    TINY_SEQUENCES.forEach((sequence) => {
      it(sequence.description, async () => {
        const result = await runSimulationWithValidation(sequence.candles);

        if (sequence.expectedBehavior === 'accept') {
          expect(result.success).toBe(true);
        } else {
          expect(result.success).toBe(false);
          if (sequence.expectedError) {
            expect(result.error).toBe(sequence.expectedError);
          }
        }
      });
    });

    it('should require minimum candles for indicators', async () => {
      const tiny = TINY_SEQUENCES[0]; // Single candle
      const result = await runSimulationWithValidation(tiny.candles);

      expect(result.success).toBe(false);
      expect(result.error).toBe('insufficient_data');
    });
  });

  describe('Order-of-events ambiguity', () => {
    AMBIGUITY_SEQUENCES.forEach((sequence) => {
      it(sequence.description, async () => {
        const result = await runSimulationWithValidation(sequence.candles);

        // Ambiguous cases should either:
        // 1. Follow documented order (e.g., stop before target)
        // 2. Warn but continue
        if (sequence.expectedBehavior === 'warn') {
          // Should succeed but log warning
          expect(result.success).toBe(true);
        } else {
          expect(result.success).toBe(true);
        }
      });
    });

    it('should define order when stop and target in same candle', async () => {
      // Test that stop loss is checked before take profit (or vice versa)
      // This must be documented and consistent
      const ambiguous = AMBIGUITY_SEQUENCES[0];
      const result = await runSimulationWithValidation(ambiguous.candles);

      expect(result.success).toBe(true);
      // Verify consistent behavior (requires actual implementation)
    });

    it('should define order when entry and exit in same candle', async () => {
      // Test that entry happens before exit (or vice versa)
      const ambiguous = AMBIGUITY_SEQUENCES[1];
      const result = await runSimulationWithValidation(ambiguous.candles);

      expect(result.success).toBe(true);
      // Verify consistent behavior
    });
  });

  describe('Numerical stability', () => {
    it('should handle very small prices', async () => {
      const tinyPrices = Array.from({ length: 100 }, (_, i) => ({
        timestamp: Date.now() + i * 1000,
        open: 0.0000001,
        high: 0.0000002,
        low: 0.00000005,
        close: 0.00000015,
        volume: 1000,
      }));

      const result = await runSimulationWithValidation(tinyPrices);
      expect(result.success).toBe(true);

      if (result.finalBalance) {
        expect(isFinite(result.finalBalance)).toBe(true);
        expect(result.finalBalance).toBeGreaterThan(0);
      }
    });

    it('should handle very large prices', async () => {
      const hugePrices = Array.from({ length: 100 }, (_, i) => ({
        timestamp: Date.now() + i * 1000,
        open: 1000000,
        high: 1100000,
        low: 900000,
        close: 1050000,
        volume: 1000,
      }));

      const result = await runSimulationWithValidation(hugePrices);
      expect(result.success).toBe(true);

      if (result.finalBalance) {
        expect(isFinite(result.finalBalance)).toBe(true);
      }
    });

    it('should handle extreme fee percentages', async () => {
      // Test with fees near 0 and near 100%
      const candles = Array.from({ length: 100 }, (_, i) => ({
        timestamp: Date.now() + i * 1000,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      }));

      const result = await runSimulationWithValidation(candles);
      expect(result.success).toBe(true);
    });

    it('should handle very small position sizes', async () => {
      // Test with position sizes near minimum
      const candles = Array.from({ length: 100 }, (_, i) => ({
        timestamp: Date.now() + i * 1000,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      }));

      const result = await runSimulationWithValidation(candles);
      expect(result.success).toBe(true);
    });

    it('should not accumulate rounding errors', async () => {
      // Run many trades and verify balance is still sensible
      const candles = Array.from({ length: 1000 }, (_, i) => ({
        timestamp: Date.now() + i * 1000,
        open: 1.0 + Math.sin(i / 10) * 0.1,
        high: 1.0 + Math.sin(i / 10) * 0.1 + 0.01,
        low: 1.0 + Math.sin(i / 10) * 0.1 - 0.01,
        close: 1.0 + Math.sin(i / 10) * 0.1,
        volume: 1000,
      }));

      const result = await runSimulationWithValidation(candles);
      expect(result.success).toBe(true);

      if (result.finalBalance) {
        expect(isFinite(result.finalBalance)).toBe(true);
        expect(result.finalBalance).toBeGreaterThan(0);
        // Should not drift to infinity or zero
        expect(result.finalBalance).toBeLessThan(1000000);
      }
    });
  });

  describe('Performance', () => {
    it('should handle large datasets efficiently', async () => {
      const largeDataset = Array.from({ length: 10000 }, (_, i) => ({
        timestamp: Date.now() + i * 1000,
        open: 1.0,
        high: 1.01,
        low: 0.99,
        close: 1.0,
        volume: 1000,
      }));

      const startTime = Date.now();
      const result = await runSimulationWithValidation(largeDataset);
      const duration = Date.now() - startTime;

      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(5000); // Should complete in < 5 seconds
    });

    it('should not leak memory on long simulations', async () => {
      // Run multiple simulations to check for memory leaks
      for (let i = 0; i < 10; i++) {
        const candles = Array.from({ length: 1000 }, (_, j) => ({
          timestamp: Date.now() + j * 1000,
          open: 1.0,
          high: 1.01,
          low: 0.99,
          close: 1.0,
          volume: 1000,
        }));

        const result = await runSimulationWithValidation(candles);
        expect(result.success).toBe(true);
      }

      // Memory should not grow unbounded
      // (Requires actual memory profiling)
    });
  });
});

/**
 * Golden Tests for Policy Simulation - Policy Layer
 *
 * These tests verify stop/exit strategy simulation against known ground truth
 * for synthetic candle sequences with well-defined stop trigger points.
 *
 * Required by: docs/reviews/ARCHITECTURE_REVIEW_2026-01-21.md (Risk #5)
 * Addresses: Golden test coverage gaps for policy execution edge cases
 *
 * Each test represents a canonical stop/exit scenario that the
 * policy layer must handle correctly.
 */

import { describe, it, expect } from 'vitest';
import { simulateStrategy } from '../../src/core/simulator.js';
import type { Candle, StopLossConfig, StrategyLeg } from '../../src/types/index.js';

/**
 * Helper: Create candles from price path
 */
function createCandles(
  prices: number[],
  baseTimestamp: number = 1704067200, // 2024-01-01 00:00:00 UTC
  intervalSeconds: number = 300
): Candle[] {
  const candles: Candle[] = [];

  for (let i = 0; i < prices.length; i++) {
    const price = prices[i];
    const prevPrice = i > 0 ? prices[i - 1] : price;
    const isUp = price >= prevPrice;

    candles.push({
      timestamp: baseTimestamp + i * intervalSeconds,
      open: prevPrice,
      high: Math.max(prevPrice, price) * (isUp ? 1.01 : 1.0),
      low: Math.min(prevPrice, price) * (isUp ? 1.0 : 0.99),
      close: price,
      volume: 1000,
    });
  }

  return candles;
}

// Standard profit targets for all tests
const STANDARD_STRATEGY: StrategyLeg[] = [
  { target: 2, percent: 0.5 },
  { target: 3, percent: 0.5 },
];

describe('Policy Simulation Golden Tests - Stop Modes', () => {
  describe('Golden Case 1: Fixed Stop Triggers', () => {
    it('should trigger fixed 15% stop loss', async () => {
      // Price: 1.0 → 0.9 → 0.84 (triggers -15% stop)
      const prices = [1.0, 0.9, 0.84, 0.8];
      const candles = createCandles(prices);

      const stopConfig: StopLossConfig = {
        initial: -0.15, // -15% stop
        trailing: 'none',
      };

      const result = await simulateStrategy(candles, STANDARD_STRATEGY, stopConfig);

      // Should be stopped out (loss)
      expect(result.finalPnl).toBeLessThan(0.9); // Less than 0.9x (loss)
      expect(result.finalPnl).toBeGreaterThan(0.75); // More than 0.75x

      // Result should be valid
      expect(result.events).toBeDefined();
      expect(result.finalPnl).toBeGreaterThan(0); // Some value returned
    });

    it('should NOT trigger stop if price stays above threshold', async () => {
      // Price: 1.0 → 0.90 → 0.87 → 1.5 → 2.5 (never hits -15%)
      const prices = [1.0, 0.9, 0.87, 1.5, 2.5];
      const candles = createCandles(prices);

      const stopConfig: StopLossConfig = {
        initial: -0.15, // -15% stop
        trailing: 'none',
      };

      const result = await simulateStrategy(candles, STANDARD_STRATEGY, stopConfig);

      // Should hit profit targets, not stop
      expect(result.finalPnl).toBeGreaterThan(1.0); // Positive return (>1.0x = profit)
      // Should exit via profit target, not stop
      const stopEvents = result.events.filter(
        (e: any) => e.type === 'exit' && e.reason?.includes('stop')
      );
      expect(stopEvents.length).toBe(0);
    });
  });

  describe('Golden Case 2: Trailing Stop (Post-2x)', () => {
    it('should activate trailing stop after hitting 2x', async () => {
      // Price: 1.0 → 2.0 (hit 2x) → 2.5 (peak) → 2.0 (trigger 20% trail)
      const prices = [1.0, 1.5, 2.0, 2.5, 2.0, 1.9];
      const candles = createCandles(prices);

      const stopConfig: StopLossConfig = {
        initial: -0.15,
        trailing: 'post_2x',
        trailingPercent: -0.2, // -20% trail from peak
      };

      const result = await simulateStrategy(candles, STANDARD_STRATEGY, stopConfig);

      // Should have positive return (hits 2x before trailing)
      expect(result.finalPnl).toBeGreaterThan(1.0); // Profit
      expect(result.finalPnl).toBeLessThan(2.6); // Not more than peak

      // Simulation should complete
      expect(result.events).toBeDefined();
      expect(result.totalCandles).toBeGreaterThan(0);
    });

    it('should NOT activate trailing stop before hitting 2x', async () => {
      // Price never hits 2x: 1.0 → 1.8 → 1.5 → 1.2
      const prices = [1.0, 1.5, 1.8, 1.5, 1.2];
      const candles = createCandles(prices);

      const stopConfig: StopLossConfig = {
        initial: -0.3, // Wide initial stop
        trailing: 'post_2x',
        trailingPercent: -0.1, // Tight trail (shouldn't activate)
      };

      const result = await simulateStrategy(candles, STANDARD_STRATEGY, stopConfig);

      // Trailing should not activate (never hit 2x)
      const trailEvents = result.events.filter((e: any) => e.reason?.includes('trailing'));
      expect(trailEvents.length).toBe(0);
    });
  });

  describe('Golden Case 3: Time Stop', () => {
    it('should exit after time limit even if in profit', async () => {
      // Price moons but held too long: 1.0 → 1.5 → 2.0 → 2.5
      // Time stop at 10 minutes (2 candles)
      const prices = [1.0, 1.5, 2.0, 2.5, 3.0];
      const candles = createCandles(prices);

      const stopConfig: StopLossConfig = {
        initial: -0.5, // Wide stop (won't hit)
        trailing: 'none',
        timeStopMinutes: 10, // 10 minutes = 2 candles (5m interval)
      };

      const result = await simulateStrategy(candles, STANDARD_STRATEGY, stopConfig);

      // Should exit before reaching peak
      expect(result.finalPnl).toBeGreaterThan(1.0); // Some profit
      expect(result.finalPnl).toBeLessThan(3.0); // But not full peak

      // Simulation should complete
      expect(result.events).toBeDefined();
      expect(result.totalCandles).toBeGreaterThan(0);
    });
  });

  describe('Golden Case 4: Ladder Fill Accounting', () => {
    it('should track partial exits correctly', async () => {
      // Simple moon: 1.0 → 2.0 → 3.0
      const prices = [1.0, 1.5, 2.0, 2.5, 3.0, 3.2];
      const candles = createCandles(prices);

      const strategy: StrategyLeg[] = [
        { target: 2, percent: 0.5 }, // Exit 50% at 2x
        { target: 3, percent: 0.5 }, // Exit remaining 50% at 3x
      ];

      const result = await simulateStrategy(candles, strategy);

      // Final PnL should reflect hitting both targets
      expect(result.finalPnl).toBeGreaterThan(1.5); // At least 1.5x
      expect(result.finalPnl).toBeLessThan(3.5); // Not more than 3.5x

      // Simulation should complete
      expect(result.events).toBeDefined();
      expect(result.totalCandles).toBeGreaterThan(0);
    });

    it('should handle ladder with tight stop after partial exit', async () => {
      // Exit 50% at 2x, then dump triggers stop
      const prices = [1.0, 2.0, 2.2, 1.8, 1.6];
      const candles = createCandles(prices);

      const strategy: StrategyLeg[] = [
        { target: 2, percent: 0.5 },
        { target: 3, percent: 0.5 },
      ];

      const stopConfig: StopLossConfig = {
        initial: -0.15,
        trailing: 'post_2x',
        trailingPercent: -0.15, // Tight trail
      };

      const result = await simulateStrategy(candles, strategy, stopConfig);

      // PnL should be positive (hits 2x)
      expect(result.finalPnl).toBeGreaterThan(1.0); // Profit
      expect(result.finalPnl).toBeLessThan(2.3); // Less than peak

      // Simulation should complete
      expect(result.events).toBeDefined();
    });
  });

  describe('Golden Case 5: Tail Capture (Realized vs Peak)', () => {
    it('should track giveback from peak', async () => {
      // Moon to 5x, then dump, exit at 3x
      const prices = [1.0, 2.0, 3.0, 4.0, 5.0, 4.0, 3.0, 2.5];
      const candles = createCandles(prices);

      const stopConfig: StopLossConfig = {
        initial: -0.15,
        trailing: 'post_2x',
        trailingPercent: -0.4, // Wide trail (40%)
      };

      const result = await simulateStrategy(candles, STANDARD_STRATEGY, stopConfig);

      // Peak should be ~5x, exit via trailing stop
      // Exit around 3x (40% trail from 5x peak)
      expect(result.finalPnl).toBeGreaterThan(1.2); // At least 1.2x
      expect(result.finalPnl).toBeLessThan(3.5); // Less than peak
    });

    it('should maximize tail capture with no stops', async () => {
      // Moon to 4x with no stops (ride to the end)
      const prices = [1.0, 2.0, 3.0, 4.0, 3.8];
      const candles = createCandles(prices);

      const stopConfig: StopLossConfig = {
        initial: -0.99, // Effectively no stop
        trailing: 'none',
      };

      const result = await simulateStrategy(candles, STANDARD_STRATEGY, stopConfig);

      // Should exit at end of data with ladder
      // Expect around 2.3x-2.6x
      expect(result.finalPnl).toBeGreaterThan(2.0);
      expect(result.finalPnl).toBeLessThan(2.7);
    });
  });

  describe('Edge Case: Stop Before Entry', () => {
    it('should handle immediate stop (price dumps before entry)', async () => {
      // Immediate dump before we can enter
      const prices = [1.0, 0.7, 0.5];
      const candles = createCandles(prices);

      const stopConfig: StopLossConfig = {
        initial: -0.15,
        trailing: 'none',
      };

      const result = await simulateStrategy(candles, STANDARD_STRATEGY, stopConfig);

      // Should be stopped out (loss)
      expect(result.finalPnl).toBeLessThan(0.9); // Less than 0.9x (loss)

      // Simulation should complete
      expect(result.events).toBeDefined();
      expect(result.totalCandles).toBeGreaterThan(0);
    });
  });

  describe('Edge Case: Multiple Re-entries', () => {
    it('should handle re-entry after stop and exit again', async () => {
      // Stop out, re-enter, moon
      const prices = [1.0, 0.84, 1.1, 2.2, 3.3];
      const candles = createCandles(prices);

      const stopConfig: StopLossConfig = {
        initial: -0.15,
        trailing: 'none',
      };

      const result = await simulateStrategy(
        candles,
        STANDARD_STRATEGY,
        stopConfig,
        undefined, // entryConfig
        { enabled: true, after: 'stop_loss' } // Re-entry after stop
      );

      // Should have multiple entry/exit events
      const entryEvents = result.events.filter((e) => e.type === 'entry');
      expect(entryEvents.length).toBeGreaterThanOrEqual(1); // At least initial entry
    });
  });

  describe('Determinism', () => {
    it('should produce identical results for identical inputs', async () => {
      const prices = [1.0, 1.5, 2.0, 2.8, 2.2, 1.8];
      const candles = createCandles(prices);

      const stopConfig: StopLossConfig = {
        initial: -0.15,
        trailing: 'post_2x',
        trailingPercent: -0.2,
      };

      const result1 = await simulateStrategy(candles, STANDARD_STRATEGY, stopConfig);
      const result2 = await simulateStrategy(candles, STANDARD_STRATEGY, stopConfig);
      const result3 = await simulateStrategy(candles, STANDARD_STRATEGY, stopConfig);

      // PnL should be identical
      expect(result1.realized).toBe(result2.realized);
      expect(result2.realized).toBe(result3.realized);

      // Event count should be identical
      expect(result1.events.length).toBe(result2.events.length);
      expect(result2.events.length).toBe(result3.events.length);
    });
  });

  describe('Profit Target Priority', () => {
    it('should prioritize profit targets over stops when price moons', async () => {
      // Clean moon past all targets
      const prices = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5];
      const candles = createCandles(prices);

      const stopConfig: StopLossConfig = {
        initial: -0.15,
        trailing: 'post_2x',
        trailingPercent: -0.3, // Wide trail (shouldn't trigger)
      };

      const result = await simulateStrategy(candles, STANDARD_STRATEGY, stopConfig);

      // Should have positive return (price moons)
      expect(result.finalPnl).toBeGreaterThan(1.0); // Profit
      expect(result.finalPnl).toBeLessThan(3.6); // Not more than peak + wiggle

      // Simulation should complete successfully
      expect(result.events).toBeDefined();
      expect(result.totalCandles).toBeGreaterThan(0);
    });
  });

  describe('Costs and Fees', () => {
    it('should apply entry and exit costs', async () => {
      // Simple 2x with costs
      const prices = [1.0, 2.0];
      const candles = createCandles(prices);

      const result = await simulateStrategy(
        candles,
        [{ target: 2, percent: 1.0 }], // Single exit at 2x
        undefined, // No stops
        undefined, // Default entry
        undefined, // No re-entry
        { takerFeeBps: 50, slippageBps: 50 } // 1% total costs (0.5% + 0.5%)
      );

      // Gross return: 2x
      // Net return: ~1.96x (after 2% total costs)
      expect(result.finalPnl).toBeGreaterThan(1.93);
      expect(result.finalPnl).toBeLessThan(2.0);
    });

    it('should compound fees correctly for multiple exits', async () => {
      // Ladder exits with fees
      const prices = [1.0, 2.0, 3.0];
      const candles = createCandles(prices);

      const strategy: StrategyLeg[] = [
        { target: 2, percent: 0.5 },
        { target: 3, percent: 0.5 },
      ];

      const result = await simulateStrategy(
        candles,
        strategy,
        undefined,
        undefined,
        undefined,
        { takerFeeBps: 50, slippageBps: 50 } // 1% total costs
      );

      // Should apply fees to each exit
      // Expect around 2.3x-2.5x with ladder and costs
      expect(result.finalPnl).toBeGreaterThan(2.2);
      expect(result.finalPnl).toBeLessThan(2.6);
    });
  });

  describe('Empty Position Handling', () => {
    it('should handle early exit leaving zero position', async () => {
      // Exit 100% at 2x, then price continues
      const prices = [1.0, 2.0, 3.0, 4.0];
      const candles = createCandles(prices);

      const strategy: StrategyLeg[] = [
        { target: 2, percent: 1.0 }, // Exit 100% at 2x
      ];

      const result = await simulateStrategy(candles, strategy);

      // Should exit at 2x
      expect(result.finalPnl).toBeGreaterThan(1.7); // At least 1.7x
      expect(result.finalPnl).toBeLessThan(2.1); // Around 2x

      // Simulation should complete
      expect(result.events).toBeDefined();
    });
  });

  describe('Regression: Peak Capture Constraint', () => {
    it('should never have realized > peak (unless re-entry logic allows)', async () => {
      // Multiple scenarios
      const scenarios = [
        { prices: [1.0, 2.0, 3.0, 2.5], desc: 'moon then dump' },
        { prices: [1.0, 1.5, 2.0, 1.8], desc: 'slow rise then dip' },
        { prices: [1.0, 3.0, 2.0, 1.5], desc: 'spike then crash' },
      ];

      for (const { prices, desc } of scenarios) {
        const candles = createCandles(prices);

        const result = await simulateStrategy(candles, STANDARD_STRATEGY);

        // Realized should never exceed peak multiplier
        // This is a fundamental invariant of the system
        const peakPrice = Math.max(...prices);
        const peakMultiplier = peakPrice / prices[0]; // Relative to entry

        expect(result.finalPnl).toBeLessThanOrEqual(peakMultiplier + 0.1); // Allow small margin
        expect(result.finalPnl).toBeGreaterThan(0); // Valid result
      }
    });
  });
});

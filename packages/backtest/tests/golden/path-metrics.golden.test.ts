/**
 * Golden Tests for Path Metrics - Truth Layer
 *
 * These tests verify path metrics computation against known ground truth
 * for synthetic candle sequences with well-defined characteristics.
 *
 * Required by: docs/reviews/ARCHITECTURE_REVIEW_2026-01-21.md (Risk #5)
 * Addresses: Golden test coverage gaps for edge cases
 *
 * Each test represents a canonical price movement pattern that the
 * truth layer must handle correctly.
 */

import { describe, it, expect } from 'vitest';
import { computePathMetrics } from '../../src/metrics/path-metrics.js';
import type { Candle } from '@quantbot/core';

/**
 * Helper: Create candles from price path
 * @param prices - Array of prices (close prices for each candle)
 * @param baseTimestamp - Starting timestamp in seconds (will convert to ms internally)
 * @param intervalSeconds - Interval between candles (default 300 = 5m)
 */
function createCandlesFromPrices(
  prices: number[],
  baseTimestamp: number = 1000000000,
  intervalSeconds: number = 300
): Candle[] {
  const candles: Candle[] = [];

  for (let i = 0; i < prices.length; i++) {
    const price = prices[i];
    const prevPrice = i > 0 ? prices[i - 1] : price;

    // Create OHLC with realistic high/low based on direction
    const isUp = price >= prevPrice;
    const open = prevPrice;
    const close = price;
    const high = Math.max(open, close) * (isUp ? 1.01 : 1.0); // Add 1% wick on upside
    const low = Math.min(open, close) * (isUp ? 1.0 : 0.99); // Add 1% wick on downside

    candles.push({
      timestamp: baseTimestamp + i * intervalSeconds,
      open,
      high,
      low,
      close,
      volume: 1000 + i * 100, // Increasing volume
    });
  }

  return candles;
}

describe('Path Metrics Golden Tests - Edge Cases', () => {
  const BASE_TS = 1704067200; // 2024-01-01 00:00:00 UTC (seconds)

  describe('Golden Case 1: Monotonic Up (Clean Moon)', () => {
    it('should correctly track 2x, 3x, 4x milestones', () => {
      // Price path: 1.0 → 1.5 → 2.0 → 2.5 → 3.0 → 3.5 → 4.0 → 4.5 → 5.0 → 5.5
      const prices = [1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0, 4.5, 5.0, 5.5];
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000; // Convert to ms

      const result = computePathMetrics(candles, t0_ms);

      // Expected: clean path to 5.5x
      expect(result.p0).toBe(1.0);
      expect(result.peak_multiple).toBeCloseTo(5.5 * 1.01, 2); // ~5.56 with 1% wick
      expect(result.hit_2x).toBe(true);
      expect(result.hit_3x).toBe(true);
      expect(result.hit_4x).toBe(true);

      // Times should be strictly increasing
      expect(result.t_2x_ms).toBeLessThan(result.t_3x_ms!);
      expect(result.t_3x_ms).toBeLessThan(result.t_4x_ms!);

      // Drawdown should be minimal (only wicks)
      expect(result.dd_bps).toBeGreaterThan(-200); // < 2% drawdown (only wicks)
      expect(result.dd_to_2x_bps).toBeGreaterThan(-200);
    });

    it('should have minimal drawdown on monotonic rise', () => {
      const prices = [1.0, 1.2, 1.5, 1.8, 2.0, 2.3, 2.6, 3.0];
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms);

      // Monotonic up should have minimal drawdown
      expect(result.dd_bps).not.toBeNull();
      expect(result.dd_bps!).toBeGreaterThan(-100); // < 1% drawdown
    });
  });

  describe('Golden Case 2: Monotonic Down (Slow Rug)', () => {
    it('should track downward movement correctly', () => {
      // Price path: 1.0 → 0.9 → 0.8 → 0.7 → 0.6 → 0.5 → 0.4
      const prices = [1.0, 0.9, 0.8, 0.7, 0.6, 0.5, 0.4];
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms);

      // Expected: never hit 2x
      expect(result.p0).toBe(1.0);
      expect(result.hit_2x).toBe(false);
      expect(result.hit_3x).toBe(false);
      expect(result.hit_4x).toBe(false);
      expect(result.t_2x_ms).toBeNull();
      expect(result.t_3x_ms).toBeNull();
      expect(result.t_4x_ms).toBeNull();

      // Peak should be ~1.0 (entry price + wick)
      expect(result.peak_multiple).toBeLessThan(1.1);

      // Drawdown should be severe (-60% = -6000 bps)
      expect(result.dd_bps).not.toBeNull();
      expect(result.dd_bps!).toBeLessThan(-5500); // ~-60% accounting for wicks
    });

    it('should track maximum drawdown', () => {
      const prices = [1.0, 0.95, 0.85, 0.75, 0.6, 0.5];
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms);

      // Should track worst drawdown (to 0.5 = -50% = -5000 bps)
      expect(result.dd_bps).not.toBeNull();
      expect(result.dd_bps!).toBeLessThan(-4800); // ~-50% accounting for wicks
    });
  });

  describe('Golden Case 3: Spike Then Dump (Bull Trap)', () => {
    it('should capture peak but track eventual drawdown', () => {
      // Price path: 1.0 → 2.0 → 3.0 → 4.0 → 5.0 (peak) → 3.0 → 1.5 → 0.8 → 0.5
      const prices = [1.0, 2.0, 3.0, 4.0, 5.0, 3.0, 1.5, 0.8, 0.5];
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms);

      // Expected: hit all milestones, but severe eventual drawdown
      expect(result.hit_2x).toBe(true);
      expect(result.hit_3x).toBe(true);
      expect(result.hit_4x).toBe(true);
      expect(result.peak_multiple).toBeGreaterThan(5.0); // ~5.05 with wick

      // But final drawdown is from 5.0 to 0.5 = -90%
      // Relative to p0=1.0: drawdown to 0.5*0.99 = 0.495 → -50.5%
      expect(result.dd_bps).toBeLessThan(-4900); // Severe final drawdown

      // dd_to_2x should be minimal (before the dump)
      expect(result.dd_to_2x_bps).toBeGreaterThan(-200); // Clean run to 2x
    });

    it('should record milestone times before dump', () => {
      const prices = [1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 2.0, 1.0, 0.5];
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms);

      // Milestones should be recorded early (before dump)
      expect(result.t_2x_ms).toBeLessThan(result.t_3x_ms!);
      expect(result.t_3x_ms).toBeLessThan(result.t_4x_ms!);

      // All milestone times should be in first 5-6 candles
      const dumpStartTime = (BASE_TS + 5 * 300) * 1000;
      expect(result.t_4x_ms!).toBeLessThanOrEqual(dumpStartTime); // Allow exact match
    });
  });

  describe('Golden Case 4: Chop (Sideways Action)', () => {
    it('should handle sideways movement with no clear trend', () => {
      // Price oscillates around 1.0: never hits 2x, stays in range
      const prices = [1.0, 1.1, 0.95, 1.05, 0.9, 1.08, 0.98, 1.02, 0.97, 1.03];
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms);

      // Expected: no milestones hit
      expect(result.hit_2x).toBe(false);
      expect(result.hit_3x).toBe(false);
      expect(result.hit_4x).toBe(false);

      // Peak should be ~1.1 (10% above entry)
      expect(result.peak_multiple).toBeLessThan(1.2);
      expect(result.peak_multiple).toBeGreaterThan(1.05);

      // Drawdown should be ~-10% to -12% (0.9 * 0.99 wick)
      expect(result.dd_bps).toBeGreaterThan(-1300);
      expect(result.dd_bps).toBeLessThan(-800);
    });

    it('should track activity time in choppy market', () => {
      const prices = [1.0, 1.05, 1.08, 1.03, 1.11, 1.02]; // Hits ±10% activity
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms, {
        activity_move_pct: 0.1, // ±10% threshold
      });

      // Should detect activity when price moves ±10%
      expect(result.alert_to_activity_ms).not.toBeNull();
      // Activity at candle 4 (1.11 = +11% from 1.0)
      const expectedActivityTime = (BASE_TS + 4 * 300) * 1000;
      expect(result.alert_to_activity_ms).toBeLessThanOrEqual(expectedActivityTime - t0_ms + 1000);
    });
  });

  describe('Golden Case 5: Late Breakout (Accumulation Phase)', () => {
    it('should handle long consolidation before breakout', () => {
      // Chop for 15 candles, then moon
      const chopPrices = Array(15)
        .fill(0)
        .map((_, i) => 1.0 + (i % 2 === 0 ? 0.05 : -0.05));
      const moonPrices = [1.2, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0];
      const prices = [...chopPrices, ...moonPrices];

      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms);

      // Expected: eventually hits milestones
      expect(result.hit_2x).toBe(true);
      expect(result.hit_3x).toBe(true);
      expect(result.hit_4x).toBe(true);

      // 2x should be reached late (after consolidation)
      const consolidationEndTime = (BASE_TS + 15 * 300) * 1000;
      expect(result.t_2x_ms!).toBeGreaterThan(consolidationEndTime);

      // Peak should be ~5x (last price in sequence)
      // Note: Actual peak depends on last price + wicks
      expect(result.peak_multiple).toBeGreaterThan(4.5); // At least 4.5x

      // Drawdown during chop should be minimal
      expect(result.dd_to_2x_bps).toBeGreaterThan(-1500); // < 15% before 2x
    });

    it('should track time to milestones correctly with delayed breakout', () => {
      // 10 candles of chop, then quick 5x
      const chopPrices = [1.0, 1.05, 0.98, 1.03, 0.97, 1.04, 0.99, 1.02, 0.98, 1.01];
      const breakoutPrices = [1.5, 2.2, 3.1, 4.2, 5.3];
      const prices = [...chopPrices, ...breakoutPrices];

      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms);

      // Time to 2x should be after 10 candles (chop phase)
      const expectedT2xMin = (BASE_TS + 10 * 300) * 1000;
      expect(result.t_2x_ms!).toBeGreaterThan(expectedT2xMin);

      // Time from 2x to 3x should be short (fast breakout)
      const timeFrom2xTo3x = result.t_3x_ms! - result.t_2x_ms!;
      expect(timeFrom2xTo3x).toBeLessThan(5 * 300 * 1000); // < 5 candles
    });
  });

  describe('Golden Case 6: Partial Milestone (Hits 2x, Never 3x)', () => {
    it('should correctly identify partial milestone achievement', () => {
      // Hits 2x, gets close to 3x (2.8x), then dumps
      const prices = [1.0, 1.5, 2.0, 2.3, 2.6, 2.8, 2.5, 2.0, 1.5, 1.0];
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms);

      // Should hit 2x but not 3x
      expect(result.hit_2x).toBe(true);
      expect(result.hit_3x).toBe(false);
      expect(result.hit_4x).toBe(false);

      // Peak should be ~2.8x
      expect(result.peak_multiple).toBeGreaterThan(2.7);
      expect(result.peak_multiple).toBeLessThan(3.0);

      // dd_to_2x should be minimal (before hitting 2x)
      expect(result.dd_to_2x_bps).toBeGreaterThan(-200);
    });
  });

  describe('Golden Case 7: Immediate Dump (No Milestones)', () => {
    it('should handle immediate price collapse', () => {
      // Immediate dump: 1.0 → 0.8 → 0.6 → 0.4 → 0.3
      const prices = [1.0, 0.8, 0.6, 0.4, 0.3];
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms);

      // Expected: no milestones
      expect(result.hit_2x).toBe(false);
      expect(result.hit_3x).toBe(false);
      expect(result.hit_4x).toBe(false);
      expect(result.t_2x_ms).toBeNull();

      // Peak should be at entry (1.0)
      expect(result.peak_multiple).toBeLessThan(1.1);

      // Severe drawdown (-70% = -7000 bps)
      expect(result.dd_bps).toBeLessThan(-6500);
    });
  });

  describe('Golden Case 8: Recovery After Drawdown', () => {
    it('should track drawdown even if price recovers later', () => {
      // Dip to 0.7, then recover to 3x
      const prices = [1.0, 0.9, 0.7, 0.8, 1.2, 1.8, 2.5, 3.2];
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms);

      // Should hit milestones after recovery
      expect(result.hit_2x).toBe(true);
      expect(result.hit_3x).toBe(true);

      // But should remember the drawdown to 0.7
      // 0.7 * 0.99 (wick) = 0.693 → -30.7%
      expect(result.dd_bps).toBeLessThan(-3000); // ~-30%+

      // dd_to_2x should include the dip
      expect(result.dd_to_2x_bps).toBeLessThan(-3000);
    });
  });

  describe('Edge Case: Empty Candles', () => {
    it('should handle empty candle array gracefully', () => {
      const candles: Candle[] = [];
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms);

      // Should return NaN for p0
      expect(result.p0).toBeNaN();
      expect(result.hit_2x).toBe(false);
      expect(result.peak_multiple).toBeNull();
    });
  });

  describe('Edge Case: Anchor After Last Candle', () => {
    it('should handle t0 after all candles (no anchor found)', () => {
      const prices = [1.0, 1.5, 2.0];
      const candles = createCandlesFromPrices(prices, BASE_TS - 10000); // Candles end before alert
      const t0_ms = BASE_TS * 1000; // Alert 10,000 seconds AFTER last candle

      const result = computePathMetrics(candles, t0_ms);

      // Should return NaN for p0 (no candle at/after t0)
      expect(result.p0).toBeNaN();
      expect(result.hit_2x).toBe(false);
      expect(result.peak_multiple).toBeNull();
    });

    it('should find anchor when t0 is before first candle', () => {
      // This is the NORMAL case: alert comes, then we fetch candles after
      const prices = [1.0, 1.5, 2.0];
      const candles = createCandlesFromPrices(prices, BASE_TS + 100); // Candles start 100s after alert
      const t0_ms = BASE_TS * 1000; // Alert before candles

      const result = computePathMetrics(candles, t0_ms);

      // Should find first candle as anchor (first at/after t0)
      expect(result.p0).toBe(1.0);
      expect(result.hit_2x).toBe(true); // Reaches 2.0
    });
  });

  describe('Edge Case: Invalid Price (Zero or Negative)', () => {
    it('should handle invalid anchor price gracefully', () => {
      const prices = [0, 1.0, 2.0]; // Invalid p0
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms);

      // Should detect invalid p0
      expect(result.p0).toBe(0);
      expect(result.hit_2x).toBe(false);
      expect(result.peak_multiple).toBeNull();
    });
  });

  describe('Unit Correctness: Milliseconds vs Seconds', () => {
    it('should use milliseconds for all timestamps', () => {
      const prices = [1.0, 1.5, 2.0, 3.0];
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000; // Input in milliseconds

      const result = computePathMetrics(candles, t0_ms);

      // All time outputs should be in milliseconds
      expect(result.t0_ms).toBe(t0_ms);
      if (result.t_2x_ms) {
        expect(result.t_2x_ms).toBeGreaterThan(t0_ms);
        // Should be within reasonable range (not in seconds)
        expect(result.t_2x_ms).toBeLessThan(t0_ms + 100_000_000); // < ~27 hours
      }

      // activity_ms should also be in milliseconds
      if (result.alert_to_activity_ms) {
        expect(result.alert_to_activity_ms).toBeGreaterThan(0);
        expect(result.alert_to_activity_ms).toBeLessThan(100_000_000); // < ~27 hours
      }
    });
  });

  describe('Activity Detection', () => {
    it('should detect first ±10% move as activity', () => {
      // First significant move at candle 3 (+12%)
      const prices = [1.0, 1.02, 1.03, 1.12, 1.15, 1.2];
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms, {
        activity_move_pct: 0.1, // ±10%
      });

      // Activity should be detected at candle 3 (1.12 = +12%)
      expect(result.alert_to_activity_ms).not.toBeNull();
      const expectedActivityTime = (BASE_TS + 3 * 300) * 1000 - t0_ms;
      expect(result.alert_to_activity_ms).toBeGreaterThanOrEqual(0);
      expect(result.alert_to_activity_ms).toBeLessThanOrEqual(expectedActivityTime + 1000);
    });

    it('should detect downward activity (crash)', () => {
      // First significant move is down (-15%)
      const prices = [1.0, 0.98, 0.85, 0.8];
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms, {
        activity_move_pct: 0.1, // ±10%
      });

      // Activity should be detected at candle 2 (0.85 = -15%)
      expect(result.alert_to_activity_ms).not.toBeNull();
      const expectedActivityTime = (BASE_TS + 2 * 300) * 1000 - t0_ms;
      expect(result.alert_to_activity_ms).toBeGreaterThanOrEqual(0);
      expect(result.alert_to_activity_ms).toBeLessThanOrEqual(expectedActivityTime + 1000);
    });
  });

  describe('Drawdown Calculation Correctness', () => {
    it('should calculate drawdown as negative basis points', () => {
      // Simple 50% drawdown case
      const prices = [1.0, 1.2, 1.0, 0.5]; // p0=1.0, low=0.5*0.99
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms);

      // Drawdown: (0.5*0.99 - 1.0) / 1.0 = -0.505 = -50.5%
      expect(result.dd_bps).toBeLessThan(-5000); // Negative means drawdown
      expect(result.dd_bps).toBeGreaterThan(-5200);
    });

    it('should use inclusive window for dd_to_2x by default', () => {
      // Dip before 2x, then hits 2x
      const prices = [1.0, 0.8, 1.5, 2.0, 2.5];
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms, {
        dd_to_2x_inclusive: true,
      });

      // Should include drawdown before 2x
      expect(result.dd_to_2x_bps).not.toBeNull();
      // Dip to 0.8*0.99 = 0.792 → -20.8%
      expect(result.dd_to_2x_bps).toBeLessThan(-2000);
    });
  });

  describe('Determinism', () => {
    it('should produce identical results for identical inputs', () => {
      const prices = [1.0, 1.5, 2.0, 2.8, 3.5, 4.2, 3.0, 2.0, 1.5];
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result1 = computePathMetrics(candles, t0_ms);
      const result2 = computePathMetrics(candles, t0_ms);
      const result3 = computePathMetrics(candles, t0_ms);

      // All results should be identical (byte-for-byte)
      expect(result1).toEqual(result2);
      expect(result2).toEqual(result3);
    });

    it('should produce identical results regardless of candle order (if pre-sorted)', () => {
      const prices = [1.0, 1.5, 2.0, 2.5, 3.0];
      const candles1 = createCandlesFromPrices(prices, BASE_TS);
      const candles2 = [...candles1]; // Copy

      const t0_ms = BASE_TS * 1000;

      const result1 = computePathMetrics(candles1, t0_ms);
      const result2 = computePathMetrics(candles2, t0_ms);

      expect(result1).toEqual(result2);
    });
  });

  describe('Regression: Known Bugs', () => {
    it('should handle candles with high === low (no price movement)', () => {
      // Flat candles (no movement)
      const flatCandles: Candle[] = Array(5)
        .fill(0)
        .map((_, i) => ({
          timestamp: BASE_TS + i * 300,
          open: 1.0,
          high: 1.0,
          low: 1.0,
          close: 1.0,
          volume: 1000,
        }));

      const t0_ms = BASE_TS * 1000;
      const result = computePathMetrics(flatCandles, t0_ms);

      // Should handle gracefully
      expect(result.p0).toBe(1.0);
      expect(result.hit_2x).toBe(false);
      expect(result.peak_multiple).toBeCloseTo(1.0, 2);
      expect(result.dd_bps).toBeCloseTo(0, 1); // No drawdown
    });

    it('should handle very small price movements (precision)', () => {
      // Tiny movements near entry
      const prices = [1.0, 1.0001, 1.0002, 0.9999, 1.0001];
      const candles = createCandlesFromPrices(prices, BASE_TS);
      const t0_ms = BASE_TS * 1000;

      const result = computePathMetrics(candles, t0_ms);

      // Should not overflow or underflow
      expect(result.peak_multiple).toBeGreaterThan(0.99);
      expect(result.peak_multiple).toBeLessThan(1.02); // Allow small wick impact
      expect(isFinite(result.dd_bps!)).toBe(true);
    });
  });
});

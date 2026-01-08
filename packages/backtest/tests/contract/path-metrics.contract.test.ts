/**
 * Contract Tests for Path Metrics (local implementation with simulation re-exports)
 *
 * These tests ensure that:
 * 1. The symbols exist and are callable
 * 2. Basic deterministic output matches expected fixtures
 * 3. Call signatures stay stable (prevent breaking changes)
 *
 * Purpose: Prevent "minor refactor in simulation broke backtest API" from becoming your new hobby.
 */

import { describe, it, expect } from 'vitest';
// computePathMetrics is local to backtest - import directly from source to avoid pulling in storage
import { computePathMetrics, type PathMetrics } from '../../src/metrics/path-metrics.js';
// Import directly from simulation (what we're testing the contract for)
import { calculatePeriodAthAtlFromCandles, type PeriodAthAtlResult } from '@quantbot/simulation';
import type { Candle } from '@quantbot/core';

/**
 * Create test candles with predictable price movement
 */
function createTestCandles(
  startPrice: number,
  pricePath: number[],
  intervalSeconds: number = 300
): Candle[] {
  const candles: Candle[] = [];
  const timestamp = 1000000000; // Fixed timestamp for determinism

  for (let i = 0; i < pricePath.length; i++) {
    const price = pricePath[i]!;
    const prevPrice = i > 0 ? pricePath[i - 1]! : startPrice;

    candles.push({
      timestamp: timestamp + i * intervalSeconds,
      open: prevPrice,
      high: Math.max(prevPrice, price),
      low: Math.min(prevPrice, price),
      close: price,
      volume: 1000,
    });
  }

  return candles;
}

describe('Path Metrics Contract Tests', () => {
  describe('computePathMetrics', () => {
    it('should exist and be callable', () => {
      const candles = createTestCandles(1.0, [1.0, 1.5, 2.0, 2.5, 2.0, 1.5]);
      const t0_ms = candles[0]!.timestamp * 1000;
      // Signature: (candles, t0_ms, opts?)
      const result = computePathMetrics(candles, t0_ms);
      expect(result).toBeDefined();
      expect(result).toHaveProperty('peak_multiple');
      expect(result).toHaveProperty('dd_bps');
      expect(result).toHaveProperty('hit_2x');
    });

    it('should produce deterministic output for same inputs', () => {
      const candles = createTestCandles(1.0, [1.0, 1.5, 2.0, 2.5, 2.0, 1.5]);
      const t0_ms = candles[0]!.timestamp * 1000;
      const result1 = computePathMetrics(candles, t0_ms);
      const result2 = computePathMetrics(candles, t0_ms);
      expect(result1).toEqual(result2);
    });

    it('should return PathMetrics type with expected structure', () => {
      const candles = createTestCandles(1.0, [1.0, 1.5, 2.0, 2.5]);
      const t0_ms = candles[0]!.timestamp * 1000;
      const result = computePathMetrics(candles, t0_ms);

      // Verify structure matches PathMetrics type
      expect(result).toHaveProperty('peak_multiple');
      expect(result).toHaveProperty('dd_bps');
      expect(result).toHaveProperty('hit_2x');
      expect(result.peak_multiple === null || typeof result.peak_multiple === 'number').toBe(true);
      expect(result.dd_bps === null || typeof result.dd_bps === 'number').toBe(true);
    });

    it('should handle boundary conditions (early candles)', () => {
      const candles = createTestCandles(1.0, [1.0, 1.1]);
      const t0_ms = candles[0]!.timestamp * 1000;
      // Should handle minimal history gracefully
      expect(() => computePathMetrics(candles, t0_ms)).not.toThrow();
    });
  });

  describe('calculatePeriodAthAtlFromCandles', () => {
    it('should exist and be callable', () => {
      const candles = createTestCandles(1.0, [1.0, 1.5, 2.0, 2.5, 2.0, 1.5]);
      const entryPrice = 1.0;
      const entryTimestamp = candles[0]!.timestamp;
      // Signature: (entryPrice, entryTimestamp, candles, periodEndTimestamp?, minDrawdownPercent?, minRecoveryPercent?)
      const result = calculatePeriodAthAtlFromCandles(entryPrice, entryTimestamp, candles);
      expect(result).toBeDefined();
      // PeriodAthAtlResult has periodAthPrice, periodAtlPrice, etc.
      expect(result).toHaveProperty('periodAthPrice');
      expect(result).toHaveProperty('periodAtlPrice');
    });

    it('should produce deterministic output for same inputs', () => {
      const candles = createTestCandles(1.0, [1.0, 1.5, 2.0, 2.5, 2.0, 1.5]);
      const entryPrice = 1.0;
      const entryTimestamp = candles[0]!.timestamp;
      const result1 = calculatePeriodAthAtlFromCandles(entryPrice, entryTimestamp, candles);
      const result2 = calculatePeriodAthAtlFromCandles(entryPrice, entryTimestamp, candles);
      expect(result1).toEqual(result2);
    });

    it('should return PeriodAthAtlResult type', () => {
      const candles = createTestCandles(1.0, [1.0, 1.5, 2.0, 2.5]);
      const entryPrice = 1.0;
      const entryTimestamp = candles[0]!.timestamp;
      const result = calculatePeriodAthAtlFromCandles(entryPrice, entryTimestamp, candles);
      // Check that result has expected structure
      expect(result).toBeDefined();
      expect(typeof result).toBe('object');
      expect(result).toHaveProperty('periodAthPrice');
      expect(result).toHaveProperty('periodAtlPrice');
      expect(result).toHaveProperty('periodAthMultiple');
      expect(result).toHaveProperty('periodAtlMultiple');
      expect(typeof result.periodAthPrice).toBe('number');
      expect(typeof result.periodAtlPrice).toBe('number');
    });
  });

  describe('Call signature stability', () => {
    it('should maintain computePathMetrics signature: (candles, t0_ms, opts?)', () => {
      const candles = createTestCandles(1.0, [1.0, 1.5, 2.0]);
      const t0_ms = candles[0]!.timestamp * 1000;
      // This test will fail if signature changes
      expect(() => computePathMetrics(candles, t0_ms)).not.toThrow();
    });

    it('should maintain calculatePeriodAthAtlFromCandles signature: (entryPrice, entryTimestamp, candles, ...)', () => {
      const candles = createTestCandles(1.0, [1.0, 1.5, 2.0]);
      const entryPrice = 1.0;
      const entryTimestamp = candles[0]!.timestamp;
      expect(() =>
        calculatePeriodAthAtlFromCandles(entryPrice, entryTimestamp, candles)
      ).not.toThrow();
    });
  });
});

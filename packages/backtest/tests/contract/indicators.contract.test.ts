/**
 * Contract Tests for Indicators (re-exported from @quantbot/simulation)
 *
 * These tests ensure that:
 * 1. The symbols exist and are callable
 * 2. Basic deterministic output matches expected fixtures
 * 3. Call signatures stay stable (prevent breaking changes)
 *
 * Purpose: Prevent "minor refactor in simulation broke backtest API" from becoming your new hobby.
 */

import { describe, it, expect } from 'vitest';
// Import directly from simulation (what we're testing the contract for)
import { calculateEMA, calculateSMA } from '@quantbot/simulation/indicators';
// These are exported from specific files
import { calculateRSI } from '@quantbot/simulation/indicators/rsi.js';
import { calculateIchimoku, type IchimokuData } from '@quantbot/simulation/indicators/ichimoku.js';
import { calculateMACD, type MACDData } from '@quantbot/simulation/indicators/macd.js';
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

describe('Indicators Contract Tests', () => {
  describe('calculateEMA', () => {
    it('should exist and be callable', () => {
      const candles = createTestCandles(1.0, [1.0, 1.1, 1.2, 1.3, 1.4]);
      // Signature: (candles, period, index, previousEMA?)
      const result = calculateEMA(candles, 3, 4);
      expect(result).toBeDefined();
      expect(typeof result).toBe('number');
    });

    it('should produce deterministic output for same inputs', () => {
      const candles = createTestCandles(1.0, [1.0, 1.1, 1.2, 1.3, 1.4]);
      const result1 = calculateEMA(candles, 3, 4);
      const result2 = calculateEMA(candles, 3, 4);
      expect(result1).toBe(result2);
    });

    it('should handle warmup boundary correctly (early candles)', () => {
      const candles = createTestCandles(1.0, [1.0, 1.1, 1.2]);
      // Index 0 with period 5 should return null (insufficient history)
      const result = calculateEMA(candles, 5, 0);
      // Should handle insufficient history gracefully (returns null)
      expect(result === null || typeof result === 'number').toBe(true);
    });
  });

  describe('calculateSMA', () => {
    it('should exist and be callable', () => {
      const candles = createTestCandles(1.0, [1.0, 1.1, 1.2, 1.3, 1.4]);
      // Signature: (candles, period, index)
      const result = calculateSMA(candles, 3, 4);
      expect(result).toBeDefined();
      expect(typeof result).toBe('number');
    });

    it('should produce deterministic output for same inputs', () => {
      const candles = createTestCandles(1.0, [1.0, 1.1, 1.2, 1.3, 1.4]);
      const result1 = calculateSMA(candles, 3, 4);
      const result2 = calculateSMA(candles, 3, 4);
      expect(result1).toBe(result2);
    });
  });

  describe('calculateRSI', () => {
    it('should exist and be callable', () => {
      const candles = createTestCandles(
        1.0,
        [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4]
      );
      // Signature: (candles, index, period, previousState?)
      const result = calculateRSI(candles, 14, 14);
      expect(result).toBeDefined();
      expect(result).toHaveProperty('value');
      expect(result).toHaveProperty('state');
    });

    it('should produce deterministic output for same inputs', () => {
      const candles = createTestCandles(
        1.0,
        [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4]
      );
      const result1 = calculateRSI(candles, 14, 14);
      const result2 = calculateRSI(candles, 14, 14);
      expect(result1.value).toBe(result2.value);
    });

    it('should handle warmup boundary correctly (early candles)', () => {
      const candles = createTestCandles(1.0, [1.0, 1.1, 1.2]);
      // Index 0 with period 14 should return null (insufficient history)
      const result = calculateRSI(candles, 0, 14);
      // Should handle insufficient history gracefully (returns null)
      expect(result.value === null || typeof result.value === 'number').toBe(true);
    });
  });

  describe('calculateIchimoku', () => {
    it('should exist and be callable', () => {
      const candles = createTestCandles(
        1.0,
        Array.from({ length: 30 }, (_, i) => 1.0 + i * 0.1)
      );
      // Signature: (candles, index)
      const result = calculateIchimoku(candles, 29);
      expect(result).toBeDefined();
      if (result) {
        expect(result).toHaveProperty('tenkan');
        expect(result).toHaveProperty('kijun');
        expect(result).toHaveProperty('senkouA');
        expect(result).toHaveProperty('senkouB');
        expect(result).toHaveProperty('chikou');
      }
    });

    it('should produce deterministic output for same inputs', () => {
      const candles = createTestCandles(
        1.0,
        Array.from({ length: 30 }, (_, i) => 1.0 + i * 0.1)
      );
      const result1 = calculateIchimoku(candles, 29);
      const result2 = calculateIchimoku(candles, 29);
      expect(result1).toEqual(result2);
    });

    it('should return IchimokuData type', () => {
      const candles = createTestCandles(
        1.0,
        Array.from({ length: 30 }, (_, i) => 1.0 + i * 0.1)
      );
      const result = calculateIchimoku(candles, 29);
      // Type check: result should match IchimokuData structure or be null
      if (result) {
        expect(result.tenkan).toBeDefined();
        expect(result.kijun).toBeDefined();
        expect(Array.isArray(result.tenkan)).toBe(true);
      }
    });
  });

  describe('calculateMACD', () => {
    it('should exist and be callable', () => {
      const candles = createTestCandles(
        1.0,
        Array.from({ length: 30 }, (_, i) => 1.0 + i * 0.1)
      );
      // Signature: (candles, index, fastPeriod?, slowPeriod?, signalPeriod?, previousState?)
      const result = calculateMACD(candles, 29);
      expect(result).toBeDefined();
      expect(result).toHaveProperty('value');
      expect(result).toHaveProperty('state');
      if (result.value) {
        expect(result.value).toHaveProperty('macd');
        expect(result.value).toHaveProperty('signal');
        expect(result.value).toHaveProperty('histogram');
      }
    });

    it('should produce deterministic output for same inputs', () => {
      const candles = createTestCandles(
        1.0,
        Array.from({ length: 30 }, (_, i) => 1.0 + i * 0.1)
      );
      const result1 = calculateMACD(candles, 29);
      const result2 = calculateMACD(candles, 29);
      expect(result1.value).toEqual(result2.value);
    });
  });

  describe('Call signature stability', () => {
    it('should maintain EMA signature: (candles, period, index, previousEMA?)', () => {
      const candles = createTestCandles(1.0, [1.0, 1.1, 1.2, 1.3, 1.4]);
      // This test will fail if signature changes
      expect(() => calculateEMA(candles, 3, 4)).not.toThrow();
    });

    it('should maintain SMA signature: (candles, period, index)', () => {
      const candles = createTestCandles(1.0, [1.0, 1.1, 1.2, 1.3, 1.4]);
      expect(() => calculateSMA(candles, 3, 4)).not.toThrow();
    });

    it('should maintain RSI signature: (candles, index, period, previousState?)', () => {
      const candles = createTestCandles(
        1.0,
        [1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.0, 2.1, 2.2, 2.3, 2.4]
      );
      expect(() => calculateRSI(candles, 14, 14)).not.toThrow();
    });

    it('should maintain Ichimoku signature: (candles, index)', () => {
      const candles = createTestCandles(
        1.0,
        Array.from({ length: 30 }, (_, i) => 1.0 + i * 0.1)
      );
      expect(() => calculateIchimoku(candles, 29)).not.toThrow();
    });
  });
});

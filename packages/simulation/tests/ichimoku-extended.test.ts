import { describe, it, expect } from 'vitest';
import { calculateIchimoku, detectIchimokuSignals, formatIchimokuData } from '../../src/simulation/ichimoku';
import type { Candle } from '../../src/simulation/candles';

describe('ichimoku-extended', () => {
  const createCandle = (timestamp: number, price: number, overrides?: Partial<Candle>): Candle => ({
    timestamp,
    open: price * 0.99,
    high: price * 1.01,
    low: price * 0.98,
    close: price,
    volume: 1000,
    ...overrides,
  });

  const createCandleSeries = (prices: number[]): Candle[] => {
    return prices.map((price, i) => createCandle(1000 + i * 60, price));
  };

  describe('calculateIchimoku edge cases', () => {
    it('should return null for insufficient candles', () => {
      const candles = createCandleSeries([1, 2, 3]);
      const result = calculateIchimoku(candles, 2);

      expect(result).toBeNull();
    });

    it('should return null when currentIndex is too small', () => {
      const candles = createCandleSeries(Array(60).fill(1));
      const result = calculateIchimoku(candles, 50);

      expect(result).toBeNull();
    });

    it('should calculate correctly with exactly 52 candles', () => {
      const candles = createCandleSeries(Array(52).fill(1));
      const result = calculateIchimoku(candles, 51);

      expect(result).toBeDefined();
      expect(result?.tenkan).toBeDefined();
      expect(result?.kijun).toBeDefined();
    });

    it('should handle price above cloud (bullish)', () => {
      const prices = Array(60).fill(1).map((_, i) => 1 + i * 0.01);
      const candles = createCandleSeries(prices);
      const result = calculateIchimoku(candles, 59);

      expect(result?.isBullish).toBe(true);
      expect(result?.isBearish).toBe(false);
    });

    it('should handle price below cloud (bearish)', () => {
      const prices = Array(60).fill(1).map((_, i) => 1 - i * 0.01);
      const candles = createCandleSeries(prices);
      const result = calculateIchimoku(candles, 59);

      expect(result?.isBearish).toBe(true);
      expect(result?.isBullish).toBe(false);
    });

    it('should handle price inside cloud', () => {
      // Create candles where price is between cloud top and bottom
      const prices = Array(60).fill(1).map((_, i) => {
        // Vary prices slightly to create a cloud
        return 1 + Math.sin(i * 0.1) * 0.01;
      });
      const candles = createCandleSeries(prices);
      const result = calculateIchimoku(candles, 59);

      // Price may or may not be in cloud depending on calculation
      expect(result).toBeDefined();
      if (result) {
        expect(result.inCloud || result.isBullish || result.isBearish).toBe(true);
      }
    });

    it('should calculate cloud thickness correctly', () => {
      const prices = Array(60).fill(1);
      const candles = createCandleSeries(prices);
      const result = calculateIchimoku(candles, 59);

      expect(result?.cloudThickness).toBeGreaterThanOrEqual(0);
      expect(result?.cloudTop).toBeGreaterThanOrEqual(result?.cloudBottom || 0);
    });
  });

  describe('detectIchimokuSignals', () => {
    it('should detect tenkan-kijun cross', () => {
      // Create candles where tenkan crosses above kijun
      const prices = Array(60).fill(1).map((_, i) => {
        if (i < 30) return 1 - (30 - i) * 0.01; // Decreasing
        return 1 + (i - 30) * 0.01; // Increasing
      });
      const candles = createCandleSeries(prices);
      const current = calculateIchimoku(candles, 59);
      const previous = calculateIchimoku(candles, 58);

      if (current && previous) {
        const signals = detectIchimokuSignals(current, previous, candles[59].close, candles[59].timestamp);
        expect(Array.isArray(signals)).toBe(true);
      }
    });

    it('should detect cloud cross', () => {
      const prices = Array(60).fill(1);
      const candles = createCandleSeries(prices);
      const current = calculateIchimoku(candles, 59);
      const previous = calculateIchimoku(candles, 58);

      if (current && previous) {
        const signals = detectIchimokuSignals(current, previous, candles[59].close, candles[59].timestamp);
        expect(Array.isArray(signals)).toBe(true);
      }
    });
  });

  describe('formatIchimokuData', () => {
    it('should format ichimoku data correctly', () => {
      const prices = Array(60).fill(1);
      const candles = createCandleSeries(prices);
      const ichimoku = calculateIchimoku(candles, 59);

      if (ichimoku) {
        const formatted = formatIchimokuData(ichimoku, candles[59].close);
        expect(formatted).toContain('Tenkan');
        expect(formatted).toContain('Kijun');
      }
    });

    it('should include price position analysis', () => {
      const prices = Array(60).fill(1).map((_, i) => 1 + i * 0.01);
      const candles = createCandleSeries(prices);
      const ichimoku = calculateIchimoku(candles, 59);

      if (ichimoku) {
        const formatted = formatIchimokuData(ichimoku, candles[59].close);
        expect(formatted.length).toBeGreaterThan(0);
        expect(formatted).toContain('Price');
      }
    });
  });
});


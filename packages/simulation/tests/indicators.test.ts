import { describe, it, expect } from 'vitest';
import {
  calculateSMA,
  calculateEMA,
  calculateMovingAverages,
  calculateIndicators,
  isPriceAboveMA,
  isPriceBelowMA,
  isGoldenCross,
  isDeathCross,
  getBullishSignals,
  getBearishSignals,
} from '../../src/simulation/indicators';
import type { Candle } from '../../src/simulation/candles';

describe('indicators', () => {
  const createCandle = (timestamp: number, close: number, overrides?: Partial<Candle>): Candle => ({
    timestamp,
    open: close * 0.99,
    high: close * 1.01,
    low: close * 0.98,
    close,
    volume: 1000,
    ...overrides,
  });

  const createCandleSeries = (prices: number[]): Candle[] => {
    return prices.map((price, i) => createCandle(1000 + i * 60, price));
  };

  describe('calculateSMA', () => {
    it('should calculate SMA for valid period', () => {
      const candles = createCandleSeries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const sma = calculateSMA(candles, 5, 9);

      expect(sma).toBe(8); // (6+7+8+9+10)/5
    });

    it('should return null for insufficient data', () => {
      const candles = createCandleSeries([1, 2, 3]);
      const sma = calculateSMA(candles, 5, 2);

      expect(sma).toBeNull();
    });

    it('should return null when currentIndex is too small', () => {
      const candles = createCandleSeries([1, 2, 3, 4, 5]);
      const sma = calculateSMA(candles, 5, 2);

      expect(sma).toBeNull();
    });

    it('should handle single value correctly', () => {
      const candles = createCandleSeries([5]);
      const sma = calculateSMA(candles, 1, 0);

      expect(sma).toBe(5);
    });
  });

  describe('calculateEMA', () => {
    it('should calculate EMA with previous EMA', () => {
      const candles = createCandleSeries([1, 2, 3, 4, 5]);
      const previousEMA = 2.5;
      const ema = calculateEMA(candles, 3, 4, previousEMA);

      // EMA formula: (currentPrice - previousEMA) * multiplier + previousEMA
      // multiplier = 2 / (period + 1) = 2 / 4 = 0.5
      // currentPrice = 5
      // (5 - 2.5) * 0.5 + 2.5 = 1.25 + 2.5 = 3.75
      expect(ema).toBeCloseTo(3.75, 2);
    });

    it('should initialize with SMA when no previous EMA', () => {
      const candles = createCandleSeries([1, 2, 3, 4, 5]);
      const ema = calculateEMA(candles, 3, 2);

      // Should initialize with SMA of first 3 values: (1+2+3)/3 = 2
      // Then apply EMA formula: (3 - 2) * 0.5 + 2 = 2.5
      expect(ema).toBeCloseTo(2.5, 1);
    });

    it('should return null for insufficient data', () => {
      const candles = createCandleSeries([1, 2]);
      const ema = calculateEMA(candles, 5, 1);

      expect(ema).toBeNull();
    });

    it('should handle edge case with null previous EMA', () => {
      const candles = createCandleSeries([1, 2, 3, 4, 5]);
      const ema = calculateEMA(candles, 3, 2, null);

      // Should initialize with SMA: (1+2+3)/3 = 2
      // Then apply EMA: (3 - 2) * 0.5 + 2 = 2.5
      expect(ema).toBeCloseTo(2.5, 1);
    });
  });

  describe('calculateMovingAverages', () => {
    it('should calculate all moving averages', () => {
      const candles = createCandleSeries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50]);
      const mas = calculateMovingAverages(candles, 49);

      expect(mas.sma9).toBeCloseTo(46, 0);
      expect(mas.sma20).toBeCloseTo(40.5, 0);
      expect(mas.sma50).toBeCloseTo(25.5, 0);
      expect(mas.ema9).toBeDefined();
      expect(mas.ema20).toBeDefined();
      expect(mas.ema50).toBeDefined();
    });

    it('should use previous EMAs when provided', () => {
      const candles = createCandleSeries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const previousEMAs = { ema9: 5, ema20: null, ema50: null };
      const mas = calculateMovingAverages(candles, 9, previousEMAs);

      expect(mas.ema9).toBeDefined();
    });
  });

  describe('calculateIndicators', () => {
    it('should calculate all indicators including Ichimoku', () => {
      const candles = createCandleSeries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
      const indicators = calculateIndicators(candles, 9);

      expect(indicators.candle).toBeDefined();
      expect(indicators.index).toBe(9);
      expect(indicators.movingAverages).toBeDefined();
      expect(indicators.ichimoku).toBeDefined();
    });
  });

  describe('isPriceAboveMA', () => {
    it('should return true when price is above MA', () => {
      expect(isPriceAboveMA(10, 8)).toBe(true);
    });

    it('should return false when price is below MA', () => {
      expect(isPriceAboveMA(8, 10)).toBe(false);
    });

    it('should return false when MA is null', () => {
      expect(isPriceAboveMA(10, null)).toBe(false);
    });
  });

  describe('isPriceBelowMA', () => {
    it('should return true when price is below MA', () => {
      expect(isPriceBelowMA(8, 10)).toBe(true);
    });

    it('should return false when price is above MA', () => {
      expect(isPriceBelowMA(10, 8)).toBe(false);
    });

    it('should return false when MA is null', () => {
      expect(isPriceBelowMA(8, null)).toBe(false);
    });
  });

  describe('isGoldenCross', () => {
    it('should detect golden cross', () => {
      const result = isGoldenCross(10, 8, 7, 9);

      expect(result).toBe(true);
    });

    it('should return false when no cross occurs', () => {
      const result = isGoldenCross(10, 8, 9, 7);

      expect(result).toBe(false);
    });

    it('should return false with null values', () => {
      expect(isGoldenCross(null, 8, 7, 9)).toBe(false);
      expect(isGoldenCross(10, null, 7, 9)).toBe(false);
      expect(isGoldenCross(10, 8, null, 9)).toBe(false);
      expect(isGoldenCross(10, 8, 7, null)).toBe(false);
    });
  });

  describe('isDeathCross', () => {
    it('should detect death cross', () => {
      const result = isDeathCross(8, 10, 9, 7);

      expect(result).toBe(true);
    });

    it('should return false when no cross occurs', () => {
      const result = isDeathCross(8, 10, 7, 9);

      expect(result).toBe(false);
    });

    it('should return false with null values', () => {
      expect(isDeathCross(null, 10, 9, 7)).toBe(false);
      expect(isDeathCross(8, null, 9, 7)).toBe(false);
      expect(isDeathCross(8, 10, null, 7)).toBe(false);
      expect(isDeathCross(8, 10, 9, null)).toBe(false);
    });
  });

  describe('getBullishSignals', () => {
    it('should return bullish signals', () => {
      const candles = createCandleSeries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
      const indicators = calculateIndicators(candles, 19);
      const prevIndicators = calculateIndicators(candles, 18);

      const signals = getBullishSignals(indicators, prevIndicators);

      expect(Array.isArray(signals)).toBe(true);
    });
  });

  describe('getBearishSignals', () => {
    it('should return bearish signals', () => {
      const candles = createCandleSeries([20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
      const indicators = calculateIndicators(candles, 19);
      const prevIndicators = calculateIndicators(candles, 18);

      const signals = getBearishSignals(indicators, prevIndicators);

      expect(Array.isArray(signals)).toBe(true);
    });
  });
});


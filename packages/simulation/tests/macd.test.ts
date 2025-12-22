/**
 * MACD Indicator Tests
 */

import { describe, it, expect } from 'vitest';
import { calculateMACD, MACDCalculator } from '../src/indicators/macd';
import type { Candle } from '../src/types';

describe('MACD Indicator', () => {
  const createCandle = (timestamp: number, close: number): Candle => ({
    timestamp,
    open: close,
    high: close * 1.01,
    low: close * 0.99,
    close,
    volume: 1000,
  });

  describe('calculateMACD', () => {
    it('should return null for insufficient data', () => {
      const candles = Array.from({ length: 20 }, (_, i) => createCandle(i * 60, 100 + i));

      const result = calculateMACD(candles, 10);
      expect(result.value).toBeNull();
      expect(result.state).toBeNull();
    });

    it('should calculate MACD with default parameters', () => {
      // Create enough candles for MACD (need at least 26 + 9 - 1 = 34)
      const candles = Array.from({ length: 50 }, (_, i) =>
        createCandle(i * 60, 100 + Math.sin(i * 0.1) * 10)
      );

      const result = calculateMACD(candles, 40);
      expect(result.value).not.toBeNull();
      if (result.value) {
        expect(result.value.macd).toBeTypeOf('number');
        expect(result.value.signal).toBeTypeOf('number');
        expect(result.value.histogram).toBeTypeOf('number');
        expect(result.value.isBullish).toBeTypeOf('boolean');
        expect(result.value.isBearish).toBeTypeOf('boolean');
      }
    });

    it('should calculate MACD with custom parameters', () => {
      const candles = Array.from({ length: 50 }, (_, i) => createCandle(i * 60, 100 + i * 0.5));

      const result = calculateMACD(candles, 40, 10, 20, 5);
      expect(result.value).not.toBeNull();
    });

    it('should maintain state across calculations', () => {
      const candles = Array.from({ length: 50 }, (_, i) => createCandle(i * 60, 100 + i * 0.5));

      let state;
      for (let i = 30; i < 40; i++) {
        const result = calculateMACD(candles, i, 12, 26, 9, state);
        if (result.state) {
          state = result.state;
        }
      }

      expect(state).not.toBeUndefined();
      if (state) {
        expect(state.fastEMA).toBeTypeOf('number');
        expect(state.slowEMA).toBeTypeOf('number');
        expect(state.macdLine).toBeTypeOf('number');
      }
    });
  });

  describe('MACDCalculator', () => {
    it('should implement IndicatorCalculator interface', () => {
      const calculator = new MACDCalculator();
      expect(calculator.name).toBe('macd');
      expect(calculator.minCandles()).toBeGreaterThan(0);
    });

    it('should calculate MACD result', () => {
      const calculator = new MACDCalculator();
      const candles = Array.from({ length: 50 }, (_, i) =>
        createCandle(i * 60, 100 + Math.sin(i * 0.1) * 10)
      );

      const result = calculator.calculate(candles, 40);
      expect(result.name).toBe('macd');
      expect(result.fields).toHaveProperty('macd');
      expect(result.fields).toHaveProperty('signal');
      expect(result.fields).toHaveProperty('histogram');
    });

    it('should support configurable parameters', () => {
      const calculator = new MACDCalculator(10, 20, 5);
      expect(calculator.minCandles()).toBe(24); // 20 + 5 - 1
    });

    it('should reset state', () => {
      const calculator = new MACDCalculator();
      const candles = Array.from({ length: 50 }, (_, i) => createCandle(i * 60, 100 + i));

      calculator.calculate(candles, 40);
      calculator.reset();

      // After reset, should recalculate from scratch
      const result = calculator.calculate(candles, 40);
      expect(result).toBeDefined();
    });
  });
});

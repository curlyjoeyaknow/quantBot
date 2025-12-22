import { describe, it, expect } from 'vitest';
import {
  IndicatorRegistry,
  globalIndicatorRegistry,
  calculateIndicators,
  calculateIndicatorSeries,
} from '../../../src/indicators/registry';
import type { Candle } from '../../../src/types/candle';

describe('Indicator Registry', () => {
  const mockCandles: Candle[] = [
    { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
    { timestamp: 2000, open: 1.05, high: 1.2, low: 1.0, close: 1.15, volume: 1200 },
    { timestamp: 3000, open: 1.15, high: 1.3, low: 1.1, close: 1.25, volume: 1500 },
  ];

  describe('IndicatorRegistry', () => {
    it('should register and get calculators', () => {
      const registry = new IndicatorRegistry();
      const sma = registry.get('sma');
      expect(sma).toBeDefined();
      expect(sma?.name).toBe('sma');
    });

    it('should calculate all indicators', () => {
      const registry = new IndicatorRegistry();
      const snapshot = registry.calculateAll(mockCandles, 2);
      expect(snapshot.indicators.size).toBeGreaterThan(0);
      expect(snapshot.candle).toEqual(mockCandles[2]);
    });

    it('should calculate specific indicators', () => {
      const registry = new IndicatorRegistry();
      const snapshot = registry.calculate(['sma', 'ema'], mockCandles, 2);
      expect(snapshot.indicators.size).toBe(2);
    });

    it('should get minimum candles required', () => {
      const registry = new IndicatorRegistry();
      const minCandles = registry.minCandlesRequired();
      expect(minCandles).toBeGreaterThan(0);
    });
  });

  describe('calculateIndicators', () => {
    it('should calculate indicators for a candle', () => {
      const result = calculateIndicators(mockCandles, 2);
      expect(result.candle).toEqual(mockCandles[2]);
      expect(result.movingAverages).toBeDefined();
    });
  });

  describe('calculateIndicatorSeries', () => {
    it('should calculate indicators for all candles', () => {
      const series = calculateIndicatorSeries(mockCandles);
      expect(series.length).toBe(mockCandles.length);
      expect(series[0].candle).toEqual(mockCandles[0]);
    });
  });

  describe('globalIndicatorRegistry', () => {
    it('should be an instance of IndicatorRegistry', () => {
      expect(globalIndicatorRegistry).toBeInstanceOf(IndicatorRegistry);
    });
  });
});

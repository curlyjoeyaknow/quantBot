import { describe, it, expect } from 'vitest';
import {
  aggregateCandles,
  fillCandleGaps,
  sliceCandlesByTime,
  getCandleAtOrBefore,
  getCandleAtOrAfter,
} from '../../../src/data/aggregator';
import type { Candle } from '../../../src/types/candle';

describe('Candle Aggregation', () => {
  const mockCandles: Candle[] = [
    { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
    { timestamp: 1100, open: 1.05, high: 1.15, low: 1.0, close: 1.1, volume: 1200 },
    { timestamp: 1200, open: 1.1, high: 1.2, low: 1.05, close: 1.15, volume: 1500 },
    { timestamp: 1300, open: 1.15, high: 1.25, low: 1.1, close: 1.2, volume: 1800 },
    { timestamp: 1400, open: 1.2, high: 1.3, low: 1.15, close: 1.25, volume: 2000 },
  ];

  describe('aggregateCandles', () => {
    it('should aggregate candles into higher timeframe', () => {
      const aggregated = aggregateCandles(mockCandles, '5m');
      expect(aggregated.length).toBeGreaterThan(0);
      expect(aggregated[0].timestamp).toBeLessThanOrEqual(mockCandles[0].timestamp);
    });

    it('should handle empty array', () => {
      const aggregated = aggregateCandles([], '5m');
      expect(aggregated).toEqual([]);
    });
  });

  describe('fillCandleGaps', () => {
    it('should fill gaps in candle data', () => {
      const candlesWithGap: Candle[] = [
        { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
        { timestamp: 1300, open: 1.15, high: 1.25, low: 1.1, close: 1.2, volume: 1800 },
      ];
      const filled = fillCandleGaps(candlesWithGap, 100);
      expect(filled.length).toBeGreaterThan(candlesWithGap.length);
    });

    it('should not fill if no gaps', () => {
      const filled = fillCandleGaps(mockCandles, 100);
      expect(filled.length).toBe(mockCandles.length);
    });
  });

  describe('sliceCandlesByTime', () => {
    it('should slice candles by time range', () => {
      const sliced = sliceCandlesByTime(mockCandles, 1100, 1300);
      expect(sliced.length).toBe(3);
      expect(sliced[0].timestamp).toBe(1100);
      expect(sliced[sliced.length - 1].timestamp).toBe(1300);
    });

    it('should return empty array if no candles in range', () => {
      const sliced = sliceCandlesByTime(mockCandles, 5000, 6000);
      expect(sliced).toEqual([]);
    });
  });

  describe('getCandleAtOrBefore', () => {
    it('should get candle at or before timestamp', () => {
      const candle = getCandleAtOrBefore(mockCandles, 1150);
      expect(candle).toBeDefined();
      expect(candle?.timestamp).toBeLessThanOrEqual(1150);
    });

    it('should return undefined if no candles before timestamp', () => {
      const candle = getCandleAtOrBefore(mockCandles, 500);
      expect(candle).toBeUndefined();
    });
  });

  describe('getCandleAtOrAfter', () => {
    it('should get candle at or after timestamp', () => {
      const candle = getCandleAtOrAfter(mockCandles, 1150);
      expect(candle).toBeDefined();
      expect(candle?.timestamp).toBeGreaterThanOrEqual(1150);
    });

    it('should return undefined if no candles after timestamp', () => {
      const candle = getCandleAtOrAfter(mockCandles, 5000);
      expect(candle).toBeUndefined();
    });
  });
});


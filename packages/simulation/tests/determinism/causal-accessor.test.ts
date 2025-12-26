/**
 * Causal Candle Accessor Tests
 *
 * Tests for Gate 2 compliance: at simulation time t, only candles with closeTime <= t are accessible.
 */

import { describe, it, expect } from 'vitest';
import type { Candle, CandleInterval } from '../../src/types/candle.js';
import {
  CausalCandleWrapper,
  filterCandlesByCloseTimeInterval,
  getLastClosedCandleInterval,
  getCandleCloseTimeFromInterval,
} from '../../src/types/causal-accessor.js';
import { getIntervalSeconds } from '../../src/types/candle.js';

describe('Causal Candle Accessor', () => {
  const interval: CandleInterval = '5m';
  const intervalSeconds = getIntervalSeconds(interval);

  // Create test candles: timestamps at 0, 300, 600, 900, 1200 (5-minute intervals)
  const testCandles: Candle[] = [
    { timestamp: 0, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
    { timestamp: 300, open: 1.05, high: 1.2, low: 1.0, close: 1.15, volume: 1500 },
    { timestamp: 600, open: 1.15, high: 1.3, low: 1.1, close: 1.25, volume: 2000 },
    { timestamp: 900, open: 1.25, high: 1.4, low: 1.2, close: 1.35, volume: 2500 },
    { timestamp: 1200, open: 1.35, high: 1.5, low: 1.3, close: 1.45, volume: 3000 },
  ];

  describe('getCandleCloseTimeFromInterval', () => {
    it('should calculate close time correctly', () => {
      const candle = testCandles[0];
      const closeTime = getCandleCloseTimeFromInterval(candle, interval);
      expect(closeTime).toBe(candle.timestamp + intervalSeconds);
      expect(closeTime).toBe(300); // 0 + 300
    });
  });

  describe('filterCandlesByCloseTimeInterval', () => {
    it('should only return candles closed at or before simulation time', () => {
      // At time 299, no candles are closed yet
      const result1 = filterCandlesByCloseTimeInterval(testCandles, 299, interval);
      expect(result1).toEqual([]);

      // At time 300, first candle is closed
      const result2 = filterCandlesByCloseTimeInterval(testCandles, 300, interval);
      expect(result2).toEqual([testCandles[0]]);

      // At time 600, first two candles are closed
      const result3 = filterCandlesByCloseTimeInterval(testCandles, 600, interval);
      expect(result3).toEqual([testCandles[0], testCandles[1]]);

      // At time 900, first three candles are closed
      const result4 = filterCandlesByCloseTimeInterval(testCandles, 900, interval);
      expect(result4).toEqual([testCandles[0], testCandles[1], testCandles[2]]);

      // At time 1500, all candles are closed
      const result5 = filterCandlesByCloseTimeInterval(testCandles, 1500, interval);
      expect(result5).toEqual(testCandles);
    });

    it('should never return future candles', () => {
      // Even with a large simulation time, should not return candles that haven't closed yet
      const result = filterCandlesByCloseTimeInterval(testCandles, 599, interval);
      expect(result).toEqual([testCandles[0]]); // Only first candle closed
      expect(result).not.toContain(testCandles[1]); // Second candle not closed yet
    });
  });

  describe('getLastClosedCandleInterval', () => {
    it('should return null when no candles are closed', () => {
      const result = getLastClosedCandleInterval(testCandles, 299, interval);
      expect(result).toBeNull();
    });

    it('should return the last closed candle', () => {
      const result1 = getLastClosedCandleInterval(testCandles, 300, interval);
      expect(result1).toEqual(testCandles[0]);

      const result2 = getLastClosedCandleInterval(testCandles, 600, interval);
      expect(result2).toEqual(testCandles[1]);

      const result3 = getLastClosedCandleInterval(testCandles, 1500, interval);
      expect(result3).toEqual(testCandles[4]); // Last candle
    });
  });

  describe('CausalCandleWrapper', () => {
    it('should implement CausalCandleAccessor interface', () => {
      const wrapper = new CausalCandleWrapper(testCandles, interval);
      expect(wrapper).toBeDefined();
      expect(typeof wrapper.getCandlesAtTime).toBe('function');
      expect(typeof wrapper.getLastClosedCandle).toBe('function');
    });

    it('should only return candles closed at or before simulation time', async () => {
      const wrapper = new CausalCandleWrapper(testCandles, interval);

      // At time 299, no candles closed
      const result1 = await wrapper.getCandlesAtTime('test-mint', 299, 10000, interval);
      expect(result1).toEqual([]);

      // At time 300, first candle closed
      const result2 = await wrapper.getCandlesAtTime('test-mint', 300, 10000, interval);
      expect(result2).toEqual([testCandles[0]]);

      // At time 600, first two candles closed
      const result3 = await wrapper.getCandlesAtTime('test-mint', 600, 10000, interval);
      expect(result3).toEqual([testCandles[0], testCandles[1]]);
    });

    it('should respect lookback window', async () => {
      const wrapper = new CausalCandleWrapper(testCandles, interval);

      // At time 1500, all candles are closed, but lookback of 600 seconds should only return last 2
      const result = await wrapper.getCandlesAtTime('test-mint', 1500, 600, interval);
      // Lookback window: 1500 - 600 = 900, so candles with timestamp >= 900
      expect(result.length).toBeGreaterThan(0);
      expect(result.every((c) => c.timestamp >= 900)).toBe(true);
    });

    it('should return last closed candle correctly', async () => {
      const wrapper = new CausalCandleWrapper(testCandles, interval);

      const result1 = await wrapper.getLastClosedCandle('test-mint', 300, interval);
      expect(result1).toEqual(testCandles[0]);

      const result2 = await wrapper.getLastClosedCandle('test-mint', 600, interval);
      expect(result2).toEqual(testCandles[1]);

      const result3 = await wrapper.getLastClosedCandle('test-mint', 1500, interval);
      expect(result3).toEqual(testCandles[4]);
    });

    it('should return null when no candles are closed', async () => {
      const wrapper = new CausalCandleWrapper(testCandles, interval);
      const result = await wrapper.getLastClosedCandle('test-mint', 299, interval);
      expect(result).toBeNull();
    });
  });

  describe('Gate 2 Compliance', () => {
    it('should never allow access to future candles', async () => {
      const wrapper = new CausalCandleWrapper(testCandles, interval);

      // Simulate at time 600 (second candle just closed)
      const availableCandles = await wrapper.getCandlesAtTime('test-mint', 600, 10000, interval);

      // Should only have first two candles (closed at 300 and 600)
      expect(availableCandles.length).toBe(2);
      expect(availableCandles).not.toContain(testCandles[2]); // Third candle closes at 900
      expect(availableCandles).not.toContain(testCandles[3]); // Fourth candle closes at 1200
      expect(availableCandles).not.toContain(testCandles[4]); // Fifth candle closes at 1500
    });

    it('should enforce causality at exact close time boundaries', async () => {
      const wrapper = new CausalCandleWrapper(testCandles, interval);

      // At exactly 300 (close time of first candle), it should be available
      const result1 = await wrapper.getCandlesAtTime('test-mint', 300, 10000, interval);
      expect(result1).toContainEqual(testCandles[0]);

      // At 299 (just before close), it should NOT be available
      const result2 = await wrapper.getCandlesAtTime('test-mint', 299, 10000, interval);
      expect(result2).not.toContainEqual(testCandles[0]);
    });
  });
});

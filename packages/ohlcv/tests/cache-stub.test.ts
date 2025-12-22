/**
 * Tests for cache-stub.ts
 *
 * Tests cover:
 * - Cache stub functionality
 * - All stub methods return expected values
 */

import { describe, it, expect } from 'vitest';
import { ohlcvCache } from '../src/cache-stub';

describe('ohlcvCache stub', () => {
  const TEST_MINT = '7pXs123456789012345678901234567890pump';
  const startTime = new Date('2024-01-01T00:00:00Z');
  const endTime = new Date('2024-01-02T00:00:00Z');
  const testData = [{ timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 }];

  describe('get', () => {
    it('should always return null (stub behavior)', () => {
      const result = ohlcvCache.get(TEST_MINT, startTime, endTime, '1m');
      expect(result).toBeNull();
    });
  });

  describe('set', () => {
    it('should not throw (no-op stub)', () => {
      expect(() => {
        ohlcvCache.set(TEST_MINT, startTime, endTime, testData, '1m', 60);
      }).not.toThrow();
    });
  });

  describe('clear', () => {
    it('should not throw (no-op stub)', () => {
      expect(() => {
        ohlcvCache.clear();
      }).not.toThrow();
    });
  });

  describe('getStats', () => {
    it('should return zero stats', () => {
      const stats = ohlcvCache.getStats();
      expect(stats).toEqual({
        hits: 0,
        misses: 0,
        size: 0,
      });
    });
  });

  describe('getCacheInfo', () => {
    it('should return default cache info', () => {
      const info = ohlcvCache.getCacheInfo();
      expect(info).toEqual({
        size: 0,
        maxSize: 10000,
      });
    });
  });

  describe('logStats', () => {
    it('should not throw (no-op stub)', () => {
      expect(() => {
        ohlcvCache.logStats();
      }).not.toThrow();
    });
  });

  describe('prefetchForSimulation', () => {
    it('should return empty map (stub behavior)', async () => {
      const fetchFunction = async () => [];
      const result = await ohlcvCache.prefetchForSimulation(
        [TEST_MINT],
        startTime,
        endTime,
        fetchFunction
      );
      expect(result).toBeInstanceOf(Map);
      expect(result.size).toBe(0);
    });
  });
});

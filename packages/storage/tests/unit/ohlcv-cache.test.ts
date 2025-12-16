/**
 * OHLCV Cache Tests
 * ==================
 * Unit tests for OHLCVCache
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DateTime } from 'luxon';
import { OHLCVCache, type OhlcvCacheCandle } from '../../src/cache/ohlcv-cache';

describe('OHLCVCache', () => {
  let cache: OHLCVCache;

  beforeEach(() => {
    cache = new OHLCVCache(100); // Small cache for testing
  });

  describe('constructor', () => {
    it('should create cache with default max size', () => {
      const defaultCache = new OHLCVCache();
      const info = defaultCache.getCacheInfo();
      expect(info.maxSize).toBe(2000);
    });

    it('should create cache with custom max size', () => {
      const customCache = new OHLCVCache(500);
      const info = customCache.getCacheInfo();
      expect(info.maxSize).toBe(500);
    });
  });

  describe('set and get', () => {
    it('should store and retrieve cached data', () => {
      const tokenAddress = 'token1';
      const startTime = DateTime.fromISO('2024-01-01T00:00:00Z').toJSDate();
      const endTime = DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate();
      const data: OhlcvCacheCandle[] = [
        {
          timestamp: 1704067200000,
          open: 1,
          high: 2,
          low: 0.5,
          close: 1.5,
          volume: 1000,
        },
      ];

      cache.set(tokenAddress, startTime, endTime, data, '1m', 5);
      const result = cache.get(tokenAddress, startTime, endTime, '1m');

      expect(result).toEqual(data);
    });

    it('should return null for non-existent cache entry', () => {
      const now = DateTime.now().toJSDate();
      const result = cache.get('nonexistent', now, now);
      expect(result).toBeNull();
    });

    it('should handle different intervals separately', () => {
      const tokenAddress = 'token1';
      const startTime = DateTime.fromISO('2024-01-01T00:00:00Z').toJSDate();
      const endTime = DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate();
      const data1m: OhlcvCacheCandle[] = [
        { timestamp: 1704067200000, open: 1, high: 1, low: 1, close: 1, volume: 100 },
      ];
      const data5m: OhlcvCacheCandle[] = [
        { timestamp: 1704067200000, open: 2, high: 2, low: 2, close: 2, volume: 200 },
      ];

      cache.set(tokenAddress, startTime, endTime, data1m, '1m', 5);
      cache.set(tokenAddress, startTime, endTime, data5m, '5m', 5);

      expect(cache.get(tokenAddress, startTime, endTime, '1m')).toEqual(data1m);
      expect(cache.get(tokenAddress, startTime, endTime, '5m')).toEqual(data5m);
    });

    it('should respect TTL and expire entries', async () => {
      const tokenAddress = 'token1';
      const startTime = DateTime.fromISO('2024-01-01T00:00:00Z').toJSDate();
      const endTime = DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate();
      const data: OhlcvCacheCandle[] = [
        {
          timestamp: 1704067200000,
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 100,
        },
      ];

      cache.set(tokenAddress, startTime, endTime, data, '1m', 0.001); // Very short TTL (0.001 minutes = 60ms)

      // Should be available immediately
      expect(cache.get(tokenAddress, startTime, endTime, '1m')).toEqual(data);

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should be expired
      expect(cache.get(tokenAddress, startTime, endTime, '1m')).toBeNull();
    });
  });

  describe('has', () => {
    it('should return true for existing cache entry', () => {
      const tokenAddress = 'token1';
      const startTime = DateTime.fromISO('2024-01-01T00:00:00Z').toJSDate();
      const endTime = DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate();
      const data: OhlcvCacheCandle[] = [
        {
          timestamp: 1704067200000,
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 100,
        },
      ];

      cache.set(tokenAddress, startTime, endTime, data, '1m', 5);
      expect(cache.has(tokenAddress, startTime, endTime, '1m')).toBe(true);
    });

    it('should return false for non-existent cache entry', () => {
      const now = DateTime.now().toJSDate();
      expect(cache.has('nonexistent', now, now)).toBe(false);
    });
  });

  describe('delete', () => {
    it('should delete existing cache entry', () => {
      const tokenAddress = 'token1';
      const startTime = DateTime.fromISO('2024-01-01T00:00:00Z').toJSDate();
      const endTime = DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate();
      const data: OhlcvCacheCandle[] = [
        {
          timestamp: 1704067200000,
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 100,
        },
      ];

      cache.set(tokenAddress, startTime, endTime, data, '1m', 5);
      expect(cache.delete(tokenAddress, startTime, endTime, '1m')).toBe(true);
      expect(cache.get(tokenAddress, startTime, endTime, '1m')).toBeNull();
    });

    it('should return false when deleting non-existent entry', () => {
      const now = DateTime.now().toJSDate();
      expect(cache.delete('nonexistent', now, now)).toBe(false);
    });
  });

  describe('clear', () => {
    it('should clear all cache entries', () => {
      const tokenAddress = 'token1';
      const startTime = DateTime.fromISO('2024-01-01T00:00:00Z').toJSDate();
      const endTime = DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate();
      const data: OhlcvCacheCandle[] = [
        {
          timestamp: 1704067200000,
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 100,
        },
      ];

      cache.set(tokenAddress, startTime, endTime, data, '1m', 5);
      cache.clear();

      expect(cache.get(tokenAddress, startTime, endTime, '1m')).toBeNull();
      expect(cache.getCacheInfo().size).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should track cache hits and misses', () => {
      const tokenAddress = 'token1';
      const startTime = DateTime.fromISO('2024-01-01T00:00:00Z').toJSDate();
      const endTime = DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate();
      const data: OhlcvCacheCandle[] = [
        {
          timestamp: 1704067200000,
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 100,
        },
      ];

      cache.set(tokenAddress, startTime, endTime, data, '1m', 5);
      cache.get(tokenAddress, startTime, endTime, '1m'); // Hit
      cache.get(tokenAddress, startTime, endTime, '1m'); // Hit
      cache.get('nonexistent', startTime, endTime, '1m'); // Miss

      const stats = cache.getStats();
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeGreaterThan(0);
    });

    it('should track cache sets and deletes', () => {
      const tokenAddress = 'token1';
      const startTime = DateTime.fromISO('2024-01-01T00:00:00Z').toJSDate();
      const endTime = DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate();
      const data: OhlcvCacheCandle[] = [
        {
          timestamp: 1704067200000,
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 100,
        },
      ];

      cache.set(tokenAddress, startTime, endTime, data, '1m', 5);
      cache.set('token2', startTime, endTime, data, '1m', 5);
      cache.delete(tokenAddress, startTime, endTime, '1m');

      const stats = cache.getStats();
      expect(stats.sets).toBe(2);
      expect(stats.deletes).toBe(1);
    });
  });

  describe('getCacheInfo', () => {
    it('should return cache size and utilization', () => {
      const info = cache.getCacheInfo();
      expect(info).toHaveProperty('size');
      expect(info).toHaveProperty('maxSize');
      expect(info).toHaveProperty('utilization');
      expect(info.utilization).toBeGreaterThanOrEqual(0);
      expect(info.utilization).toBeLessThanOrEqual(100);
    });

    it('should update utilization as cache fills', () => {
      const tokenAddress = 'token1';
      const startTime = DateTime.fromISO('2024-01-01T00:00:00Z').toJSDate();
      const endTime = DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate();
      const data: OhlcvCacheCandle[] = [
        {
          timestamp: 1704067200000,
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 100,
        },
      ];

      const initialUtilization = cache.getCacheInfo().utilization;
      cache.set(tokenAddress, startTime, endTime, data, '1m', 5);
      const newUtilization = cache.getCacheInfo().utilization;

      expect(newUtilization).toBeGreaterThan(initialUtilization);
    });
  });

  describe('prefetchForSimulation', () => {
    it('should prefetch data for multiple tokens', async () => {
      const tokens = ['token1', 'token2', 'token3'];
      const startTime = DateTime.fromISO('2024-01-01T00:00:00Z').toJSDate();
      const endTime = DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate();
      const mockFetch = vi.fn(async (token: string) => {
        return [
          {
            timestamp: 1704067200000,
            open: 1,
            high: 1,
            low: 1,
            close: 1,
            volume: 100,
          },
        ];
      });

      const result = await cache.prefetchForSimulation(tokens, startTime, endTime, mockFetch);

      expect(result.size).toBe(3);
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.get('token1')).toBeDefined();
      expect(result.get('token2')).toBeDefined();
      expect(result.get('token3')).toBeDefined();
    });

    it('should use cached data when available', async () => {
      const tokens = ['token1'];
      const startTime = DateTime.fromISO('2024-01-01T00:00:00Z').toJSDate();
      const endTime = DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate();
      const data: OhlcvCacheCandle[] = [
        {
          timestamp: 1704067200000,
          open: 1,
          high: 1,
          low: 1,
          close: 1,
          volume: 100,
        },
      ];

      cache.set(tokens[0], startTime, endTime, data, '1m', 60);
      const mockFetch = vi.fn();

      const result = await cache.prefetchForSimulation(tokens, startTime, endTime, mockFetch);

      expect(result.size).toBe(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should handle fetch errors gracefully', async () => {
      const tokens = ['token1'];
      const startTime = DateTime.fromISO('2024-01-01T00:00:00Z').toJSDate();
      const endTime = DateTime.fromISO('2024-01-02T00:00:00Z').toJSDate();
      const mockFetch = vi.fn().mockRejectedValue(new Error('Fetch error'));

      const result = await cache.prefetchForSimulation(tokens, startTime, endTime, mockFetch);

      expect(result.size).toBe(0);
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OHLCVCache, type CacheEntry } from '../../src/cache/ohlcv-cache';
import type { OHLCVData } from '../../src/storage/influxdb-client';

// Mock logger
vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('OHLCVCache', () => {
  let cache: OHLCVCache;
  const testToken = 'test-token-address';
  const testData: OHLCVData[] = [
    {
      timestamp: new Date('2024-01-01T00:00:00Z'),
      open: 100,
      high: 110,
      low: 95,
      close: 105,
      volume: 1000,
    },
    {
      timestamp: new Date('2024-01-01T00:01:00Z'),
      open: 105,
      high: 115,
      low: 100,
      close: 110,
      volume: 1500,
    },
  ];

  beforeEach(() => {
    cache = new OHLCVCache(100);
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
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

  describe('get', () => {
    it('should return null for non-existent entry', () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');
      const result = cache.get(testToken, startTime, endTime);

      expect(result).toBeNull();
    });

    it('should return cached data when entry exists and is valid', () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      cache.set(testToken, startTime, endTime, testData);
      const result = cache.get(testToken, startTime, endTime);

      expect(result).toEqual(testData);
    });

    it('should return null for expired entry', async () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      cache.set(testToken, startTime, endTime, testData, '1m', 1); // 1 minute TTL

      // Fast-forward past TTL
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);

      const result = cache.get(testToken, startTime, endTime);
      expect(result).toBeNull();
    });

    it('should update stats on cache hit', () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      cache.set(testToken, startTime, endTime, testData);
      cache.get(testToken, startTime, endTime);

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(0);
    });

    it('should update stats on cache miss', () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      cache.get(testToken, startTime, endTime);

      const stats = cache.getStats();
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(1);
    });

    it('should handle different intervals', () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      cache.set(testToken, startTime, endTime, testData, '1m');
      cache.set(testToken, startTime, endTime, testData, '5m');

      const result1m = cache.get(testToken, startTime, endTime, '1m');
      const result5m = cache.get(testToken, startTime, endTime, '5m');

      expect(result1m).toEqual(testData);
      expect(result5m).toEqual(testData);
    });
  });

  describe('set', () => {
    it('should store data in cache', () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      cache.set(testToken, startTime, endTime, testData);

      const result = cache.get(testToken, startTime, endTime);
      expect(result).toEqual(testData);
    });

    it('should update stats on set', () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      cache.set(testToken, startTime, endTime, testData);

      const stats = cache.getStats();
      expect(stats.sets).toBe(1);
    });

    it('should use custom TTL', async () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      cache.set(testToken, startTime, endTime, testData, '1m', 10); // 10 minutes TTL

      // Fast-forward 5 minutes - should still be valid
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000);
      expect(cache.get(testToken, startTime, endTime)).toEqual(testData);

      // Fast-forward another 6 minutes - should be expired
      await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
      expect(cache.get(testToken, startTime, endTime)).toBeNull();
    });
  });

  describe('has', () => {
    it('should return false for non-existent entry', () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      expect(cache.has(testToken, startTime, endTime)).toBe(false);
    });

    it('should return true for existing entry', () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      cache.set(testToken, startTime, endTime, testData);
      expect(cache.has(testToken, startTime, endTime)).toBe(true);
    });
  });

  describe('delete', () => {
    it('should delete existing entry', () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      cache.set(testToken, startTime, endTime, testData);
      const deleted = cache.delete(testToken, startTime, endTime);

      expect(deleted).toBe(true);
      expect(cache.get(testToken, startTime, endTime)).toBeNull();
    });

    it('should return false for non-existent entry', () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      const deleted = cache.delete(testToken, startTime, endTime);
      expect(deleted).toBe(false);
    });

    it('should update stats on delete', () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      cache.set(testToken, startTime, endTime, testData);
      cache.delete(testToken, startTime, endTime);

      const stats = cache.getStats();
      expect(stats.deletes).toBe(1);
    });
  });

  describe('clear', () => {
    it('should clear all cache entries', () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      cache.set(testToken, startTime, endTime, testData);
      cache.clear();

      expect(cache.get(testToken, startTime, endTime)).toBeNull();
      expect(cache.getCacheInfo().size).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return cache statistics', () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      cache.set(testToken, startTime, endTime, testData);
      cache.get(testToken, startTime, endTime);
      cache.get('non-existent', startTime, endTime);

      const stats = cache.getStats();
      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.sets).toBe(1);
      expect(stats.hitRate).toBe(50);
    });

    it('should calculate hit rate correctly', () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      cache.set(testToken, startTime, endTime, testData);
      cache.get(testToken, startTime, endTime); // hit
      cache.get(testToken, startTime, endTime); // hit
      cache.get('other', startTime, endTime); // miss

      const stats = cache.getStats();
      expect(stats.hitRate).toBe((2 / 3) * 100);
    });
  });

  describe('getCacheInfo', () => {
    it('should return cache size information', () => {
      const info = cache.getCacheInfo();
      expect(info).toEqual({
        size: 0,
        maxSize: 100,
        utilization: 0,
      });
    });

    it('should calculate utilization correctly', () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      // Add 10 entries
      for (let i = 0; i < 10; i++) {
        cache.set(`${testToken}-${i}`, startTime, endTime, testData);
      }

      const info = cache.getCacheInfo();
      expect(info.size).toBe(10);
      expect(info.utilization).toBe(10);
    });
  });

  describe('prefetchForSimulation', () => {
    it('should prefetch data for multiple tokens', async () => {
      const tokens = ['token1', 'token2', 'token3'];
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      const fetchFunction = vi.fn().mockImplementation((token: string) => {
        return Promise.resolve([...testData]);
      });

      const results = await cache.prefetchForSimulation(tokens, startTime, endTime, fetchFunction);

      expect(results.size).toBe(3);
      expect(fetchFunction).toHaveBeenCalledTimes(3);
      tokens.forEach((token) => {
        expect(results.has(token)).toBe(true);
        expect(cache.get(token, startTime, endTime)).toEqual(testData);
      });
    });

    it('should use cached data when available', async () => {
      const tokens = ['token1'];
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      // Pre-populate cache
      cache.set('token1', startTime, endTime, testData);

      const fetchFunction = vi.fn();
      const results = await cache.prefetchForSimulation(tokens, startTime, endTime, fetchFunction);

      expect(results.size).toBe(1);
      expect(fetchFunction).not.toHaveBeenCalled();
    });

    it('should handle fetch errors gracefully', async () => {
      const tokens = ['token1', 'token2'];
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      const fetchFunction = vi.fn().mockImplementation((token: string) => {
        if (token === 'token1') {
          return Promise.resolve([...testData]);
        }
        return Promise.reject(new Error('Fetch failed'));
      });

      const results = await cache.prefetchForSimulation(tokens, startTime, endTime, fetchFunction);

      expect(results.size).toBe(1);
      expect(results.has('token1')).toBe(true);
      expect(results.has('token2')).toBe(false);
    });

    it('should handle null fetch results', async () => {
      const tokens = ['token1'];
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      const fetchFunction = vi.fn().mockResolvedValue(null);
      const results = await cache.prefetchForSimulation(tokens, startTime, endTime, fetchFunction);

      expect(results.size).toBe(0);
    });
  });

  describe('logStats', () => {
    it('should log cache statistics', async () => {
      const { logger } = await import('../../src/utils/logger');
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');

      cache.set(testToken, startTime, endTime, testData);
      cache.logStats();

      expect(logger.info).toHaveBeenCalledWith(
        'OHLCV Cache Statistics',
        expect.objectContaining({
          hits: expect.any(Number),
          misses: expect.any(Number),
          sets: expect.any(Number),
          deletes: expect.any(Number),
          hitRate: expect.any(String),
          cacheSize: expect.any(Number),
          maxSize: expect.any(Number),
          utilization: expect.any(String),
        })
      );
    });
  });
});


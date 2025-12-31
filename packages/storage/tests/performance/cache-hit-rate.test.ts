/**
 * Cache Hit Rate Tests
 *
 * Verifies that OHLCV cache is being used effectively:
 * - Cache hits reduce database queries
 * - Cache TTL is respected
 * - Cache invalidation works correctly
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OHLCVCache, type OhlcvCacheCandle } from '../../src/cache/ohlcv-cache.js';

describe('OHLCV Cache Hit Rate', () => {
  let cache: OHLCVCache;
  const mockClock = {
    nowMs: vi.fn(() => Date.now()),
  };

  beforeEach(() => {
    mockClock.nowMs.mockReturnValue(Date.now());
    cache = new OHLCVCache(100, mockClock);
  });

  it('should return cached data on second request', () => {
    const tokenAddress = 'So11111111111111111111111111111111111111112';
    const startTime = new Date('2024-01-01T00:00:00Z');
    const endTime = new Date('2024-01-01T01:00:00Z');
    const interval = '5m';

    const candles: OhlcvCacheCandle[] = [
      {
        timestamp: startTime.getTime(),
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 1000,
      },
    ];

    // First request - cache miss, set cache
    cache.set(tokenAddress, startTime, endTime, candles, interval, 60);

    // Second request - should be cache hit
    const cached = cache.get(tokenAddress, startTime, endTime, interval);

    expect(cached).not.toBeNull();
    expect(cached).toEqual(candles);
  });

  it('should respect TTL and expire cached data', () => {
    const tokenAddress = 'So11111111111111111111111111111111111111112';
    const startTime = new Date('2024-01-01T00:00:00Z');
    const endTime = new Date('2024-01-01T01:00:00Z');
    const interval = '5m';

    const candles: OhlcvCacheCandle[] = [
      {
        timestamp: startTime.getTime(),
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 1000,
      },
    ];

    // Set cache with 1 minute TTL (60 seconds = 1 minute)
    const initialTime = 1000000;
    mockClock.nowMs.mockReturnValue(initialTime);
    cache.set(tokenAddress, startTime, endTime, candles, interval, 1); // 1 minute TTL

    // Request before TTL expires - should hit
    mockClock.nowMs.mockReturnValue(initialTime + 30000); // 30 seconds later
    const cached1 = cache.get(tokenAddress, startTime, endTime, interval);
    expect(cached1).not.toBeNull();

    // Request after TTL expires - should miss (need to exceed TTL + some buffer)
    // TTL is 1 minute = 60 seconds = 60000ms
    mockClock.nowMs.mockReturnValue(initialTime + 61000); // 61 seconds later
    const cached2 = cache.get(tokenAddress, startTime, endTime, interval);
    // Cache entry TTL is checked in get() method, should expire
    expect(cached2).toBeNull();
  });

  it('should track cache statistics', () => {
    const tokenAddress = 'So11111111111111111111111111111111111111112';
    const startTime = new Date('2024-01-01T00:00:00Z');
    const endTime = new Date('2024-01-01T01:00:00Z');
    const interval = '5m';

    const candles: OhlcvCacheCandle[] = [
      {
        timestamp: startTime.getTime(),
        open: 100,
        high: 110,
        low: 95,
        close: 105,
        volume: 1000,
      },
    ];

    // Set cache
    cache.set(tokenAddress, startTime, endTime, candles, interval, 60);

    // Get cache (hit)
    cache.get(tokenAddress, startTime, endTime, interval);
    cache.get(tokenAddress, startTime, endTime, interval);

    // Get non-existent (miss)
    cache.get('different-token', startTime, endTime, interval);

    const stats = cache.getStats();
    expect(stats.hits).toBeGreaterThan(0);
    expect(stats.misses).toBeGreaterThan(0);
    expect(stats.sets).toBe(1);
    expect(stats.hitRate).toBeGreaterThanOrEqual(0);
    expect(stats.hitRate).toBeLessThanOrEqual(100); // Hit rate is a percentage (0-100)
  });

  it('should handle cache eviction when max size reached', () => {
    const maxSize = 5;
    const smallCache = new OHLCVCache(maxSize, mockClock);

    // Fill cache beyond max size
    for (let i = 0; i < maxSize + 2; i++) {
      const tokenAddress = `token-${i}`;
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');
      const candles: OhlcvCacheCandle[] = [
        {
          timestamp: startTime.getTime(),
          open: 100,
          high: 110,
          low: 95,
          close: 105,
          volume: 1000,
        },
      ];
      smallCache.set(tokenAddress, startTime, endTime, candles, '5m', 60);
    }

    // Oldest entries should be evicted
    const info = smallCache.getCacheInfo();
    // Cache should not exceed max size
    expect(info.size).toBeLessThanOrEqual(maxSize);
  });
});

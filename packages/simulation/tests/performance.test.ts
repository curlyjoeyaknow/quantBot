/**
 * Performance Tests
 * =================
 * Tests for performance optimizations and caching.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { getResultCache, getPerformanceMonitor, ResultCache } from '../src';
import type { SimulationResult } from '../src/types';

describe('Performance Optimizations', () => {
  describe('Result Cache', () => {
    let cache: ResultCache;

    beforeEach(() => {
      // Create a fresh cache instance for each test
      cache = new ResultCache();
    });

    it('should cache and retrieve results', () => {
      const mockResult: SimulationResult = {
        finalPnl: 0.5,
        events: [],
        entryPrice: 1.0,
        finalPrice: 1.5,
        totalCandles: 100,
        entryOptimization: {
          lowestPrice: 0.9,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: -10,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0,
        },
      };

      const key = 'test:key:123';
      cache.set(key, mockResult);

      const retrieved = cache.get(key);
      expect(retrieved).toBeDefined();
      expect(retrieved?.finalPnl).toBe(0.5);
    });

    it('should return null for non-existent keys', () => {
      const result = cache.get('nonexistent:key');
      expect(result).toBeNull();
    });

    it('should respect TTL', async () => {
      const ttlCache = new ResultCache({ ttl: 100 }); // 100ms TTL
      const mockResult: SimulationResult = {
        finalPnl: 0.5,
        events: [],
        entryPrice: 1.0,
        finalPrice: 1.5,
        totalCandles: 100,
        entryOptimization: {
          lowestPrice: 0.9,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: -10,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0,
        },
      };

      const key = 'test:ttl:key';
      ttlCache.set(key, mockResult);

      // Should be available immediately
      expect(ttlCache.get(key)).toBeDefined();

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Should be expired
      expect(ttlCache.get(key)).toBeNull();
    });

    it('should enforce max size with FIFO eviction', () => {
      const sizeCache = new ResultCache({ maxSize: 3 });
      const mockResult: SimulationResult = {
        finalPnl: 0.5,
        events: [],
        entryPrice: 1.0,
        finalPrice: 1.5,
        totalCandles: 100,
        entryOptimization: {
          lowestPrice: 0.9,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: -10,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0,
        },
      };

      // Fill cache beyond max size
      sizeCache.set('key1', mockResult);
      sizeCache.set('key2', mockResult);
      sizeCache.set('key3', mockResult);

      // Verify all 3 are present
      expect(sizeCache.get('key1')).toBeDefined();
      expect(sizeCache.get('key2')).toBeDefined();
      expect(sizeCache.get('key3')).toBeDefined();

      // Add 4th - should evict key1 (FIFO)
      sizeCache.set('key4', mockResult);

      expect(sizeCache.get('key1')).toBeNull(); // First inserted, first evicted
      expect(sizeCache.get('key2')).toBeDefined();
      expect(sizeCache.get('key3')).toBeDefined();
      expect(sizeCache.get('key4')).toBeDefined();
    });

    it('should generate cache keys correctly', () => {
      const scenario = {
        name: 'test',
        strategy: [{ target: 2, percent: 1.0 }],
      };
      const key = cache.generateCacheKey(scenario as any, 'testMint', 1000, 2000, 100);

      expect(key).toContain('sim:');
      // Key format: sim:configHash:dataHash (each hash is 16 chars)
      expect(key.split(':')).toHaveLength(3);
    });
  });

  describe('Performance Monitor', () => {
    beforeEach(() => {
      const monitor = getPerformanceMonitor(true);
      monitor.clear();
    });

    it('should measure operation duration', async () => {
      const monitor = getPerformanceMonitor(true);

      await monitor.measure('testOperation', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      const summary = monitor.getSummary();
      expect(summary.totalOperations).toBe(1);
      expect(summary.averageDuration).toBeGreaterThan(40);
      expect(summary.averageDuration).toBeLessThan(100);
    });

    it('should track multiple operations', async () => {
      const monitor = getPerformanceMonitor(true);

      await monitor.measure('op1', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await monitor.measure('op2', async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });

      const summary = monitor.getSummary();
      expect(summary.totalOperations).toBe(2);
      expect(summary.operationsByType['op1'].count).toBe(1);
      expect(summary.operationsByType['op2'].count).toBe(1);
    });

    it('should identify slowest operations', async () => {
      const monitor = getPerformanceMonitor(true);

      await monitor.measure('fast', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      await monitor.measure('slow', async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      const summary = monitor.getSummary();
      expect(summary.slowestOperations[0].operation).toBe('slow');
      expect(summary.slowestOperations[0].duration).toBeGreaterThan(40);
    });

    it('should handle errors gracefully', async () => {
      const monitor = getPerformanceMonitor(true);

      await expect(
        monitor.measure('errorOp', async () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      // Should still track the operation
      const summary = monitor.getSummary();
      expect(summary.totalOperations).toBe(1);
    });
  });
});

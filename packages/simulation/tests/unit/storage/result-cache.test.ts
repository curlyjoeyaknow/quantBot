import { describe, it, expect, beforeEach } from 'vitest';
import { ResultCache, DEFAULT_CACHE_CONFIG } from '../../../src/storage/result-cache';
import type { ScenarioConfig } from '../../../src/core/orchestrator';
import type { SimulationResult } from '../../../src/types';

describe('Result Cache', () => {
  let cache: ResultCache;

  beforeEach(() => {
    cache = new ResultCache();
  });

  describe('generateCacheKey', () => {
    it('should generate cache key from scenario and data', () => {
      const scenario: ScenarioConfig = {
        name: 'test',
        strategy: [{ target: 2.0, percent: 0.5 }],
      };
      const key = cache.generateCacheKey(scenario, 'test-mint', 1000, 2000, 100);
      expect(key).toContain('sim:');
      expect(key.length).toBeGreaterThan(10); // Should be a hash-based key
    });
  });

  describe('get and set', () => {
    it('should cache and retrieve results', () => {
      const scenario: ScenarioConfig = {
        name: 'test',
        strategy: [],
      };
      const key = cache.generateCacheKey(scenario, 'test', 1000, 2000, 100);
      const result: SimulationResult = {
        finalPnl: 1.5,
        events: [],
        entryPrice: 1.0,
        finalPrice: 1.5,
        totalCandles: 100,
        entryOptimization: {
          lowestPrice: 1.0,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: 0,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0,
        },
      };

      cache.set(key, result);
      const cached = cache.get(key);
      expect(cached).toEqual(result);
    });

    it('should return null for non-existent key', () => {
      const cached = cache.get('non-existent');
      expect(cached).toBeNull();
    });
  });

  describe('clear', () => {
    it('should clear all cached results', () => {
      const scenario: ScenarioConfig = {
        name: 'test',
        strategy: [],
      };
      const key = cache.generateCacheKey(scenario, 'test', 1000, 2000, 100);
      const result: SimulationResult = {
        finalPnl: 1.5,
        events: [],
        entryPrice: 1.0,
        finalPrice: 1.5,
        totalCandles: 100,
        entryOptimization: {
          lowestPrice: 1.0,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: 0,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0,
        },
      };

      cache.set(key, result);
      cache.clear();
      const cached = cache.get(key);
      expect(cached).toBeNull();
    });
  });
});

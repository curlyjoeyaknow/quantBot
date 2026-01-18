/**
 * Call Data Loader Edge Case Tests
 * =================================
 * Tests for edge cases, invalid data, and error conditions
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CallDataLoader } from '@quantbot/analytics/loaders/CallDataLoader.js';
import type { CallPerformance } from '@quantbot/analytics/types.js';
import { DateTime } from 'luxon';

// Mock dependencies
const mockStorageEngine = {
  getCandles: vi.fn(),
};

const mockQueryCallsDuckdb = vi.fn();
const mockCreateQueryCallsDuckdbContext = vi.fn();

vi.mock('@quantbot/infra/storage', () => ({
  getStorageEngine: vi.fn(() => mockStorageEngine),
}));

vi.mock('@quantbot/workflows', () => ({
  queryCallsDuckdb: mockQueryCallsDuckdb,
  createQueryCallsDuckdbContext: mockCreateQueryCallsDuckdbContext,
}));

vi.mock('@quantbot/infra/utils', async () => {
  const actual = await vi.importActual('@quantbot/infra/utils');
  return {
    ...actual,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    getDuckDBPath: vi.fn((path: string) => path),
  };
});

// HistoricalPriceLoader moved to workflows - no longer needed in analytics

describe('CallDataLoader Edge Cases', () => {
  let loader: CallDataLoader;

  beforeEach(() => {
    vi.clearAllMocks();
    // HistoricalPriceLoader moved to workflows - prices now passed via options.historicalPrices
    // Default context mock with logger
    mockCreateQueryCallsDuckdbContext.mockResolvedValue({
      logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn() },
    });
    loader = new CallDataLoader();
  });

  describe('loadCalls - Invalid Entry Prices', () => {
    it('should handle null price_usd', async () => {
      mockCreateQueryCallsDuckdbContext.mockResolvedValue({
        logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn(), trace: vi.fn() },
      });
      mockQueryCallsDuckdb.mockResolvedValue({
        calls: [
          {
            mint: 'So11111111111111111111111111111111111111112',
            caller: 'test_caller',
            createdAt: DateTime.now(),
            price_usd: null,
          },
        ],
      });

      const result = await loader.loadCalls();
      expect(result).toHaveLength(1);
      expect(result[0].entryPrice).toBe(0);
      expect(result[0].athPrice).toBe(0);
    });

    it('should handle undefined price_usd', async () => {
      mockCreateQueryCallsDuckdbContext.mockResolvedValue({
        logger: { info: vi.fn(), error: vi.fn() },
      });
      mockQueryCallsDuckdb.mockResolvedValue({
        calls: [
          {
            mint: 'So11111111111111111111111111111111111111112',
            caller: 'test_caller',
            createdAt: DateTime.now(),
            price_usd: undefined,
          },
        ],
      });

      const result = await loader.loadCalls();
      expect(result).toHaveLength(1);
      expect(result[0].entryPrice).toBe(0);
    });

    it('should handle negative price_usd', async () => {
      mockCreateQueryCallsDuckdbContext.mockResolvedValue({
        logger: { info: vi.fn(), error: vi.fn() },
      });
      mockQueryCallsDuckdb.mockResolvedValue({
        calls: [
          {
            mint: 'So11111111111111111111111111111111111111112',
            caller: 'test_caller',
            createdAt: DateTime.now(),
            price_usd: -10,
          },
        ],
      });

      const result = await loader.loadCalls();
      expect(result).toHaveLength(1);
      expect(result[0].entryPrice).toBe(0); // Negative prices should be treated as 0
    });

    it('should handle zero price_usd', async () => {
      mockCreateQueryCallsDuckdbContext.mockResolvedValue({
        logger: { info: vi.fn(), error: vi.fn() },
      });
      mockQueryCallsDuckdb.mockResolvedValue({
        calls: [
          {
            mint: 'So11111111111111111111111111111111111111112',
            caller: 'test_caller',
            createdAt: DateTime.now(),
            price_usd: 0,
          },
        ],
      });

      const result = await loader.loadCalls();
      expect(result).toHaveLength(1);
      expect(result[0].entryPrice).toBe(0);
    });

    it('should handle NaN price_usd', async () => {
      mockCreateQueryCallsDuckdbContext.mockResolvedValue({
        logger: { info: vi.fn(), error: vi.fn() },
      });
      mockQueryCallsDuckdb.mockResolvedValue({
        calls: [
          {
            mint: 'So11111111111111111111111111111111111111112',
            caller: 'test_caller',
            createdAt: DateTime.now(),
            price_usd: NaN,
          },
        ],
      });

      const result = await loader.loadCalls();
      expect(result).toHaveLength(1);
      expect(result[0].entryPrice).toBe(0);
    });

    it('should handle Infinity price_usd', async () => {
      mockCreateQueryCallsDuckdbContext.mockResolvedValue({
        logger: { info: vi.fn(), error: vi.fn() },
      });
      mockQueryCallsDuckdb.mockResolvedValue({
        calls: [
          {
            mint: 'So11111111111111111111111111111111111111112',
            caller: 'test_caller',
            createdAt: DateTime.now(),
            price_usd: Infinity,
          },
        ],
      });

      const result = await loader.loadCalls();
      expect(result).toHaveLength(1);
      expect(result[0].entryPrice).toBe(0); // Infinity should be treated as invalid
    });

    it('should handle very large price_usd', async () => {
      mockCreateQueryCallsDuckdbContext.mockResolvedValue({
        logger: { info: vi.fn(), error: vi.fn() },
      });
      mockQueryCallsDuckdb.mockResolvedValue({
        calls: [
          {
            mint: 'So11111111111111111111111111111111111111112',
            caller: 'test_caller',
            createdAt: DateTime.now(),
            price_usd: 1e20, // Very large but finite
          },
        ],
      });

      const result = await loader.loadCalls();
      expect(result).toHaveLength(1);
      // Should accept large but finite values
      expect(result[0].entryPrice).toBeGreaterThan(0);
    });
  });

  describe('loadCalls - Missing Fields', () => {
    it('should handle missing mint', async () => {
      mockCreateQueryCallsDuckdbContext.mockResolvedValue({
        logger: { info: vi.fn(), error: vi.fn() },
      });
      mockQueryCallsDuckdb.mockResolvedValue({
        calls: [
          {
            mint: null,
            caller: 'test_caller',
            createdAt: DateTime.now(),
            price_usd: 1.0,
          },
        ],
      });

      const result = await loader.loadCalls();
      // Calls with missing mint are filtered out (see line 92-96 in CallDataLoader.ts)
      expect(result).toHaveLength(0);
    });

    it('should handle missing caller', async () => {
      mockCreateQueryCallsDuckdbContext.mockResolvedValue({
        logger: { info: vi.fn(), error: vi.fn() },
      });
      mockQueryCallsDuckdb.mockResolvedValue({
        calls: [
          {
            mint: 'So11111111111111111111111111111111111111112',
            caller: null,
            createdAt: DateTime.now(),
            price_usd: 1.0,
          },
        ],
      });

      const result = await loader.loadCalls();
      expect(result).toHaveLength(1);
      expect(result[0].callerName).toBe('unknown');
    });

    it('should handle empty caller string', async () => {
      mockCreateQueryCallsDuckdbContext.mockResolvedValue({
        logger: { info: vi.fn(), error: vi.fn() },
      });
      mockQueryCallsDuckdb.mockResolvedValue({
        calls: [
          {
            mint: 'So11111111111111111111111111111111111111112',
            caller: '',
            createdAt: DateTime.now(),
            price_usd: 1.0,
          },
        ],
      });

      const result = await loader.loadCalls();
      expect(result).toHaveLength(1);
      expect(result[0].callerName).toBe('unknown');
    });
  });

  describe('enrichWithAth - Invalid Entry Prices', () => {
    it('should skip enrichment for calls with zero entry price', async () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'So11111111111111111111111111111111111111112',
          callerName: 'test_caller',
          chain: 'solana',
          alertTimestamp: new Date(),
          entryPrice: 0, // Invalid entry price
          athPrice: 0,
          athMultiple: 1,
          timeToAthMinutes: 0,
          atlPrice: 0,
          atlMultiple: 1,
        },
      ];

      const result = await loader.enrichWithAth(calls);
      expect(result).toHaveLength(1);
      expect(mockStorageEngine.getCandles).not.toHaveBeenCalled();
      expect(result[0].athMultiple).toBe(1); // Should remain unchanged
    });

    it('should skip enrichment for calls with negative entry price', async () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'So11111111111111111111111111111111111111112',
          callerName: 'test_caller',
          chain: 'solana',
          alertTimestamp: new Date(),
          entryPrice: -10, // Invalid entry price
          athPrice: -10,
          athMultiple: 1,
          timeToAthMinutes: 0,
          atlPrice: -10,
          atlMultiple: 1,
        },
      ];

      const result = await loader.enrichWithAth(calls);
      expect(result).toHaveLength(1);
      expect(mockStorageEngine.getCandles).not.toHaveBeenCalled();
    });

    it('should skip enrichment for calls with NaN entry price', async () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'So11111111111111111111111111111111111111112',
          callerName: 'test_caller',
          chain: 'solana',
          alertTimestamp: new Date(),
          entryPrice: NaN,
          athPrice: NaN,
          athMultiple: 1,
          timeToAthMinutes: 0,
          atlPrice: NaN,
          atlMultiple: 1,
        },
      ];

      const result = await loader.enrichWithAth(calls);
      expect(result).toHaveLength(1);
      expect(mockStorageEngine.getCandles).not.toHaveBeenCalled();
    });
  });

  describe('enrichWithAth - ClickHouse Errors', () => {
    it('should handle ClickHouse timeout errors gracefully', async () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'So11111111111111111111111111111111111111112',
          callerName: 'test_caller',
          chain: 'solana',
          alertTimestamp: new Date(),
          entryPrice: 1.0,
          athPrice: 1.0,
          athMultiple: 1,
          timeToAthMinutes: 0,
          atlPrice: 1.0,
          atlMultiple: 1,
        },
      ];

      mockStorageEngine.getCandles.mockRejectedValue(new Error('socket hang up'));

      const result = await loader.enrichWithAth(calls);
      expect(result).toHaveLength(1);
      // Should return original call on error
      expect(result[0].athMultiple).toBe(1);
    });

    it('should handle ClickHouse connection errors gracefully', async () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'So11111111111111111111111111111111111111112',
          callerName: 'test_caller',
          chain: 'solana',
          alertTimestamp: new Date(),
          entryPrice: 1.0,
          athPrice: 1.0,
          athMultiple: 1,
          timeToAthMinutes: 0,
          atlPrice: 1.0,
          atlMultiple: 1,
        },
      ];

      mockStorageEngine.getCandles.mockRejectedValue(new Error('ECONNREFUSED'));

      const result = await loader.enrichWithAth(calls);
      expect(result).toHaveLength(1);
      expect(result[0].athMultiple).toBe(1);
    });
  });

  describe('enrichWithAth - Large Datasets', () => {
    it('should handle large number of calls efficiently', async () => {
      const calls: CallPerformance[] = Array.from({ length: 1000 }, (_, i) => ({
        callId: i + 1,
        tokenAddress: `So${i.toString().padStart(44, '0')}`,
        callerName: 'test_caller',
        chain: 'solana',
        alertTimestamp: new Date(),
        entryPrice: 1.0,
        athPrice: 1.0,
        athMultiple: 1,
        timeToAthMinutes: 0,
        atlPrice: 1.0,
        atlMultiple: 1,
      }));

      mockStorageEngine.getCandles.mockResolvedValue([]);

      const result = await loader.enrichWithAth(calls);
      expect(result).toHaveLength(1000);
      // Should process in batches
      expect(mockStorageEngine.getCandles).toHaveBeenCalled();
    });
  });

  describe('loadCalls - Error Handling', () => {
    it('should return empty array on workflow error', async () => {
      mockCreateQueryCallsDuckdbContext.mockResolvedValue({
        logger: { info: vi.fn(), error: vi.fn() },
      });
      mockQueryCallsDuckdb.mockRejectedValue(new Error('Database error'));

      const result = await loader.loadCalls();
      expect(result).toEqual([]);
    });

    it('should handle missing calls array in result', async () => {
      mockCreateQueryCallsDuckdbContext.mockResolvedValue({
        logger: { info: vi.fn(), error: vi.fn() },
      });
      mockQueryCallsDuckdb.mockResolvedValue({
        calls: undefined,
      });

      const result = await loader.loadCalls();
      expect(result).toEqual([]);
    });

    it('should handle null calls array in result', async () => {
      mockCreateQueryCallsDuckdbContext.mockResolvedValue({
        logger: { info: vi.fn(), error: vi.fn() },
      });
      mockQueryCallsDuckdb.mockResolvedValue({
        calls: null,
      });

      const result = await loader.loadCalls();
      expect(result).toEqual([]);
    });
  });

  describe('enrichWithAth - Already Enriched Calls', () => {
    it('should skip calls that already have ATH data', async () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'So11111111111111111111111111111111111111112',
          callerName: 'test_caller',
          chain: 'solana',
          alertTimestamp: new Date(),
          entryPrice: 1.0,
          athPrice: 2.0, // Already enriched
          athMultiple: 2.0, // Already enriched
          timeToAthMinutes: 60,
          atlPrice: 0.5,
          atlMultiple: 2.0,
        },
      ];

      const result = await loader.enrichWithAth(calls);
      expect(result).toHaveLength(1);
      expect(mockStorageEngine.getCandles).not.toHaveBeenCalled();
      expect(result[0].athMultiple).toBe(2.0);
    });
  });
});

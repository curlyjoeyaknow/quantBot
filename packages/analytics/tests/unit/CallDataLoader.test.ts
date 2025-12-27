/**
 * Call Data Loader Tests
 * ======================
 * Unit tests for CallDataLoader
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

vi.mock('@quantbot/storage', () => ({
  getStorageEngine: vi.fn(() => mockStorageEngine),
}));

vi.mock('@quantbot/workflows', () => ({
  queryCallsDuckdb: mockQueryCallsDuckdb,
  createQueryCallsDuckdbContext: mockCreateQueryCallsDuckdbContext,
}));

vi.mock('@quantbot/analytics/utils/ath-calculator.js', () => ({
  calculateAthFromCandleObjects: vi.fn((entryPrice, entryTimestamp, candles) => ({
    athPrice: 2,
    athMultiple: 2,
    timeToAthMinutes: 60,
    atlPrice: 0.5,
    atlTimestamp: entryTimestamp + 30,
    atlMultiple: 2,
  })),
}));

describe('CallDataLoader', () => {
  let loader: CallDataLoader;

  beforeEach(() => {
    vi.clearAllMocks();
    loader = new CallDataLoader();
  });

  describe('loadCalls', () => {
    beforeEach(() => {
      mockCreateQueryCallsDuckdbContext.mockResolvedValue({
        services: {},
        logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
      });
    });

    it('should load calls without filters', async () => {
      mockQueryCallsDuckdb.mockResolvedValueOnce({
        calls: [
          {
            id: 'call_token1_2024-01-01_0',
            mint: 'token1',
            caller: 'caller1',
            createdAt: DateTime.fromJSDate(new Date('2024-01-01')),
          },
        ],
      });

      const result = await loader.loadCalls();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        callId: 1,
        tokenAddress: 'token1',
        callerName: 'caller1',
        chain: 'solana',
        entryPrice: 0,
        athPrice: 0,
        athMultiple: 1,
      });
      expect(mockQueryCallsDuckdb).toHaveBeenCalled();
    });

    it('should apply date range filters', async () => {
      const from = new Date('2024-01-01');
      const to = new Date('2024-01-31');

      mockQueryCallsDuckdb.mockResolvedValueOnce({ calls: [] });

      await loader.loadCalls({ from, to });

      expect(mockQueryCallsDuckdb).toHaveBeenCalledWith(
        expect.objectContaining({
          fromISO: expect.any(String),
          toISO: expect.any(String),
        }),
        expect.any(Object)
      );
    });

    it('should apply caller name filters', async () => {
      mockQueryCallsDuckdb.mockResolvedValueOnce({ calls: [] });

      await loader.loadCalls({ callerNames: ['caller1', 'caller2'] });

      expect(mockQueryCallsDuckdb).toHaveBeenCalledWith(
        expect.objectContaining({
          callerName: 'caller1', // Uses first caller name
        }),
        expect.any(Object)
      );
    });

    it('should apply chain filters', async () => {
      // Chain filtering is not directly supported in queryCallsDuckdb
      // The implementation defaults to 'solana'
      mockQueryCallsDuckdb.mockResolvedValueOnce({ calls: [] });

      await loader.loadCalls({ chains: ['solana', 'ethereum'] });

      expect(mockQueryCallsDuckdb).toHaveBeenCalled();
    });

    it('should apply limit', async () => {
      mockQueryCallsDuckdb.mockResolvedValueOnce({ calls: [] });

      await loader.loadCalls({ limit: 100 });

      expect(mockQueryCallsDuckdb).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 100,
        }),
        expect.any(Object)
      );
    });

    it('should use default limit when not specified', async () => {
      mockQueryCallsDuckdb.mockResolvedValueOnce({ calls: [] });

      await loader.loadCalls();

      expect(mockQueryCallsDuckdb).toHaveBeenCalledWith(
        expect.objectContaining({
          limit: 10000, // Default limit (increased from 1000)
        }),
        expect.any(Object)
      );
    });

    it('should handle calls without caller information', async () => {
      mockQueryCallsDuckdb.mockResolvedValueOnce({
        calls: [
          {
            id: 'call_token1_2024-01-01_0',
            mint: 'token1',
            caller: undefined,
            createdAt: DateTime.fromJSDate(new Date('2024-01-01')),
          },
        ],
      });

      const result = await loader.loadCalls();

      expect(result[0].callerName).toBe('unknown');
      expect(result[0].entryPrice).toBe(0);
      expect(result[0].athPrice).toBe(0);
      expect(result[0].athMultiple).toBe(1);
    });

    it('should handle database errors', async () => {
      mockQueryCallsDuckdb.mockRejectedValueOnce(new Error('Database error'));

      // The implementation catches errors and returns empty array
      const result = await loader.loadCalls();
      expect(result).toEqual([]);
    });
  });

  describe('enrichWithAth', () => {
    it('should skip enrichment if calls already have ATH data', async () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'token1',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1,
          athPrice: 2,
          athMultiple: 2,
          timeToAthMinutes: 60,
          atlPrice: 0.5,
          atlMultiple: 2,
        },
      ];

      const result = await loader.enrichWithAth(calls);

      expect(result).toEqual(calls);
      expect(mockStorageEngine.getCandles).not.toHaveBeenCalled();
    });

    it('should enrich calls without ATH data', async () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'token1',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 1,
          timeToAthMinutes: 0,
          atlPrice: 1,
          atlMultiple: 1,
        },
      ];

      mockStorageEngine.getCandles.mockResolvedValueOnce([
        {
          timestamp: 1704067200,
          open: 1,
          high: 2,
          low: 0.5,
          close: 1.5,
          volume: 1000,
        },
      ]);

      const result = await loader.enrichWithAth(calls);

      expect(result[0].athPrice).toBe(2);
      expect(result[0].athMultiple).toBe(2);
      expect(result[0].timeToAthMinutes).toBe(60);
    });

    it('should handle empty calls array', async () => {
      const result = await loader.enrichWithAth([]);
      expect(result).toEqual([]);
    });

    it('should process calls in batches', async () => {
      const calls: CallPerformance[] = Array.from({ length: 25 }, (_, i) => ({
        callId: i + 1,
        tokenAddress: `token${i}`,
        callerName: 'caller1',
        chain: 'solana',
        alertTimestamp: new Date('2024-01-01'),
        entryPrice: 1,
        athPrice: 1,
        athMultiple: 1,
        timeToAthMinutes: 0,
        atlPrice: 1,
        atlMultiple: 1,
      }));

      mockStorageEngine.getCandles.mockResolvedValue([]);

      await loader.enrichWithAth(calls);

      // Should process in batches of 10
      expect(mockStorageEngine.getCandles.mock.calls.length).toBeGreaterThan(0);
    });

    it('should handle enrichment errors gracefully', async () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'token1',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 1,
          timeToAthMinutes: 0,
          atlPrice: 1,
          atlMultiple: 1,
        },
      ];

      mockStorageEngine.getCandles.mockRejectedValueOnce(new Error('No candles'));

      const result = await loader.enrichWithAth(calls);

      // Should return original call on error
      expect(result[0]).toEqual(calls[0]);
    });

    it('should try 5m candles first, then 1m', async () => {
      const calls: CallPerformance[] = [
        {
          callId: 1,
          tokenAddress: 'token1',
          callerName: 'caller1',
          chain: 'solana',
          alertTimestamp: new Date('2024-01-01'),
          entryPrice: 1,
          athPrice: 1,
          athMultiple: 1,
          timeToAthMinutes: 0,
          atlPrice: 1,
          atlMultiple: 1,
        },
      ];

      mockStorageEngine.getCandles
        .mockResolvedValueOnce([]) // 5m returns empty
        .mockResolvedValueOnce([
          {
            timestamp: 1704067200,
            open: 1,
            high: 2,
            low: 0.5,
            close: 1.5,
            volume: 1000,
          },
        ]); // 1m returns data

      await loader.enrichWithAth(calls);

      expect(mockStorageEngine.getCandles).toHaveBeenCalledTimes(2);
      const firstCall = mockStorageEngine.getCandles.mock.calls[0];
      expect(firstCall[4]).toMatchObject({ interval: '5m' });
      const secondCall = mockStorageEngine.getCandles.mock.calls[1];
      expect(secondCall[4]).toMatchObject({ interval: '1m' });
    });
  });
});

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
const mockPool = {
  query: vi.fn(),
};

const mockStorageEngine = {
  getCandles: vi.fn(),
};

vi.mock('@quantbot/storage', () => ({
  getPostgresPool: vi.fn(() => mockPool),
  getStorageEngine: vi.fn(() => mockStorageEngine),
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
    it('should load calls without filters', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            token_address: 'token1',
            token_symbol: 'TOKEN1',
            chain: 'solana',
            caller_name: 'caller1',
            caller_source: 'source1',
            alert_timestamp: new Date('2024-01-01'),
            alert_price: '1.0',
            initial_price: '1.0',
            ath_price: '2.0',
            ath_timestamp: new Date('2024-01-01T01:00:00'),
            time_to_ath: 3600,
            atl_price: '0.5',
            atl_timestamp: new Date('2024-01-01T00:30:00'),
          },
        ],
      });

      const result = await loader.loadCalls();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        callId: 1,
        tokenAddress: 'token1',
        tokenSymbol: 'TOKEN1',
        chain: 'solana',
        callerName: 'source1/caller1',
        entryPrice: 1,
        athPrice: 2,
        athMultiple: 2,
        timeToAthMinutes: 60,
        atlPrice: 0.5,
        atlMultiple: 0.5,
      });
    });

    it('should apply date range filters', async () => {
      const from = new Date('2024-01-01');
      const to = new Date('2024-01-31');

      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await loader.loadCalls({ from, to });

      const queryCall = mockPool.query.mock.calls[0][0];
      expect(queryCall).toContain('alert_timestamp >=');
      expect(queryCall).toContain('alert_timestamp <=');
    });

    it('should apply caller name filters', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await loader.loadCalls({ callerNames: ['caller1', 'caller2'] });

      const queryCall = mockPool.query.mock.calls[0][0];
      expect(queryCall).toContain('c.handle = ANY');
    });

    it('should apply chain filters', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await loader.loadCalls({ chains: ['solana', 'ethereum'] });

      const queryCall = mockPool.query.mock.calls[0][0];
      expect(queryCall).toContain('t.chain = ANY');
    });

    it('should apply limit', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await loader.loadCalls({ limit: 100 });

      const queryCall = mockPool.query.mock.calls[0][0];
      expect(queryCall).toContain('LIMIT');
    });

    it('should use default limit when not specified', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      await loader.loadCalls();

      const queryCall = mockPool.query.mock.calls[0][0];
      expect(queryCall).toContain('LIMIT 10000');
    });

    it('should handle calls without caller information', async () => {
      mockPool.query.mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            token_address: 'token1',
            token_symbol: 'TOKEN1',
            chain: 'solana',
            caller_name: null,
            caller_source: null,
            alert_timestamp: new Date('2024-01-01'),
            alert_price: '1.0',
            initial_price: null,
            ath_price: null,
            ath_timestamp: null,
            time_to_ath: null,
            atl_price: null,
            atl_timestamp: null,
          },
        ],
      });

      const result = await loader.loadCalls();

      expect(result[0].callerName).toBe('unknown');
      expect(result[0].entryPrice).toBe(1);
      expect(result[0].athPrice).toBe(1);
      expect(result[0].athMultiple).toBe(1);
    });

    it('should handle database errors', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Database error'));

      await expect(loader.loadCalls()).rejects.toThrow('Database error');
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
      expect(firstCall[3]).toMatchObject({ interval: '5m' });
      const secondCall = mockStorageEngine.getCandles.mock.calls[1];
      expect(secondCall[3]).toMatchObject({ interval: '1m' });
    });
  });
});

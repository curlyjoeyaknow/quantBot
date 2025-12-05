import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { ClickHouseDataLoader } from '../../src/data/loaders/clickhouse-loader';
import { queryCandles, getClickHouseClient } from '../../src/storage/clickhouse-client';

// Mock ClickHouse client
vi.mock('../../src/storage/clickhouse-client', () => ({
  queryCandles: vi.fn(),
  getClickHouseClient: vi.fn(),
}));

describe('clickhouse-loader', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('ClickHouseDataLoader', () => {
    it('should have correct name', () => {
      const loader = new ClickHouseDataLoader();
      expect(loader.name).toBe('clickhouse-loader');
    });

    it('should throw error when required params missing for candle query', async () => {
      const loader = new ClickHouseDataLoader();
      await expect(loader.load({ source: 'clickhouse' } as any)).rejects.toThrow(
        'ClickHouse loader requires mint, startTime, and endTime',
      );
    });

    it('should load candles from ClickHouse', async () => {
      const mockCandles = [
        { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      ];

      vi.mocked(queryCandles).mockResolvedValue(mockCandles as any);

      const loader = new ClickHouseDataLoader();
      const results = await loader.load({
        source: 'clickhouse',
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        startTime: DateTime.fromSeconds(1000),
        endTime: DateTime.fromSeconds(2000),
      });

      expect(results.length).toBeGreaterThan(0);
      expect(queryCandles).toHaveBeenCalled();
    });

    it('should return empty array when no candles', async () => {
      vi.mocked(queryCandles).mockResolvedValue([]);

      const loader = new ClickHouseDataLoader();
      const results = await loader.load({
        source: 'clickhouse',
        mint: 'So11111111111111111111111111111111111111112',
        chain: 'solana',
        startTime: DateTime.fromSeconds(1000),
        endTime: DateTime.fromSeconds(2000),
      });

      expect(results).toEqual([]);
    });

    it('should use custom query when provided', async () => {
      const mockClient = {
        query: vi.fn().mockResolvedValue({
          json: vi.fn().mockResolvedValue([
            {
              token_address: 'So11111111111111111111111111111111111111112',
              chain: 'solana',
              timestamp: '2024-01-01T00:00:00Z',
            },
          ]),
        }),
      };

      vi.mocked(getClickHouseClient).mockReturnValue(mockClient as any);

      const loader = new ClickHouseDataLoader();
      const results = await loader.load({
        source: 'clickhouse',
        query: 'SELECT * FROM alerts',
      });

      expect(mockClient.query).toHaveBeenCalled();
      expect(results.length).toBeGreaterThan(0);
    });

    it('should use default chain when not provided', async () => {
      const mockCandles = [
        { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      ];

      vi.mocked(queryCandles).mockResolvedValue(mockCandles as any);

      const loader = new ClickHouseDataLoader();
      await loader.load({
        source: 'clickhouse',
        mint: 'So11111111111111111111111111111111111111112',
        startTime: DateTime.fromSeconds(1000),
        endTime: DateTime.fromSeconds(2000),
      });

      expect(queryCandles).toHaveBeenCalledWith(
        'So11111111111111111111111111111111111111112',
        'solana',
        expect.any(DateTime),
        expect.any(DateTime),
      );
    });

    it('should check canLoad correctly', () => {
      const loader = new ClickHouseDataLoader();
      expect(loader.canLoad('clickhouse')).toBe(true);
      expect(loader.canLoad('clickhouse://table')).toBe(true);
      expect(loader.canLoad('csv')).toBe(false);
    });
  });
});



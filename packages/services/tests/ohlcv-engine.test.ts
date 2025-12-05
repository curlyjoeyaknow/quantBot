import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OHLCVEngine, getOHLCVEngine, type OHLCVFetchOptions } from '../../src/services/ohlcv-engine';
import { DateTime } from 'luxon';
import type { Candle } from '../../src/simulation/candles';

// Mock dependencies
vi.mock('../../src/storage/clickhouse-client', () => ({
  initClickHouse: vi.fn().mockResolvedValue(undefined),
  queryCandles: vi.fn().mockResolvedValue([]),
  insertCandles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../src/simulation/candles', () => ({
  fetchHybridCandles: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('OHLCVEngine', () => {
  let engine: OHLCVEngine;
  const testToken = 'test-token-address';
  const testChain = 'solana';
  const startTime = DateTime.fromISO('2024-01-01T00:00:00Z');
  const endTime = DateTime.fromISO('2024-01-01T01:00:00Z');

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment
    delete process.env.USE_CLICKHOUSE;
    delete process.env.CLICKHOUSE_HOST;
    engine = new OHLCVEngine();
  });

  describe('constructor', () => {
    it('should create engine with ClickHouse disabled by default', () => {
      const newEngine = new OHLCVEngine();
      expect(newEngine).toBeDefined();
    });

    it('should enable ClickHouse when USE_CLICKHOUSE is true', () => {
      process.env.USE_CLICKHOUSE = 'true';
      const newEngine = new OHLCVEngine();
      expect(newEngine).toBeDefined();
    });

    it('should enable ClickHouse when CLICKHOUSE_HOST is set', () => {
      process.env.CLICKHOUSE_HOST = 'localhost';
      const newEngine = new OHLCVEngine();
      expect(newEngine).toBeDefined();
    });
  });

  describe('initialize', () => {
    it('should initialize ClickHouse when enabled', async () => {
      const { initClickHouse } = await import('../../src/storage/clickhouse-client');
      process.env.USE_CLICKHOUSE = 'true';
      const newEngine = new OHLCVEngine();

      await newEngine.initialize();

      expect(initClickHouse).toHaveBeenCalled();
    });

    it('should handle ClickHouse initialization failure', async () => {
      const { initClickHouse } = await import('../../src/storage/clickhouse-client');
      const { logger } = await import('../../src/utils/logger');
      process.env.USE_CLICKHOUSE = 'true';
      vi.mocked(initClickHouse).mockRejectedValueOnce(new Error('Connection failed'));
      const newEngine = new OHLCVEngine();

      await newEngine.initialize();

      expect(logger.warn).toHaveBeenCalled();
    });

    it('should not initialize ClickHouse when disabled', async () => {
      const { initClickHouse } = await import('../../src/storage/clickhouse-client');
      delete process.env.USE_CLICKHOUSE;
      delete process.env.CLICKHOUSE_HOST;
      const newEngine = new OHLCVEngine();

      await newEngine.initialize();

      expect(initClickHouse).not.toHaveBeenCalled();
    });
  });

  describe('fetch', () => {
    it('should return empty result when cache-only and no cache available', async () => {
      const options: OHLCVFetchOptions = {
        cacheOnly: true,
      };

      const result = await engine.fetch(testToken, startTime, endTime, testChain, options);

      expect(result.candles).toEqual([]);
      expect(result.fromCache).toBe(false);
      expect(result.ingestedToClickHouse).toBe(false);
    });

    it('should fetch from ClickHouse when available', async () => {
      const { queryCandles } = await import('../../src/storage/clickhouse-client');
      const mockCandles: Candle[] = [
        {
          timestamp: Math.floor(startTime.toSeconds()),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];
      vi.mocked(queryCandles).mockResolvedValueOnce(mockCandles);
      process.env.USE_CLICKHOUSE = 'true';
      const newEngine = new OHLCVEngine();
      await newEngine.initialize();

      const result = await newEngine.fetch(testToken, startTime, endTime, testChain);

      expect(result.candles).toEqual(mockCandles);
      expect(result.fromCache).toBe(true);
      expect(result.source).toBe('clickhouse');
    });

    it('should fetch from API when ClickHouse cache miss', async () => {
      const { fetchHybridCandles } = await import('../../src/simulation/candles');
      const mockCandles: Candle[] = [
        {
          timestamp: Math.floor(startTime.toSeconds()),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];
      vi.mocked(fetchHybridCandles).mockResolvedValueOnce(mockCandles);
      process.env.USE_CLICKHOUSE = 'true';
      const newEngine = new OHLCVEngine();
      await newEngine.initialize();

      const result = await newEngine.fetch(testToken, startTime, endTime, testChain);

      expect(result.candles).toEqual(mockCandles);
      expect(fetchHybridCandles).toHaveBeenCalled();
    });

    it('should ingest to ClickHouse when ensureIngestion is true', async () => {
      const { insertCandles } = await import('../../src/storage/clickhouse-client');
      const { fetchHybridCandles } = await import('../../src/simulation/candles');
      const mockCandles: Candle[] = [
        {
          timestamp: Math.floor(startTime.toSeconds()),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];
      vi.mocked(fetchHybridCandles).mockResolvedValueOnce(mockCandles);
      process.env.USE_CLICKHOUSE = 'true';
      const newEngine = new OHLCVEngine();
      await newEngine.initialize();

      const options: OHLCVFetchOptions = {
        ensureIngestion: true,
        interval: '5m',
      };

      await newEngine.fetch(testToken, startTime, endTime, testChain, options);

      expect(insertCandles).toHaveBeenCalled();
    });

    it('should handle alertTime option', async () => {
      const { fetchHybridCandles } = await import('../../src/simulation/candles');
      const alertTime = DateTime.fromISO('2024-01-01T00:30:00Z');
      const options: OHLCVFetchOptions = {
        alertTime,
      };

      await engine.fetch(testToken, startTime, endTime, testChain, options);

      expect(fetchHybridCandles).toHaveBeenCalledWith(
        testToken,
        startTime,
        endTime,
        testChain,
        alertTime
      );
    });

    it('should handle fetch errors', async () => {
      const { fetchHybridCandles } = await import('../../src/simulation/candles');
      vi.mocked(fetchHybridCandles).mockRejectedValueOnce(new Error('API error'));

      await expect(engine.fetch(testToken, startTime, endTime, testChain)).rejects.toThrow();
    });
  });

  describe('batchFetch', () => {
    it('should fetch multiple tokens', async () => {
      const { fetchHybridCandles } = await import('../../src/simulation/candles');
      const tokens = ['token1', 'token2', 'token3'];
      vi.mocked(fetchHybridCandles).mockResolvedValue([]);

      const results = await engine.batchFetch(tokens, startTime, endTime, testChain);

      expect(results.size).toBe(3);
      expect(fetchHybridCandles).toHaveBeenCalledTimes(3);
    });

    it('should handle individual token failures gracefully', async () => {
      const { fetchHybridCandles } = await import('../../src/simulation/candles');
      const { logger } = await import('../../src/utils/logger');
      const tokens = ['token1', 'token2'];
      vi.mocked(fetchHybridCandles)
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error('Token 2 failed'));

      const results = await engine.batchFetch(tokens, startTime, endTime, testChain);

      expect(results.size).toBe(2);
      expect(results.get('token1')?.candles).toEqual([]);
      expect(results.get('token2')?.candles).toEqual([]);
      expect(logger.error).toHaveBeenCalled();
    });

    it('should return empty result for failed tokens', async () => {
      const { fetchHybridCandles } = await import('../../src/simulation/candles');
      const tokens = ['token1'];
      vi.mocked(fetchHybridCandles).mockRejectedValueOnce(new Error('Failed'));

      const results = await engine.batchFetch(tokens, startTime, endTime, testChain);

      const result = results.get('token1');
      expect(result).toBeDefined();
      expect(result?.candles).toEqual([]);
      expect(result?.fromCache).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should calculate statistics correctly', () => {
      const results = new Map([
        [
          'token1',
          {
            candles: [{ timestamp: 1000 } as Candle, { timestamp: 2000 } as Candle],
            fromCache: true,
            ingestedToClickHouse: true,
            source: 'clickhouse' as const,
          },
        ],
        [
          'token2',
          {
            candles: [{ timestamp: 1000 } as Candle],
            fromCache: false,
            ingestedToClickHouse: false,
            source: 'api' as const,
          },
        ],
        [
          'token3',
          {
            candles: [],
            fromCache: false,
            ingestedToClickHouse: false,
            source: 'api' as const,
          },
        ],
      ]);

      const stats = engine.getStats(results);

      expect(stats.total).toBe(3);
      expect(stats.fromCache).toBe(1);
      expect(stats.fromAPI).toBe(1);
      expect(stats.ingested).toBe(1);
      expect(stats.totalCandles).toBe(3);
    });

    it('should handle empty results', () => {
      const results = new Map();
      const stats = engine.getStats(results);

      expect(stats.total).toBe(0);
      expect(stats.fromCache).toBe(0);
      expect(stats.fromAPI).toBe(0);
      expect(stats.ingested).toBe(0);
      expect(stats.totalCandles).toBe(0);
    });
  });

  describe('getOHLCVEngine', () => {
    it('should return singleton instance', () => {
      const instance1 = getOHLCVEngine();
      const instance2 = getOHLCVEngine();

      expect(instance1).toBe(instance2);
    });
  });
});

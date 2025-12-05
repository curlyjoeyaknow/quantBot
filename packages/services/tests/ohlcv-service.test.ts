import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { OHLCVService } from '../../src/services/ohlcv-service';
import { birdeyeClient } from '../../src/api/birdeye-client';
import { insertCandles, queryCandles, hasCandles, initClickHouse } from '../../src/storage/clickhouse-client';

// Mock dependencies
vi.mock('../../src/api/birdeye-client', () => ({
  birdeyeClient: {
    fetchOHLCVData: vi.fn(),
  },
}));

vi.mock('../../src/storage/clickhouse-client', () => ({
  insertCandles: vi.fn(),
  queryCandles: vi.fn(),
  hasCandles: vi.fn(),
  initClickHouse: vi.fn(),
}));

vi.mock('../../src/simulation/candles', () => ({
  fetchHybridCandles: vi.fn(),
}));

vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ohlcv-service', () => {
  let service: OHLCVService;

  beforeEach(() => {
    service = new OHLCVService();
    vi.clearAllMocks();
  });

  describe('initialize', () => {
    it('should initialize ClickHouse', async () => {
      vi.mocked(initClickHouse).mockResolvedValue(undefined);

      await service.initialize();

      expect(initClickHouse).toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      vi.mocked(initClickHouse).mockRejectedValue(new Error('Init failed'));

      await expect(service.initialize()).rejects.toThrow('Init failed');
    });
  });

  describe('fetchCandles', () => {
    it('should fetch candles from Birdeye', async () => {
      const mockBirdeyeData = {
        items: [
          {
            unixTime: 1000,
            open: '1.0',
            high: '1.1',
            low: '0.9',
            close: '1.05',
            volume: '1000',
          },
        ],
      };

      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue(mockBirdeyeData as any);

      const candles = await service.fetchCandles(
        'So11111111111111111111111111111111111111112',
        'solana',
        DateTime.fromSeconds(1000),
        DateTime.fromSeconds(2000),
        '5m',
      );

      expect(candles.length).toBeGreaterThan(0);
      expect(candles[0].timestamp).toBe(1000);
      expect(candles[0].close).toBe(1.05);
    });

    it('should return empty array when no data', async () => {
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({ items: [] } as any);

      const candles = await service.fetchCandles(
        'So11111111111111111111111111111111111111112',
        'solana',
        DateTime.fromSeconds(1000),
        DateTime.fromSeconds(2000),
      );

      expect(candles).toEqual([]);
    });

    it('should filter candles by time range', async () => {
      const mockBirdeyeData = {
        items: [
          {
            unixTime: 500,
            open: '1.0',
            high: '1.1',
            low: '0.9',
            close: '1.05',
            volume: '1000',
          },
          {
            unixTime: 1500,
            open: '1.05',
            high: '1.15',
            low: '0.95',
            close: '1.1',
            volume: '1000',
          },
        ],
      };

      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue(mockBirdeyeData as any);

      const candles = await service.fetchCandles(
        'So11111111111111111111111111111111111111112',
        'solana',
        DateTime.fromSeconds(1000),
        DateTime.fromSeconds(2000),
      );

      // Should filter out candle with timestamp 500
      expect(candles.every((c) => c.timestamp >= 1000 && c.timestamp <= 2000)).toBe(true);
    });
  });

  describe('ingestCandles', () => {
    it('should ingest candles into ClickHouse', async () => {
      const candles = [
        { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      ];

      vi.mocked(hasCandles).mockResolvedValue(false);
      vi.mocked(insertCandles).mockResolvedValue(undefined);

      const result = await service.ingestCandles(
        'So11111111111111111111111111111111111111112',
        'solana',
        candles,
      );

      expect(result.ingested).toBe(1);
      expect(result.skipped).toBe(0);
    });

    it('should skip duplicates when enabled', async () => {
      const candles = [
        { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      ];

      vi.mocked(hasCandles).mockResolvedValue(true);

      const result = await service.ingestCandles(
        'So11111111111111111111111111111111111111112',
        'solana',
        candles,
        { skipDuplicates: true },
      );

      expect(result.ingested).toBe(0);
      expect(result.skipped).toBe(1);
      expect(insertCandles).not.toHaveBeenCalled();
    });

    it('should return zero for empty candles', async () => {
      const result = await service.ingestCandles(
        'So11111111111111111111111111111111111111112',
        'solana',
        [],
      );

      expect(result.ingested).toBe(0);
      expect(result.skipped).toBe(0);
    });
  });

  describe('getCandles', () => {
    it('should get candles from cache first', async () => {
      const mockCandles = [
        { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      ];

      vi.mocked(queryCandles).mockResolvedValue(mockCandles as any);

      const candles = await service.getCandles(
        'So11111111111111111111111111111111111111112',
        'solana',
        DateTime.fromSeconds(1000),
        DateTime.fromSeconds(2000),
        { useCache: true },
      );

      expect(candles.length).toBeGreaterThan(0);
    });

    it('should fetch from API when cache miss', async () => {
      const { fetchHybridCandles } = await import('../../src/simulation/candles');
      const mockCandles = [
        { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      ];

      vi.mocked(queryCandles).mockResolvedValue([]);
      vi.mocked(fetchHybridCandles).mockResolvedValue(mockCandles as any);

      const candles = await service.getCandles(
        'So11111111111111111111111111111111111111112',
        'solana',
        DateTime.fromSeconds(1000),
        DateTime.fromSeconds(2000),
        { useCache: true },
      );

      expect(candles.length).toBeGreaterThan(0);
    });
  });
});


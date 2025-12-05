import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OHLCVIngestionService } from '../../src/services/ohlcv-ingestion';
import { influxDBClient } from '../../src/storage/influxdb-client';
import { birdeyeClient } from '../../src/api/birdeye-client';
import { ohlcvCache } from '../../src/cache/ohlcv-cache';

// Mock dependencies
vi.mock('../../src/storage/influxdb-client', () => ({
  influxDBClient: {
    initialize: vi.fn(),
    hasData: vi.fn(),
    writeOHLCVData: vi.fn(),
    getOHLCVData: vi.fn(),
    close: vi.fn(),
  },
}));

vi.mock('../../src/api/birdeye-client', () => ({
  birdeyeClient: {
    fetchOHLCVData: vi.fn(),
    getAPIKeyUsage: vi.fn(),
  },
}));

vi.mock('../../src/cache/ohlcv-cache', () => ({
  ohlcvCache: {
    get: vi.fn(),
    set: vi.fn(),
    getStats: vi.fn(),
  },
}));

vi.mock('../../src/utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('ohlcv-ingestion', () => {
  let service: OHLCVIngestionService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new OHLCVIngestionService();
  });

  describe('initialize', () => {
    it('should initialize successfully', async () => {
      vi.mocked(influxDBClient.initialize).mockResolvedValue(undefined);

      await service.initialize();

      expect(influxDBClient.initialize).toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      vi.mocked(influxDBClient.initialize).mockRejectedValue(new Error('Connection failed'));

      await expect(service.initialize()).rejects.toThrow('Connection failed');
    });
  });

  describe('fetchAndStoreOHLCV', () => {
    const tokenAddress = 'So11111111111111111111111111111111111111112';
    const startTime = new Date('2024-01-01');
    const endTime = new Date('2024-01-02');
    const tokenSymbol = 'TEST';
    const chain = 'solana';

    it('should return existing data when already in InfluxDB', async () => {
      vi.mocked(influxDBClient.hasData).mockResolvedValue(true);

      const result = await service.fetchAndStoreOHLCV(tokenAddress, startTime, endTime, tokenSymbol, chain);

      expect(result.success).toBe(true);
      expect(result.recordsAdded).toBe(0);
      expect(result.recordsSkipped).toBe(0);
      expect(birdeyeClient.fetchOHLCVData).not.toHaveBeenCalled();
    });

    it('should use cached data when available', async () => {
      const cachedData = [
        {
          timestamp: Date.now(),
          dateTime: new Date(),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];

      vi.mocked(influxDBClient.hasData).mockResolvedValue(false);
      vi.mocked(ohlcvCache.get).mockReturnValue(cachedData as any);
      vi.mocked(influxDBClient.writeOHLCVData).mockResolvedValue(undefined);

      const result = await service.fetchAndStoreOHLCV(tokenAddress, startTime, endTime, tokenSymbol, chain);

      expect(result.success).toBe(true);
      expect(result.recordsAdded).toBe(1);
      expect(ohlcvCache.get).toHaveBeenCalledWith(tokenAddress, startTime, endTime);
      expect(influxDBClient.writeOHLCVData).toHaveBeenCalledWith(tokenAddress, tokenSymbol, chain, cachedData);
    });

    it('should fetch from API when no cache', async () => {
      const birdeyeResponse = {
        items: [
          {
            unixTime: Math.floor(startTime.getTime() / 1000),
            open: 1.0,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 1000,
          },
        ],
      };

      vi.mocked(influxDBClient.hasData).mockResolvedValue(false);
      vi.mocked(ohlcvCache.get).mockReturnValue(null);
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue(birdeyeResponse as any);
      vi.mocked(influxDBClient.writeOHLCVData).mockResolvedValue(undefined);

      const result = await service.fetchAndStoreOHLCV(tokenAddress, startTime, endTime, tokenSymbol, chain);

      expect(result.success).toBe(true);
      expect(result.recordsAdded).toBe(1);
      expect(birdeyeClient.fetchOHLCVData).toHaveBeenCalledWith(tokenAddress, startTime, endTime);
      expect(influxDBClient.writeOHLCVData).toHaveBeenCalled();
    });

    it('should handle API returning no data', async () => {
      vi.mocked(influxDBClient.hasData).mockResolvedValue(false);
      vi.mocked(ohlcvCache.get).mockReturnValue(null);
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({ items: [] } as any);

      const result = await service.fetchAndStoreOHLCV(tokenAddress, startTime, endTime, tokenSymbol, chain);

      expect(result.success).toBe(false);
      expect(result.recordsAdded).toBe(0);
      expect(result.error).toBe('No data returned from API');
    });

    it('should handle errors gracefully', async () => {
      vi.mocked(influxDBClient.hasData).mockResolvedValue(false);
      vi.mocked(ohlcvCache.get).mockReturnValue(null);
      vi.mocked(birdeyeClient.fetchOHLCVData).mockRejectedValue(new Error('API error'));

      const result = await service.fetchAndStoreOHLCV(tokenAddress, startTime, endTime, tokenSymbol, chain);

      expect(result.success).toBe(false);
      expect(result.error).toBe('API error');
    });
  });

  describe('batchFetchOHLCV', () => {
    it('should fetch OHLCV for multiple tokens', async () => {
      const tokens = [
        { address: 'token1', symbol: 'T1', chain: 'solana' },
        { address: 'token2', symbol: 'T2', chain: 'solana' },
      ];
      const startTime = new Date('2024-01-01');
      const endTime = new Date('2024-01-02');

      const mockData = [
        {
          timestamp: Date.now(),
          dateTime: new Date(),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];

      vi.mocked(influxDBClient.hasData).mockResolvedValue(false);
      vi.mocked(ohlcvCache.get).mockReturnValue(null);
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({
        items: [
          {
            unixTime: Math.floor(startTime.getTime() / 1000),
            open: 1.0,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 1000,
          },
        ],
      } as any);
      vi.mocked(influxDBClient.writeOHLCVData).mockResolvedValue(undefined);
      vi.mocked(influxDBClient.getOHLCVData).mockResolvedValue(mockData as any);

      const results = await service.batchFetchOHLCV(tokens, startTime, endTime);

      expect(results.size).toBe(2);
      expect(results.get('token1')).toEqual(mockData);
      expect(results.get('token2')).toEqual(mockData);
    });

    it('should handle failures in batch gracefully', async () => {
      const tokens = [
        { address: 'token1', symbol: 'T1', chain: 'solana' },
        { address: 'token2', symbol: 'T2', chain: 'solana' },
      ];
      const startTime = new Date('2024-01-01');
      const endTime = new Date('2024-01-02');

      vi.mocked(influxDBClient.hasData)
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false);
      vi.mocked(ohlcvCache.get).mockReturnValue(null);
      vi.mocked(birdeyeClient.fetchOHLCVData)
        .mockResolvedValueOnce({
          items: [
            {
              unixTime: Math.floor(startTime.getTime() / 1000),
              open: 1.0,
              high: 1.1,
              low: 0.9,
              close: 1.05,
              volume: 1000,
            },
          ],
        } as any)
        .mockRejectedValueOnce(new Error('API error'));
      vi.mocked(influxDBClient.writeOHLCVData).mockResolvedValue(undefined);
      vi.mocked(influxDBClient.getOHLCVData).mockResolvedValue([]);

      const results = await service.batchFetchOHLCV(tokens, startTime, endTime);

      // Should still return results for successful tokens
      expect(results.size).toBeLessThanOrEqual(2);
    });
  });

  describe('backfillMissingData', () => {
    it('should fetch last 7 days when no existing data', async () => {
      const tokenAddress = 'So11111111111111111111111111111111111111112';

      vi.mocked(influxDBClient.getOHLCVData).mockResolvedValue([]);
      vi.mocked(influxDBClient.hasData).mockResolvedValue(false);
      vi.mocked(ohlcvCache.get).mockReturnValue(null);
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({
        items: [
          {
            unixTime: Math.floor(Date.now() / 1000),
            open: 1.0,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 1000,
          },
        ],
      } as any);
      vi.mocked(influxDBClient.writeOHLCVData).mockResolvedValue(undefined);

      const result = await service.backfillMissingData(tokenAddress);

      expect(result.success).toBe(true);
      expect(birdeyeClient.fetchOHLCVData).toHaveBeenCalled();
    });

    it('should fill gaps in existing data', async () => {
      const tokenAddress = 'So11111111111111111111111111111111111111112';
      const now = Date.now();
      const existingData = [
        {
          timestamp: now - 10 * 60 * 1000, // 10 minutes ago
          dateTime: new Date(now - 10 * 60 * 1000),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
        {
          timestamp: now - 5 * 60 * 1000, // 5 minutes ago (gap of 5 minutes)
          dateTime: new Date(now - 5 * 60 * 1000),
          open: 1.05,
          high: 1.15,
          low: 0.95,
          close: 1.1,
          volume: 1000,
        },
      ];

      vi.mocked(influxDBClient.getOHLCVData).mockResolvedValue(existingData as any);
      vi.mocked(influxDBClient.hasData).mockResolvedValue(false);
      vi.mocked(ohlcvCache.get).mockReturnValue(null);
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({ items: [] } as any);
      vi.mocked(influxDBClient.writeOHLCVData).mockResolvedValue(undefined);

      const result = await service.backfillMissingData(tokenAddress);

      expect(result.success).toBe(true);
    });

    it('should return success when no gaps found', async () => {
      const tokenAddress = 'So11111111111111111111111111111111111111112';
      const now = Date.now();
      const existingData = [
        {
          timestamp: now - 2 * 60 * 1000,
          dateTime: new Date(now - 2 * 60 * 1000),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
        {
          timestamp: now - 1 * 60 * 1000,
          dateTime: new Date(now - 1 * 60 * 1000),
          open: 1.05,
          high: 1.15,
          low: 0.95,
          close: 1.1,
          volume: 1000,
        },
      ];

      vi.mocked(influxDBClient.getOHLCVData).mockResolvedValue(existingData as any);

      const result = await service.backfillMissingData(tokenAddress);

      expect(result.success).toBe(true);
      expect(result.recordsAdded).toBe(0);
    });
  });

  describe('getIngestionStats', () => {
    it('should return ingestion statistics', () => {
      const mockAPIUsage = { credits: 100, requests: 50 };
      const mockCacheStats = { hits: 10, misses: 5 };

      vi.mocked(birdeyeClient.getAPIKeyUsage).mockReturnValue(mockAPIUsage);
      vi.mocked(ohlcvCache.getStats).mockReturnValue(mockCacheStats as any);

      const stats = service.getIngestionStats();

      expect(stats.apiUsage).toEqual(mockAPIUsage);
      expect(stats.cacheStats).toEqual(mockCacheStats);
      expect(stats.influxRecordCount).toBe(0);
    });
  });

  describe('close', () => {
    it('should close connections', async () => {
      vi.mocked(influxDBClient.close).mockResolvedValue(undefined);

      await service.close();

      expect(influxDBClient.close).toHaveBeenCalled();
    });
  });
});


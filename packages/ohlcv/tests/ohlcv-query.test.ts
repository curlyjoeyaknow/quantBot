/**
 * Tests for ohlcv-query.ts
 *
 * Tests cover:
 * - OHLCV data querying
 * - Cache behavior
 * - Aggregation
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OHLCVQueryService } from '../src/ohlcv-query';
import type { OHLCVData, TokenInfo } from '@quantbot/infra/storage';

// Mock dependencies - must be defined inside vi.mock factory to avoid hoisting issues
vi.mock('@quantbot/infra/storage', async () => {
  const { vi } = await import('vitest');
  const mockStorageEngine = {
    getCandles: vi.fn(),
    storeCandles: vi.fn(),
  };
  return {
    influxDBClient: {
      getOHLCVData: vi.fn(),
      getLatestPrice: vi.fn(),
      hasData: vi.fn(),
      getAvailableTokens: vi.fn(),
    },
    ohlcvCache: {
      get: vi.fn(),
      set: vi.fn(),
    },
    getStorageEngine: vi.fn(() => mockStorageEngine),
  };
});

vi.mock('@quantbot/infra/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('OHLCVQueryService', () => {
  let service: OHLCVQueryService;
  let mockInfluxClient: any;
  let mockCache: any;
  let mockStorageEngine: any;
  const TEST_MINT = '7pXs123456789012345678901234567890pump';
  const startTime = new Date('2024-01-01T00:00:00Z');
  const endTime = new Date('2024-01-02T00:00:00Z');

  beforeEach(async () => {
    vi.clearAllMocks();
    const storage = await import('@quantbot/storage');
    mockInfluxClient = storage.influxDBClient;
    mockCache = storage.ohlcvCache;
    mockStorageEngine = storage.getStorageEngine();
    service = new OHLCVQueryService();
    mockCache.get.mockReturnValue(null);
    mockInfluxClient.getOHLCVData.mockResolvedValue([]);
    mockInfluxClient.getLatestPrice.mockResolvedValue(1.0);
    mockInfluxClient.hasData.mockResolvedValue(true);
    mockInfluxClient.getAvailableTokens.mockResolvedValue([]);
    // Default mock for StorageEngine.getCandles - return empty array
    mockStorageEngine.getCandles.mockResolvedValue([]);
  });

  describe('getOHLCV', () => {
    it('should return cached data when available', async () => {
      const cachedData: OHLCVData[] = [
        { timestamp: startTime, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      ];
      mockCache.get.mockReturnValue(cachedData);

      const result = await service.getOHLCV(TEST_MINT, startTime, endTime, '1m');

      expect(mockCache.get).toHaveBeenCalledWith(TEST_MINT, startTime, endTime, '1m');
      // The service converts cached data and adds dateTime field
      expect(result).toEqual([
        {
          timestamp: startTime,
          dateTime: startTime,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ]);
      expect(mockInfluxClient.getOHLCVData).not.toHaveBeenCalled();
    });

    it('should query ClickHouse when cache miss', async () => {
      // Implementation now queries ClickHouse via StorageEngine when cache misses
      const clickHouseCandles = [
        {
          timestamp: Math.floor(startTime.getTime() / 1000),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];
      mockStorageEngine.getCandles.mockResolvedValue(clickHouseCandles);

      const result = await service.getOHLCV(TEST_MINT, startTime, endTime, '1m');

      // Should query ClickHouse via StorageEngine
      expect(mockStorageEngine.getCandles).toHaveBeenCalledWith(
        TEST_MINT,
        'solana', // Default chain
        expect.any(Object), // DateTime startTime
        expect.any(Object), // DateTime endTime
        { interval: '1m', useCache: false }
      );
      // Should convert and cache the data
      expect(mockCache.set).toHaveBeenCalled();
      // Should return converted data (timestamp in milliseconds, with dateTime)
      expect(result).toEqual([
        {
          timestamp: clickHouseCandles[0].timestamp * 1000,
          dateTime: new Date(clickHouseCandles[0].timestamp * 1000),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ]);
    });

    it('should skip cache when useCache is false', async () => {
      const dbData: OHLCVData[] = [];
      mockInfluxClient.getOHLCVData.mockResolvedValue(dbData);

      await service.getOHLCV(TEST_MINT, startTime, endTime, '1m', { useCache: false });

      expect(mockCache.get).not.toHaveBeenCalled();
      expect(mockCache.set).not.toHaveBeenCalled();
    });

    it('should handle errors gracefully', async () => {
      mockInfluxClient.getOHLCVData.mockRejectedValue(new Error('Database error'));

      const result = await service.getOHLCV(TEST_MINT, startTime, endTime, '1m');

      expect(result).toEqual([]);
    });

    it('should use custom cache TTL when data is available', async () => {
      // When cache has data, it should use the custom TTL
      const cachedData: OHLCVData[] = [
        { timestamp: startTime, open: 1.0, high: 1.0, low: 1.0, close: 1.0, volume: 1000 },
      ];
      mockCache.get.mockReturnValue(cachedData);

      const result = await service.getOHLCV(TEST_MINT, startTime, endTime, '1m', { cacheTTL: 120 });

      // Should return cached data
      expect(result).toEqual([
        {
          timestamp: startTime,
          dateTime: startTime,
          open: 1.0,
          high: 1.0,
          low: 1.0,
          close: 1.0,
          volume: 1000,
        },
      ]);
      // Custom TTL is only used when setting cache, not when getting from cache
      expect(mockCache.get).toHaveBeenCalledWith(TEST_MINT, startTime, endTime, '1m');
    });
  });

  describe('getLatestPrice', () => {
    it('should return latest price from InfluxDB', async () => {
      mockInfluxClient.getLatestPrice.mockResolvedValue(1.5);

      const result = await service.getLatestPrice(TEST_MINT);

      expect(mockInfluxClient.getLatestPrice).toHaveBeenCalledWith(TEST_MINT);
      expect(result).toBe(1.5);
    });

    it('should return 0 on error', async () => {
      mockInfluxClient.getLatestPrice.mockRejectedValue(new Error('Database error'));

      const result = await service.getLatestPrice(TEST_MINT);

      expect(result).toBe(0);
    });
  });

  describe('hasData', () => {
    it('should check data existence', async () => {
      mockInfluxClient.hasData.mockResolvedValue(true);

      const result = await service.hasData(TEST_MINT, startTime, endTime);

      expect(mockInfluxClient.hasData).toHaveBeenCalledWith(TEST_MINT, startTime, endTime);
      expect(result).toBe(true);
    });

    it('should return false on error', async () => {
      mockInfluxClient.hasData.mockRejectedValue(new Error('Database error'));

      const result = await service.hasData(TEST_MINT, startTime, endTime);

      expect(result).toBe(false);
    });
  });

  describe('getAvailableTokens', () => {
    it('should return available tokens', async () => {
      const tokens: TokenInfo[] = [{ address: TEST_MINT, symbol: 'TEST', name: 'Test Token' }];
      mockInfluxClient.getAvailableTokens.mockResolvedValue(tokens);

      const result = await service.getAvailableTokens();

      expect(result).toEqual(tokens);
    });

    it('should return empty array on error', async () => {
      mockInfluxClient.getAvailableTokens.mockRejectedValue(new Error('Database error'));

      const result = await service.getAvailableTokens();

      expect(result).toEqual([]);
    });
  });

  describe('getAggregatedOHLCV', () => {
    it('should return empty array when no data available from ClickHouse', async () => {
      // Implementation queries ClickHouse via StorageEngine
      mockStorageEngine.getCandles.mockResolvedValue([]);

      const result = await service.getAggregatedOHLCV(TEST_MINT, startTime, endTime, '5m');

      // Should query ClickHouse via StorageEngine
      expect(mockStorageEngine.getCandles).toHaveBeenCalled();
      // Should return empty array when no data
      expect(result).toEqual([]);
    });

    it('should aggregate data from ClickHouse when available', async () => {
      // Mock ClickHouse returning candles (timestamp in seconds)
      const clickHouseCandles = [
        {
          timestamp: Math.floor(startTime.getTime() / 1000),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
        {
          timestamp: Math.floor(startTime.getTime() / 1000) + 60,
          open: 1.05,
          high: 1.15,
          low: 1.0,
          close: 1.1,
          volume: 1200,
        },
        {
          timestamp: Math.floor(startTime.getTime() / 1000) + 120,
          open: 1.1,
          high: 1.2,
          low: 1.05,
          close: 1.15,
          volume: 1300,
        },
        {
          timestamp: Math.floor(startTime.getTime() / 1000) + 180,
          open: 1.15,
          high: 1.25,
          low: 1.1,
          close: 1.2,
          volume: 1400,
        },
        {
          timestamp: Math.floor(startTime.getTime() / 1000) + 240,
          open: 1.2,
          high: 1.3,
          low: 1.15,
          close: 1.25,
          volume: 1500,
        },
      ];
      mockStorageEngine.getCandles.mockResolvedValue(clickHouseCandles);

      const result = await service.getAggregatedOHLCV(TEST_MINT, startTime, endTime, '5m');

      // Should query ClickHouse via StorageEngine
      expect(mockStorageEngine.getCandles).toHaveBeenCalledWith(
        TEST_MINT,
        'solana',
        expect.any(Object),
        expect.any(Object),
        { interval: '1m', useCache: false }
      );
      // Should aggregate the data (5 candles at 1m intervals should aggregate to fewer 5m candles)
      expect(result.length).toBeGreaterThan(0);
      expect(result[0]).toMatchObject({
        timestamp: expect.any(Number),
        dateTime: expect.any(Date),
        open: expect.any(Number),
        high: expect.any(Number),
        low: expect.any(Number),
        close: expect.any(Number),
        volume: expect.any(Number),
      });
    });
  });
});

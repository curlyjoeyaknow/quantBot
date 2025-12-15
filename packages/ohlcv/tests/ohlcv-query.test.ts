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
import type { OHLCVData, TokenInfo } from '@quantbot/storage';

// Mock dependencies - must be defined inside vi.mock factory to avoid hoisting issues
vi.mock('@quantbot/storage', async () => {
  const { vi } = await import('vitest');
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
  };
});

vi.mock('@quantbot/utils', () => ({
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
  const TEST_MINT = '7pXs123456789012345678901234567890pump';
  const startTime = new Date('2024-01-01T00:00:00Z');
  const endTime = new Date('2024-01-02T00:00:00Z');

  beforeEach(async () => {
    vi.clearAllMocks();
    const storage = await import('@quantbot/storage');
    mockInfluxClient = storage.influxDBClient;
    mockCache = storage.ohlcvCache;
    service = new OHLCVQueryService();
    mockCache.get.mockReturnValue(null);
    mockInfluxClient.getOHLCVData.mockResolvedValue([]);
    mockInfluxClient.getLatestPrice.mockResolvedValue(1.0);
    mockInfluxClient.hasData.mockResolvedValue(true);
    mockInfluxClient.getAvailableTokens.mockResolvedValue([]);
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

    it('should query InfluxDB when cache miss', async () => {
      const dbData: OHLCVData[] = [
        { timestamp: startTime, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      ];
      mockInfluxClient.getOHLCVData.mockResolvedValue(dbData);

      const result = await service.getOHLCV(TEST_MINT, startTime, endTime, '1m');

      expect(mockInfluxClient.getOHLCVData).toHaveBeenCalledWith(
        TEST_MINT,
        startTime,
        endTime,
        '1m'
      );
      expect(mockCache.set).toHaveBeenCalledWith(TEST_MINT, startTime, endTime, dbData, '1m', 60);
      expect(result).toEqual(dbData);
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

    it('should use custom cache TTL', async () => {
      const dbData: OHLCVData[] = [
        { timestamp: startTime, open: 1.0, high: 1.0, low: 1.0, close: 1.0, volume: 1000 },
      ];
      mockInfluxClient.getOHLCVData.mockResolvedValue(dbData);

      await service.getOHLCV(TEST_MINT, startTime, endTime, '1m', { cacheTTL: 120 });

      expect(mockCache.set).toHaveBeenCalledWith(TEST_MINT, startTime, endTime, dbData, '1m', 120);
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
    it('should return aggregated data', async () => {
      const dbData: OHLCVData[] = [
        { timestamp: startTime, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      ];
      mockInfluxClient.getOHLCVData.mockResolvedValue(dbData);

      const result = await service.getAggregatedOHLCV(TEST_MINT, startTime, endTime, '5m');

      expect(mockInfluxClient.getOHLCVData).toHaveBeenCalledWith(
        TEST_MINT,
        startTime,
        endTime,
        '1m'
      );
      expect(result).toBeDefined();
    });
  });
});

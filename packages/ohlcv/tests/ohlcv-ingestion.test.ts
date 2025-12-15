/**
 * Tests for ohlcv-ingestion.ts
 *
 * Tests cover:
 * - OHLCV ingestion service
 * - Data fetching and storage
 * - Cache behavior
 * - Error handling
 * - Mint address preservation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OHLCVIngestionService } from '../src/ohlcv-ingestion';
import type { OHLCVData } from '@quantbot/storage';

// Mock dependencies (factories to avoid hoisting issues)
vi.mock('@quantbot/storage', async () => {
  const { vi } = await import('vitest');
  const mockInfluxClient = {
    initialize: vi.fn(),
    hasData: vi.fn(),
    writeOHLCVData: vi.fn(),
  };

  const mockCache = {
    get: vi.fn(),
    set: vi.fn(),
  };

  (globalThis as any).__ohlcvIngestionStorageMocks__ = {
    mockInfluxClient,
    mockCache,
  };

  return {
    influxDBClient: mockInfluxClient,
    ohlcvCache: mockCache,
  };
});

vi.mock('@quantbot/api-clients', async () => {
  const { vi } = await import('vitest');
  const mockBirdeyeClient = {
    fetchOHLCVData: vi.fn(),
  };
  (globalThis as any).__ohlcvIngestionApiMocks__ = { mockBirdeyeClient };
  return {
    birdeyeClient: mockBirdeyeClient,
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

describe('OHLCVIngestionService', () => {
  let service: OHLCVIngestionService;
  let mockInfluxClient: any;
  let mockCache: any;
  let mockBirdeyeClient: any;
  const FULL_MINT = '7pXs123456789012345678901234567890pump';
  const startTime = new Date('2024-01-01T00:00:00Z');
  const endTime = new Date('2024-01-02T00:00:00Z');

  beforeEach(() => {
    vi.clearAllMocks();
    const storageMocks = (globalThis as any).__ohlcvIngestionStorageMocks__;
    mockInfluxClient = storageMocks.mockInfluxClient;
    mockCache = storageMocks.mockCache;
    const apiMocks = (globalThis as any).__ohlcvIngestionApiMocks__;
    mockBirdeyeClient = apiMocks.mockBirdeyeClient;

    service = new OHLCVIngestionService();
    mockInfluxClient.initialize.mockResolvedValue(undefined);
    mockInfluxClient.hasData.mockResolvedValue(false);
    mockInfluxClient.writeOHLCVData.mockResolvedValue(undefined);
    mockCache.get.mockReturnValue(null);
  });

  describe('initialize', () => {
    it('should initialize InfluxDB client', async () => {
      await service.initialize();

      expect(mockInfluxClient.initialize).toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      mockInfluxClient.initialize.mockRejectedValue(new Error('Connection failed'));

      await expect(service.initialize()).rejects.toThrow('Connection failed');
    });
  });

  describe('fetchAndStoreOHLCV', () => {
    it('should skip if data already exists in InfluxDB', async () => {
      mockInfluxClient.hasData.mockResolvedValue(true);

      const result = await service.fetchAndStoreOHLCV(FULL_MINT, startTime, endTime);

      expect(mockInfluxClient.hasData).toHaveBeenCalledWith(FULL_MINT, startTime, endTime);
      expect(mockBirdeyeClient.fetchOHLCVData).not.toHaveBeenCalled();
      expect(result).toEqual({
        tokenAddress: FULL_MINT,
        recordsAdded: 0,
        recordsSkipped: 0,
        success: true,
      });
    });

    it('should use cached data when available', async () => {
      const cachedData: OHLCVData[] = [
        {
          timestamp: startTime.getTime(),
          dateTime: startTime,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];
      mockCache.get.mockReturnValue(cachedData);

      const result = await service.fetchAndStoreOHLCV(
        FULL_MINT,
        startTime,
        endTime,
        'TEST',
        'solana'
      );

      expect(mockCache.get).toHaveBeenCalledWith(FULL_MINT, startTime, endTime, '1m');
      expect(mockInfluxClient.writeOHLCVData).toHaveBeenCalledWith(
        FULL_MINT, // Full address, case-preserved
        'TEST',
        'solana',
        cachedData
      );
      expect(result.recordsAdded).toBe(1);
      expect(result.success).toBe(true);
    });

    it('should preserve exact case of mint address', async () => {
      const FULL_MINT_LOWERCASE = '7pxs123456789012345678901234567890pump';
      const birdeyeData = {
        items: [
          {
            unixTime: Math.floor(startTime.getTime() / 1000),
            open: '1.0',
            high: '1.1',
            low: '0.9',
            close: '1.05',
            volume: '1000',
          },
        ],
      };
      mockBirdeyeClient.fetchOHLCVData.mockResolvedValue(birdeyeData);

      await service.fetchAndStoreOHLCV(FULL_MINT_LOWERCASE, startTime, endTime);

      expect(mockBirdeyeClient.fetchOHLCVData).toHaveBeenCalledWith(
        FULL_MINT_LOWERCASE, // Exact case preserved
        startTime,
        endTime
      );
      expect(mockInfluxClient.writeOHLCVData).toHaveBeenCalledWith(
        FULL_MINT_LOWERCASE,
        'UNKNOWN',
        'solana',
        expect.any(Array)
      );
    });

    it('should fetch from Birdeye API when cache miss', async () => {
      const birdeyeData = {
        items: [
          {
            unixTime: Math.floor(startTime.getTime() / 1000),
            open: '1.0',
            high: '1.1',
            low: '0.9',
            close: '1.05',
            volume: '1000',
          },
        ],
      };
      mockBirdeyeClient.fetchOHLCVData.mockResolvedValue(birdeyeData);

      const result = await service.fetchAndStoreOHLCV(
        FULL_MINT,
        startTime,
        endTime,
        'TEST',
        'solana'
      );

      expect(mockBirdeyeClient.fetchOHLCVData).toHaveBeenCalledWith(FULL_MINT, startTime, endTime);
      expect(mockInfluxClient.writeOHLCVData).toHaveBeenCalled();
      expect(mockCache.set).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.recordsAdded).toBe(1);
    });

    it('should return error when no data from API', async () => {
      mockBirdeyeClient.fetchOHLCVData.mockResolvedValue(null);

      const result = await service.fetchAndStoreOHLCV(FULL_MINT, startTime, endTime);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No data returned from API');
      expect(result.recordsAdded).toBe(0);
    });

    it('should handle API errors gracefully', async () => {
      mockBirdeyeClient.fetchOHLCVData.mockRejectedValue(new Error('API error'));

      const result = await service.fetchAndStoreOHLCV(FULL_MINT, startTime, endTime);

      expect(result.success).toBe(false);
      expect(result.error).toBe('API error');
    });

    it('should cache data with 2 hour TTL', async () => {
      const birdeyeData = {
        items: [
          {
            unixTime: Math.floor(startTime.getTime() / 1000),
            open: '1.0',
            high: '1.1',
            low: '0.9',
            close: '1.05',
            volume: '1000',
          },
        ],
      };
      mockBirdeyeClient.fetchOHLCVData.mockResolvedValue(birdeyeData);

      await service.fetchAndStoreOHLCV(FULL_MINT, startTime, endTime);

      expect(mockCache.set).toHaveBeenCalledWith(
        FULL_MINT,
        startTime,
        endTime,
        expect.any(Array),
        '1m',
        120 // 2 hours TTL
      );
    });
  });
});

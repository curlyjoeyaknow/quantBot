/**
 * Tests for ohlcv-service.ts
 *
 * Tests cover:
 * - Candle fetching from Birdeye
 * - Candle ingestion to ClickHouse
 * - Multi-layer caching (in-memory, ClickHouse, CSV)
 * - Error handling
 * - Mint address preservation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { OHLCVService } from '../src/ohlcv-service.js';
import type { Candle } from '@quantbot/core';

// Mock dependencies
vi.mock('@quantbot/storage', async () => {
  const { vi } = await import('vitest');
  const mockStorageEngine = {
    storeCandles: vi.fn(),
    getCandles: vi.fn(),
  };
  const mockStorage = {
    getStorageEngine: vi.fn(() => mockStorageEngine),
    initClickHouse: vi.fn(),
  };
  (globalThis as any).__ohlcvServiceStorageMocks__ = { mockStorage, mockStorageEngine };
  return mockStorage;
});

vi.mock('@quantbot/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  createPackageLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  })),
}));

describe('OHLCVService', () => {
  let service: OHLCVService;
  let mockStorage: any;
  let mockStorageEngine: any;
  const FULL_MINT = '7pXs123456789012345678901234567890pump';
  const FULL_MINT_LOWERCASE = '7pxs123456789012345678901234567890pump';
  const startTime = DateTime.fromISO('2024-01-01T00:00:00Z');
  const endTime = DateTime.fromISO('2024-01-02T00:00:00Z');

  beforeEach(() => {
    vi.clearAllMocks();
    const storageMocks = (globalThis as any).__ohlcvServiceStorageMocks__;
    mockStorage = storageMocks.mockStorage;
    mockStorageEngine = storageMocks.mockStorageEngine;

    service = new OHLCVService();
    mockStorage.initClickHouse.mockResolvedValue(undefined);
    mockStorageEngine.storeCandles.mockResolvedValue(undefined);
    mockStorageEngine.getCandles.mockResolvedValue([]);
  });

  describe('initialize', () => {
    it('should initialize ClickHouse', async () => {
      await service.initialize();

      expect(mockStorage.initClickHouse).toHaveBeenCalled();
    });

    it('should handle initialization errors', async () => {
      mockStorage.initClickHouse.mockRejectedValue(new Error('Connection failed'));

      await expect(service.initialize()).rejects.toThrow('Connection failed');
    });
  });

  // Note: fetchCandles method removed - service is offline-only
  // For fetching candles, use @quantbot/api-clients in @quantbot/ingestion workflows

  describe('ingestCandles', () => {
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

    it('should ingest candles to ClickHouse', async () => {
      const result = await service.ingestCandles(FULL_MINT, 'solana', mockCandles, {
        interval: '5m',
      });

      expect(mockStorageEngine.storeCandles).toHaveBeenCalledWith(
        FULL_MINT, // Full address, case-preserved
        'solana',
        mockCandles,
        '5m'
      );
      expect(result).toEqual({ ingested: 1, skipped: 0 });
    });

    it('should preserve exact case of mint address', async () => {
      await service.ingestCandles(FULL_MINT_LOWERCASE, 'solana', mockCandles);

      expect(mockStorageEngine.storeCandles).toHaveBeenCalledWith(
        FULL_MINT_LOWERCASE, // Exact case preserved
        'solana',
        mockCandles,
        '5m'
      );
    });

    it('should skip duplicates when skipDuplicates is true', async () => {
      mockStorageEngine.getCandles.mockResolvedValue(mockCandles); // Simulate existing candles

      const result = await service.ingestCandles(FULL_MINT, 'solana', mockCandles, {
        skipDuplicates: true,
      });

      expect(mockStorageEngine.getCandles).toHaveBeenCalled();
      expect(mockStorageEngine.storeCandles).not.toHaveBeenCalled();
      expect(result).toEqual({ ingested: 0, skipped: 1 });
    });

    it('should return zero for empty candles', async () => {
      const result = await service.ingestCandles(FULL_MINT, 'solana', []);

      expect(mockStorageEngine.storeCandles).not.toHaveBeenCalled();
      expect(result).toEqual({ ingested: 0, skipped: 0 });
    });

    it('should handle ingestion errors', async () => {
      mockStorageEngine.storeCandles.mockRejectedValue(new Error('Database error'));

      await expect(service.ingestCandles(FULL_MINT, 'solana', mockCandles)).rejects.toThrow(
        'Database error'
      );
    });
  });

  describe('getCandles', () => {
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

    it('should use in-memory cache when available', async () => {
      // First call populates cache from ClickHouse
      mockStorageEngine.getCandles.mockResolvedValue(mockCandles);
      await service.getCandles(FULL_MINT, 'solana', startTime, endTime);

      // Second call should use in-memory cache
      mockStorageEngine.getCandles.mockClear();
      const result = await service.getCandles(FULL_MINT, 'solana', startTime, endTime);

      expect(result).toEqual(mockCandles);
      // Should not call getCandles again (cached)
      expect(mockStorageEngine.getCandles).not.toHaveBeenCalled();
    });

    it('should use ClickHouse cache when available', async () => {
      mockStorageEngine.getCandles.mockResolvedValue(mockCandles);

      const result = await service.getCandles(FULL_MINT, 'solana', startTime, endTime);

      expect(mockStorageEngine.getCandles).toHaveBeenCalledWith(
        FULL_MINT,
        'solana',
        startTime,
        endTime,
        { interval: '5m' }
      );
      expect(result).toEqual(mockCandles);
    });

    it('should return empty when cache miss (offline-only mode)', async () => {
      mockStorageEngine.getCandles.mockResolvedValue([]);

      const result = await service.getCandles(FULL_MINT, 'solana', startTime, endTime, {
        forceRefresh: true,
      });

      // Offline-only mode: returns empty if not in cache
      expect(result).toEqual([]);
    });

    it('should bypass cache when forceRefresh is true', async () => {
      // With forceRefresh: true, both in-memory and ClickHouse cache are bypassed
      // The service returns empty array (offline-only mode)
      const result = await service.getCandles(FULL_MINT, 'solana', startTime, endTime, {
        forceRefresh: true,
      });

      // Should return empty (offline-only mode, no API calls)
      expect(result).toEqual([]);
      // ClickHouse is not queried when forceRefresh is true (cache is bypassed)
      expect(mockStorageEngine.getCandles).not.toHaveBeenCalled();
    });

    it('should not ingest candles automatically (offline-only mode)', async () => {
      mockStorageEngine.getCandles.mockResolvedValue([]);

      await service.getCandles(FULL_MINT, 'solana', startTime, endTime, { forceRefresh: true });

      // Offline-only mode: getCandles doesn't automatically ingest
      // Candles must be stored via storeCandles() or ingestCandles()
      expect(mockStorageEngine.storeCandles).not.toHaveBeenCalled();
    });
  });
});

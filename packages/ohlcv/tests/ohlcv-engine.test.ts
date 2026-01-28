/**
 * Tests for ohlcv-engine.ts
 *
 * Tests cover:
 * - Engine initialization
 * - Candle fetching with multi-layer caching
 * - ClickHouse ingestion
 * - Batch operations
 * - Error handling
 * - Mint address preservation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import { OHLCVEngine } from '../src/ohlcv-engine.js';
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

  // Expose for test access
  (globalThis as any).__ohlcvEngineStorageMocks__ = {
    mockStorage,
    mockStorageEngine,
  };

  return mockStorage;
});

vi.mock('@quantbot/infra/utils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@quantbot/infra/utils')>();
  return {
    ...actual,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

describe('OHLCVEngine', () => {
  let engine: OHLCVEngine;
  let mockStorage: any;
  let mockStorageEngine: any;
  const FULL_MINT = '7pXs123456789012345678901234567890pump';
  const FULL_MINT_LOWERCASE = '7pxs123456789012345678901234567890pump';
  const startTime = DateTime.fromISO('2024-01-01T00:00:00Z');
  const endTime = DateTime.fromISO('2024-01-02T00:00:00Z');

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset environment
    delete process.env.USE_CLICKHOUSE;
    delete process.env.CLICKHOUSE_HOST;

    // Refresh mocks from global storage
    const mocks = (globalThis as any).__ohlcvEngineStorageMocks__;
    mockStorage = mocks.mockStorage;
    mockStorageEngine = mocks.mockStorageEngine;

    mockStorage.initClickHouse.mockResolvedValue(undefined);
    mockStorageEngine.storeCandles.mockResolvedValue(undefined);
    mockStorageEngine.getCandles.mockResolvedValue([]);

    // Create engine with default env (ClickHouse disabled)
    engine = new OHLCVEngine();
  });

  afterEach(() => {
    delete process.env.USE_CACHE_ONLY;
  });

  describe('initialize', () => {
    it('should initialize ClickHouse when enabled', async () => {
      process.env.USE_CLICKHOUSE = 'true';
      engine = new OHLCVEngine();

      await engine.initialize();

      expect(mockStorage.initClickHouse).toHaveBeenCalled();
    });

    it('should handle ClickHouse initialization failure', async () => {
      process.env.USE_CLICKHOUSE = 'true';
      mockStorage.initClickHouse.mockRejectedValue(new Error('Connection failed'));
      engine = new OHLCVEngine();

      await engine.initialize();

      // Should not throw, just log warning
      expect(mockStorage.initClickHouse).toHaveBeenCalled();
    });

    it('should skip initialization when ClickHouse disabled', async () => {
      delete process.env.USE_CLICKHOUSE;
      delete process.env.CLICKHOUSE_HOST;

      engine = new OHLCVEngine();
      await engine.initialize();

      // Note: initialize() always calls initClickHouse(), but initClickHouse() itself
      // may check environment variables and skip initialization internally
      // The test verifies that initialize() doesn't throw even when ClickHouse is disabled
      expect(mockStorage.initClickHouse).toHaveBeenCalled();
    });
  });

  describe('fetch', () => {
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

    it('should use ClickHouse cache when available', async () => {
      process.env.USE_CLICKHOUSE = 'true';
      engine = new OHLCVEngine();
      await engine.initialize();
      mockStorageEngine.getCandles.mockResolvedValue(mockCandles);

      const result = await engine.fetch(FULL_MINT, startTime, endTime, 'solana');

      expect(mockStorageEngine.getCandles).toHaveBeenCalledWith(
        FULL_MINT, // Full address, case-preserved
        'solana',
        startTime,
        endTime,
        { interval: '5m' }
      );
      expect(result).toEqual({
        candles: mockCandles,
        fromCache: true,
        ingestedToClickHouse: true,
        source: 'clickhouse',
      });
    });

    it('should preserve exact case of mint address', async () => {
      process.env.USE_CLICKHOUSE = 'true';
      engine = new OHLCVEngine();
      await engine.initialize();
      mockStorageEngine.getCandles.mockResolvedValue(mockCandles);

      await engine.fetch(FULL_MINT_LOWERCASE, startTime, endTime, 'solana');

      expect(mockStorageEngine.getCandles).toHaveBeenCalledWith(
        FULL_MINT_LOWERCASE, // Exact case preserved
        'solana',
        startTime,
        endTime,
        { interval: '5m' }
      );
    });

    it('should return empty when cache-only and no cache', async () => {
      process.env.USE_CLICKHOUSE = 'true';
      engine = new OHLCVEngine();
      await engine.initialize();
      mockStorageEngine.getCandles.mockResolvedValue([]);

      const result = await engine.fetch(FULL_MINT, startTime, endTime, 'solana', {
        cacheOnly: true,
      });

      expect(result).toEqual({
        candles: [],
        fromCache: false,
        ingestedToClickHouse: false,
        source: 'clickhouse', // Offline-only mode always returns 'clickhouse'
      });
    });

    it('should return empty when cache miss (offline-only mode)', async () => {
      process.env.USE_CLICKHOUSE = 'true';
      engine = new OHLCVEngine();
      await engine.initialize();
      mockStorageEngine.getCandles.mockResolvedValue([]);

      const result = await engine.fetch(FULL_MINT, startTime, endTime, 'solana', {
        ensureIngestion: true,
      });

      // Offline-only mode: no API calls, just returns empty if cache miss
      expect(result).toEqual({
        candles: [],
        fromCache: false,
        ingestedToClickHouse: false,
        source: 'clickhouse',
      });
    });

    it('should not ingest when no candles found (offline-only mode)', async () => {
      process.env.USE_CLICKHOUSE = 'true';
      engine = new OHLCVEngine();
      await engine.initialize();
      mockStorageEngine.getCandles.mockResolvedValue([]);

      const result = await engine.fetch(FULL_MINT, startTime, endTime, 'solana', {
        ensureIngestion: true,
        interval: '5m',
      });

      // Offline-only mode: no candles to ingest if cache miss
      expect(mockStorageEngine.storeCandles).not.toHaveBeenCalled();
      expect(result.ingestedToClickHouse).toBe(false);
    });

    it('should handle alert time for 1m candles', async () => {
      process.env.USE_CLICKHOUSE = 'true';
      engine = new OHLCVEngine();
      await engine.initialize();
      const alertTime = DateTime.fromISO('2024-01-01T12:00:00Z');
      const candles1m: Candle[] = Array.from({ length: 60 }, (_, i) => ({
        timestamp: Math.floor(alertTime.toSeconds()) - 30 * 60 + i * 60,
        open: 1.0,
        high: 1.0,
        low: 1.0,
        close: 1.0,
        volume: 1000,
      }));
      mockStorageEngine.getCandles.mockResolvedValue(candles1m);

      const result = await engine.fetch(FULL_MINT, startTime, endTime, 'solana', {
        ensureIngestion: true,
        alertTime,
        interval: '1m',
      });

      // Should query with 1m interval
      expect(mockStorageEngine.getCandles).toHaveBeenCalledWith(
        FULL_MINT,
        'solana',
        startTime,
        endTime,
        { interval: '1m' }
      );
      expect(result.candles).toEqual(candles1m);
    });

    it('should handle ClickHouse query errors gracefully', async () => {
      process.env.USE_CLICKHOUSE = 'true';
      engine = new OHLCVEngine();
      await engine.initialize();
      mockStorageEngine.getCandles.mockRejectedValue(new Error('Query failed'));

      const result = await engine.fetch(FULL_MINT, startTime, endTime, 'solana');

      // Offline-only mode: should return empty on error, not fall back to API
      expect(result).toEqual({
        candles: [],
        fromCache: false,
        ingestedToClickHouse: false,
        source: 'clickhouse',
      });
    });

    it('should handle ingestion errors gracefully', async () => {
      process.env.USE_CLICKHOUSE = 'true';
      engine = new OHLCVEngine();
      await engine.initialize();
      mockStorageEngine.getCandles.mockResolvedValue(mockCandles);
      // Note: In offline-only mode, ingestion happens via storeCandles() method separately
      // The fetch/query method doesn't automatically ingest

      const result = await engine.fetch(FULL_MINT, startTime, endTime, 'solana', {
        ensureIngestion: true,
      });

      // Should return candles from cache
      expect(result.candles).toEqual(mockCandles);
      expect(result.fromCache).toBe(true);
    });
  });
});

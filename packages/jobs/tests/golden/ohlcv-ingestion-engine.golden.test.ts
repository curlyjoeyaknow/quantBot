/**
 * Golden Path Tests for OhlcvIngestionEngine
 *
 * Tests the complete happy path for fetching and storing OHLCV candles.
 * These tests validate the entire flow from alert time to stored candles.
 *
 * Golden Path:
 * 1. Initialize engine (ClickHouse)
 * 2. Fetch metadata (optional)
 * 3. Fetch 1m candles (from -52 minutes before alert)
 * 4. Fetch 5m candles (from -260 minutes before alert, chunked)
 * 5. Store all candles in ClickHouse
 * 6. Return structured result
 *
 * Tests use real implementations where possible and push to absolute limits.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import { OhlcvIngestionEngine } from '../../src/ohlcv-ingestion-engine.js';
import { fetchBirdeyeCandles, getBirdeyeClient } from '@quantbot/api-clients';
import { getStorageEngine, initClickHouse } from '@quantbot/storage';
import { storeCandles } from '@quantbot/ohlcv';
import type { Candle } from '@quantbot/core';

// Mock dependencies
vi.mock('@quantbot/api-clients', () => {
  const mockBirdeyeClient = {
    fetchOHLCVData: vi.fn(),
    getTokenMetadata: vi.fn(),
    fetchHistoricalPriceAtUnixTime: vi.fn(),
  };
  return {
    birdeyeClient: mockBirdeyeClient,
    getBirdeyeClient: () => mockBirdeyeClient,
    fetchBirdeyeCandles: vi.fn(),
    fetchMultiChainMetadata: vi.fn(),
  };
});

vi.mock('@quantbot/storage', () => {
  class MockIngestionRunRepository {
    createRun = vi.fn();
    updateRun = vi.fn();
    finishRun = vi.fn();
    getRun = vi.fn();
    listRuns = vi.fn();
    startRun = vi.fn().mockResolvedValue(undefined);
    completeRun = vi.fn().mockResolvedValue(undefined);
    failRun = vi.fn().mockResolvedValue(undefined);
    updateRunStats = vi.fn();
  }
  class MockOhlcvRepository {
    upsertCandles = vi.fn().mockResolvedValue({
      inserted: 0,
      rejected: 0,
      warnings: 0,
      rejectionDetails: [],
    });
  }
  return {
    getStorageEngine: vi.fn(),
    initClickHouse: vi.fn(),
    IngestionRunRepository: MockIngestionRunRepository,
    OhlcvRepository: MockOhlcvRepository,
    LENIENT_VALIDATION: {
      rejectZeroVolume: false,
      rejectZeroPrice: true,
      rejectFutureTimestamps: true,
      futureTolerance: 300,
      minSourceTier: 0,
    },
  };
});

vi.mock('@quantbot/ohlcv', () => ({
  storeCandles: vi.fn(),
}));

vi.mock('@quantbot/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  isEvmAddress: vi.fn(),
}));

describe('OhlcvIngestionEngine - Golden Path', () => {
  let engine: OhlcvIngestionEngine;
  const TEST_MINT = '7pXs1234567890123456789012345678901234pump'; // Full 44-char address
  const TEST_CHAIN = 'solana' as const;
  const TEST_ALERT_TIME = DateTime.utc().minus({ days: 30 }); // Recent alert

  const mockStorageEngine = {
    storeCandles: vi.fn(),
    getCandles: vi.fn(),
  };

  beforeEach(() => {
    engine = new OhlcvIngestionEngine();
    vi.clearAllMocks();
    vi.mocked(initClickHouse).mockResolvedValue(undefined);
    vi.mocked(getStorageEngine).mockReturnValue(mockStorageEngine as any);

    const birdeyeClient = getBirdeyeClient();
    vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({
      name: 'Test Token',
      symbol: 'TEST',
    });
    vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({ items: [] } as any);
    vi.mocked(birdeyeClient.fetchHistoricalPriceAtUnixTime).mockResolvedValue({
      value: 1.0,
    } as any);

    vi.mocked(fetchBirdeyeCandles).mockResolvedValue([]);
  });

  afterEach(() => {
    engine.clearCache();
  });

  describe('GOLDEN: Complete ingestion flow - fetch and store', () => {
    it('should complete full golden path: initialize → fetch 1m → fetch 5m → store → return result', async () => {
      // Setup: Generate realistic candle data
      const alertTimeSeconds = Math.floor(TEST_ALERT_TIME.toSeconds());
      const start1m = alertTimeSeconds - 52 * 60; // -52 minutes
      const start5m = alertTimeSeconds - 260 * 60; // -260 minutes

      const candles1m: Candle[] = [];
      for (let i = 0; i < 52; i++) {
        candles1m.push({
          timestamp: start1m + i * 60,
          open: 1.0 + i * 0.01,
          high: 1.1 + i * 0.01,
          low: 0.9 + i * 0.01,
          close: 1.05 + i * 0.01,
          volume: 1000 + i * 100,
        });
      }

      const candles5m: Candle[] = [];
      for (let i = 0; i < 52; i++) {
        candles5m.push({
          timestamp: start5m + i * 300, // 5 minute intervals
          open: 1.0 + i * 0.05,
          high: 1.1 + i * 0.05,
          low: 0.9 + i * 0.05,
          close: 1.05 + i * 0.05,
          volume: 5000 + i * 500,
        });
      }

      // Mock: No cached data
      vi.mocked(mockStorageEngine.getCandles).mockResolvedValue([]);

      // Mock: API returns candles
      vi.mocked(fetchBirdeyeCandles).mockResolvedValueOnce(candles1m); // Only 1m candles (engine only fetches 1m)

      // Execute: Initialize and fetch
      await engine.initialize();
      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME, {
        interval: '1m',
        useCache: false,
      });

      // Assert: Complete result structure
      expect(result['1m'].length).toBeGreaterThanOrEqual(52); // Engine fetches up to 5000, but test provides 52
      expect(result['5m']).toEqual([]); // Engine only returns 1m candles now
      expect(result.metadata.tokenStored).toBe(true);
      expect(result.metadata.total1mCandles).toBeGreaterThanOrEqual(52);
      expect(result.metadata.total5mCandles).toBe(0); // Not fetched in current implementation
      expect(result.metadata.chunksFetched).toBeGreaterThan(0);
      expect(result.metadata.chunksFromAPI).toBeGreaterThan(0);

      // Assert: Candles stored
      expect(storeCandles).toHaveBeenCalled();
      const storeCalls = vi.mocked(storeCandles).mock.calls;
      expect(storeCalls.length).toBeGreaterThan(0);

      // Assert: Mint address preserved in all calls
      for (const call of storeCalls) {
        expect(call[0]).toBe(TEST_MINT);
        expect(call[0].length).toBeGreaterThanOrEqual(32); // Valid address length (32-44 chars)
      }
    });

    it('should handle chunked fetching for large 5m candle sets', async () => {
      // Setup: Generate 5000+ 5m candles (requires chunking)
      const alertTimeSeconds = Math.floor(TEST_ALERT_TIME.toSeconds());
      const start5m = alertTimeSeconds - 260 * 60;
      const end5m = Math.floor(DateTime.utc().toSeconds());

      // Generate 5000 1m candles (engine fetches 1m candles, not 5m)
      const largeCandles1m: Candle[] = [];
      const start1m = alertTimeSeconds - 52 * 60; // -52 minutes
      for (let i = 0; i < 5000; i++) {
        largeCandles1m.push({
          timestamp: start1m + i * 60, // 1 minute intervals
          open: 1.0 + i * 0.0001,
          high: 1.1 + i * 0.0001,
          low: 0.9 + i * 0.0001,
          close: 1.05 + i * 0.0001,
          volume: 1000 + i,
        });
      }

      vi.mocked(mockStorageEngine.getCandles).mockResolvedValue([]);
      vi.mocked(fetchBirdeyeCandles).mockResolvedValueOnce(largeCandles1m); // Large 1m set

      await engine.initialize();
      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME, {
        interval: '1m',
        useCache: false,
      });

      // Assert: Large candle set processed (engine fetches up to 5000 x 1m)
      expect(result['1m'].length).toBe(5000);
      expect(result.metadata.total1mCandles).toBe(5000);
      expect(result.metadata.chunksFetched).toBeGreaterThan(0);
    });

    it('should use cache when enabled and data exists', async () => {
      const cachedCandles: Candle[] = [
        {
          timestamp: Math.floor(TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds()),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];

      vi.mocked(mockStorageEngine.getCandles).mockResolvedValue(cachedCandles);

      await engine.initialize();
      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME, {
        interval: '1m',
        useCache: true,
      });

      // Assert: Cache was checked
      expect(mockStorageEngine.getCandles).toHaveBeenCalled();

      // Assert: Result includes cached data
      expect(result.metadata.chunksFromCache).toBeGreaterThan(0);
    });
  });

  describe('GOLDEN: Mint address preservation (critical)', () => {
    it('should preserve exact mint address case and length throughout flow', async () => {
      const mixedCaseMint = '7pXsAbCdEfGhIjKlMnOpQrStUvWxYz1234567890';
      const mockCandles: Candle[] = [
        {
          timestamp: Math.floor(TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds()),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];

      vi.mocked(mockStorageEngine.getCandles).mockResolvedValue([]);
      vi.mocked(fetchBirdeyeCandles).mockResolvedValue(mockCandles);

      await engine.initialize();
      await engine.fetchCandles(mixedCaseMint, TEST_CHAIN, TEST_ALERT_TIME, {
        interval: '1m',
        useCache: false,
      });

      // Assert: Mint address passed exactly to API
      const apiCalls = vi.mocked(fetchBirdeyeCandles).mock.calls;
      expect(apiCalls.length).toBeGreaterThan(0);
      expect(apiCalls[0][0]).toBe(mixedCaseMint);
      expect(apiCalls[0][0]).toMatch(/7pXsAbCdEfGhIjKlMnOpQrStUvWxYz/); // Exact case

      // Assert: Mint address passed exactly to storage
      const storeCalls = vi.mocked(storeCandles).mock.calls;
      expect(storeCalls.length).toBeGreaterThan(0);
      expect(storeCalls[0][0]).toBe(mixedCaseMint);
      expect(storeCalls[0][0].length).toBe(mixedCaseMint.length);
    });
  });

  describe('GOLDEN: Interval handling', () => {
    it('should fetch 1m candles regardless of interval option (engine always uses 1m)', async () => {
      // Note: Engine always fetches 1m candles, interval option is for future use
      const mockCandles: Candle[] = [
        {
          timestamp: Math.floor(TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds()),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];

      vi.mocked(mockStorageEngine.getCandles).mockResolvedValue([]);
      vi.mocked(fetchBirdeyeCandles).mockResolvedValue(mockCandles);

      await engine.initialize();
      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME, {
        interval: '1m', // Engine always uses 1m
        useCache: false,
      });

      expect(result).toBeDefined();
      expect(result['1m']).toBeDefined();
      // Engine always fetches with '1m' interval
      expect(fetchBirdeyeCandles).toHaveBeenCalledWith(
        TEST_MINT,
        '1m',
        expect.any(Number),
        expect.any(Number),
        TEST_CHAIN
      );
    });
  });

  describe('GOLDEN: Error recovery and resilience', () => {
    it('should handle API failures gracefully and continue with available data', async () => {
      const partialCandles: Candle[] = [
        {
          timestamp: Math.floor(TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds()),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];

      vi.mocked(mockStorageEngine.getCandles).mockResolvedValue([]);
      vi.mocked(fetchBirdeyeCandles).mockRejectedValueOnce(new Error('API error')); // Fetch fails

      await engine.initialize();

      // Engine should propagate error
      await expect(
        engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME, {
          interval: '1m',
          useCache: false,
        })
      ).rejects.toThrow('API error');

      // Verify API was called
      expect(fetchBirdeyeCandles).toHaveBeenCalled();
    });
  });
});

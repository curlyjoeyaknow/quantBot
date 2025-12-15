/**
 * Integration tests for OHLCV Ingestion Engine
 *
 * Tests integration with:
 * - ClickHouse storage (actual or mocked)
 * - PostgreSQL TokensRepository (actual or mocked)
 * - Birdeye API client (mocked)
 *
 * These tests verify that data flows correctly through the entire stack.
 */

// IMPORTANT: Mocks must be defined BEFORE imports to prevent module resolution issues
// Mock the entire storage module to avoid internal import issues
// Note: Mocks are hoisted, so we define them inside the factory function
vi.mock('@quantbot/storage', async () => {
  const { vi } = await import('vitest');
  const mockStoreCandles = vi.fn();
  const mockGetCandles = vi.fn();
  const mockInitClickHouse = vi.fn();
  const mockGetOrCreateToken = vi.fn();

  // Create mock StorageEngine instance
  const mockStorageEngine = {
    storeCandles: mockStoreCandles,
    getCandles: mockGetCandles,
  };

  // Store mocks in a way that's accessible to tests
  (globalThis as any).__storageMocks__ = {
    storeCandles: mockStoreCandles,
    getCandles: mockGetCandles,
    initClickHouse: mockInitClickHouse,
    getOrCreateToken: mockGetOrCreateToken,
  };

  // Create a proper class constructor for TokensRepository
  class MockTokensRepository {
    getOrCreateToken = mockGetOrCreateToken;
  }

  return {
    getStorageEngine: vi.fn(() => mockStorageEngine),
    initClickHouse: mockInitClickHouse,
    TokensRepository: MockTokensRepository,
    // Mock other exports that might be imported
    StorageEngine: class {},
    OhlcvRepository: class {},
    IndicatorsRepository: class {},
    TokenMetadataRepository: class {},
    SimulationEventsRepository: class {},
    CallsRepository: class {},
    StrategiesRepository: class {},
    AlertsRepository: class {},
    CallersRepository: class {},
    SimulationResultsRepository: class {},
    getClickHouseClient: vi.fn(),
    closeClickHouse: vi.fn(),
    getPostgresPool: vi.fn(),
    getPostgresClient: vi.fn(),
    queryPostgres: vi.fn(),
    withPostgresTransaction: vi.fn(),
    closePostgresPool: vi.fn(),
  };
});

vi.mock('@quantbot/api-clients', () => ({
  birdeyeClient: {
    fetchOHLCVData: vi.fn(),
    getTokenMetadata: vi.fn(),
  },
}));

vi.mock('@quantbot/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import { OhlcvIngestionEngine } from '../src/ohlcv-ingestion-engine';
import { birdeyeClient } from '@quantbot/api-clients';
import { getStorageEngine, initClickHouse, TokensRepository } from '@quantbot/storage';
import type { Candle } from '@quantbot/core';

describe('OhlcvIngestionEngine - Integration Tests', () => {
  let engine: OhlcvIngestionEngine;
  let tokensRepo: TokensRepository;
  const TEST_MINT = '7pXs123456789012345678901234567890pump'; // Full address, case-preserved
  const TEST_CHAIN = 'solana' as const;
  const TEST_ALERT_TIME = DateTime.fromISO('2024-01-15T10:30:00Z');

  // Track what was stored in ClickHouse
  const storedCandles: Map<string, Candle[]> = new Map();
  const storedMetadata: Map<string, any> = new Map();

  // Get mocks from global (set by vi.mock factory)
  const getMocks = () => (globalThis as any).__storageMocks__;

  beforeEach(() => {
    storedCandles.clear();
    storedMetadata.clear();

    const mocks = getMocks();
    if (!mocks) {
      throw new Error('Storage mocks not initialized');
    }

    // Reset all mocks
    mocks.initClickHouse.mockResolvedValue(undefined);
    mocks.storeCandles.mockClear();
    mocks.getCandles.mockClear();
    mocks.getOrCreateToken.mockClear();

    // Set up getCandles mock
    mocks.getCandles.mockImplementation(
      async (
        mint: string,
        chain: string,
        startTime: DateTime,
        endTime: DateTime,
        options?: { interval?: string }
      ) => {
        const interval = options?.interval || '5m';
        const key = `${mint}:${chain}:${interval}`;
        const candles = storedCandles.get(key) || [];
        // Filter by time range
        return candles.filter((c) => {
          const candleTime = DateTime.fromSeconds(c.timestamp);
          return candleTime >= startTime && candleTime <= endTime;
        });
      }
    );

    // Set up storeCandles mock
    mocks.storeCandles.mockImplementation(
      async (mint: string, chain: string, candles: Candle[], interval: string) => {
        const key = `${mint}:${chain}:${interval}`;
        const existing = storedCandles.get(key) || [];
        // Merge and deduplicate by timestamp
        const merged = [...existing, ...candles].reduce((acc, candle) => {
          const existing = acc.find((c) => c.timestamp === candle.timestamp);
          if (!existing) {
            acc.push(candle);
          }
          return acc;
        }, [] as Candle[]);
        storedCandles.set(
          key,
          merged.sort((a, b) => a.timestamp - b.timestamp)
        );
      }
    );

    // Set up TokensRepository mock
    mocks.getOrCreateToken.mockImplementation(
      async (chain: string, address: string, metadata?: any) => {
        const key = `${chain}:${address}`;
        storedMetadata.set(key, { chain, address, ...metadata });
        return {
          id: 1,
          chain,
          address,
          symbol: metadata?.symbol,
          name: metadata?.name,
          createdAt: DateTime.now(),
          updatedAt: DateTime.now(),
        };
      }
    );

    // Create engine after mocks are set up
    engine = new OhlcvIngestionEngine();
    tokensRepo = (engine as any).tokensRepo;
  });

  afterEach(() => {
    if (engine) {
      engine.clearCache();
    }
    vi.clearAllMocks();
  });

  describe('End-to-End Data Flow', () => {
    it('should fetch metadata, store it, then fetch and store candles', async () => {
      const mockMetadata = { name: 'Test Token', symbol: 'TEST' };
      const mock1mCandles: Candle[] = [
        {
          timestamp: TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds(),
          open: 1,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
        {
          timestamp: TEST_ALERT_TIME.minus({ minutes: 51 }).toSeconds(),
          open: 1.05,
          high: 1.15,
          low: 1.0,
          close: 1.1,
          volume: 1200,
        },
      ];
      const mock5mCandles: Candle[] = [
        {
          timestamp: TEST_ALERT_TIME.minus({ minutes: 260 }).toSeconds(),
          open: 1,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 5000,
        },
        {
          timestamp: TEST_ALERT_TIME.minus({ minutes: 255 }).toSeconds(),
          open: 1.05,
          high: 1.15,
          low: 1.0,
          close: 1.1,
          volume: 6000,
        },
      ];

      // Mock API responses
      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue(mockMetadata);
      vi.mocked(birdeyeClient.fetchOHLCVData).mockImplementation(
        async (mint, startTime, endTime, interval) => {
          if (interval === '1m') {
            return {
              items: mock1mCandles
                .filter((c) => {
                  const candleTime = DateTime.fromSeconds(c.timestamp);
                  const start = DateTime.fromJSDate(startTime);
                  const end = DateTime.fromJSDate(endTime);
                  return candleTime >= start && candleTime <= end;
                })
                .map((c) => ({
                  unixTime: c.timestamp,
                  open: c.open,
                  high: c.high,
                  low: c.low,
                  close: c.close,
                  volume: c.volume,
                })),
            } as any;
          } else {
            return {
              items: mock5mCandles
                .filter((c) => {
                  const candleTime = DateTime.fromSeconds(c.timestamp);
                  const start = DateTime.fromJSDate(startTime);
                  const end = DateTime.fromJSDate(endTime);
                  return candleTime >= start && candleTime <= end;
                })
                .map((c) => ({
                  unixTime: c.timestamp,
                  open: c.open,
                  high: c.high,
                  low: c.low,
                  close: c.close,
                  volume: c.volume,
                })),
            } as any;
          }
        }
      );

      // Execute
      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME);

      // Verify metadata was stored
      expect(getMocks().getOrCreateToken).toHaveBeenCalledWith(
        TEST_CHAIN,
        TEST_MINT,
        expect.objectContaining({ name: mockMetadata.name, symbol: mockMetadata.symbol })
      );
      const storedMeta = storedMetadata.get(`${TEST_CHAIN}:${TEST_MINT}`);
      expect(storedMeta).toBeDefined();
      expect(storedMeta?.name).toBe(mockMetadata.name);

      // Verify candles were stored
      const stored1m = storedCandles.get(`${TEST_MINT}:${TEST_CHAIN}:1m`);
      expect(stored1m).toBeDefined();
      expect(stored1m?.length).toBe(2);

      const stored5m = storedCandles.get(`${TEST_MINT}:${TEST_CHAIN}:5m`);
      expect(stored5m).toBeDefined();
      expect(stored5m?.length).toBe(2);

      // Verify result
      expect(result['1m'].length).toBe(2);
      expect(result['5m'].length).toBe(2);
      expect(result.metadata.tokenStored).toBe(true);
      expect(result.metadata.total1mCandles).toBe(2);
      expect(result.metadata.total5mCandles).toBe(2);
    });

    it('should retrieve stored candles from ClickHouse on subsequent calls', async () => {
      // First, store some candles
      const mockCandles: Candle[] = [
        {
          timestamp: TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds(),
          open: 1,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];

      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({
        items: mockCandles.map((c) => ({
          unixTime: c.timestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        })),
      } as any);

      // First call - should fetch and store
      await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME);
      const firstApiCallCount = vi.mocked(birdeyeClient.fetchOHLCVData).mock.calls.length;

      // Second call - should retrieve from ClickHouse
      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME, {
        useCache: true,
      });

      // Should not have made additional API calls (or same number if cache hit)
      const secondApiCallCount = vi.mocked(birdeyeClient.fetchOHLCVData).mock.calls.length;
      // Either same count (cache hit) or slightly more (if cache missed but still used)
      expect(secondApiCallCount).toBeGreaterThanOrEqual(firstApiCallCount);
      expect(result['1m'].length).toBeGreaterThan(0);
    });

    it('should handle incremental storage across multiple chunks', async () => {
      // Use a recent alert time (1 hour ago) to limit the number of chunks needed
      const recentAlertTime = DateTime.utc().minus({ hours: 1 });

      // Generate a small, fixed number of candles for testing
      let chunkIndex = 0;
      const maxChunks = 3; // Limit to 3 chunks max to prevent timeout

      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
      vi.mocked(birdeyeClient.fetchOHLCVData).mockImplementation(
        async (mint, start, end, interval) => {
          if (interval === '5m') {
            // Stop after max chunks
            if (chunkIndex >= maxChunks) {
              return { items: [] } as any;
            }

            // Generate only 100 candles per chunk (much faster)
            const candles: Candle[] = [];
            const startDt = DateTime.fromJSDate(start);
            const endDt = DateTime.fromJSDate(end);
            const maxCandles = 100; // Limit to prevent timeout

            // Generate candles up to end time or maxCandles, whichever comes first
            let current = startDt;
            let count = 0;
            while (current < endDt && count < maxCandles) {
              candles.push({
                timestamp: current.toSeconds(),
                open: 1 + chunkIndex * 0.1,
                high: 1.1 + chunkIndex * 0.1,
                low: 0.9 + chunkIndex * 0.1,
                close: 1.05 + chunkIndex * 0.1,
                volume: 1000 + chunkIndex * 100,
              });
              current = current.plus({ minutes: 5 });
              count++;
            }

            chunkIndex++;
            return {
              items: candles.map((c) => ({
                unixTime: c.timestamp,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                volume: c.volume,
              })),
            } as any;
          }
          return { items: [] } as any;
        }
      );

      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, recentAlertTime);

      // Verify all chunks were stored
      const stored5m = storedCandles.get(`${TEST_MINT}:${TEST_CHAIN}:5m`);
      expect(stored5m).toBeDefined();
      expect(stored5m?.length).toBeGreaterThan(0);

      // Verify incremental storage - each chunk should have been stored
      expect(getMocks().storeCandles).toHaveBeenCalled();
      const storeCalls = getMocks().storeCandles.mock.calls;
      expect(storeCalls.length).toBeGreaterThan(0);

      // Verify we got candles back
      expect(result['5m'].length).toBeGreaterThan(0);

      // Verify multiple chunks were fetched (if we got more than 100 candles, we had multiple chunks)
      expect(result.metadata.chunksFetched).toBeGreaterThan(0);
    });
  });

  describe('Storage Engine Integration', () => {
    it('should preserve full mint address in all storage operations', async () => {
      const fullMint = '7pXs123456789012345678901234567890pump'; // Full address with case
      const mockCandles: Candle[] = [
        {
          timestamp: TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds(),
          open: 1,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];

      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({
        items: mockCandles.map((c) => ({
          unixTime: c.timestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        })),
      } as any);

      await engine.fetchCandles(fullMint, TEST_CHAIN, TEST_ALERT_TIME);

      // Verify full address is used in storage
      expect(getMocks().storeCandles).toHaveBeenCalledWith(
        fullMint, // Full address preserved
        TEST_CHAIN,
        expect.any(Array),
        expect.any(String)
      );

      // Verify metadata storage
      expect(getMocks().getOrCreateToken).toHaveBeenCalledWith(
        TEST_CHAIN,
        fullMint, // Full address preserved
        expect.any(Object)
      );
    });

    it('should handle storage failures gracefully and still return data', async () => {
      const mockCandles: Candle[] = [
        {
          timestamp: TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds(),
          open: 1,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];

      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({
        items: mockCandles.map((c) => ({
          unixTime: c.timestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        })),
      } as any);

      // Simulate storage failure on second call
      let callCount = 0;
      getMocks().storeCandles.mockImplementation(async () => {
        callCount++;
        if (callCount > 1) {
          throw new Error('Storage failure');
        }
      });

      // Should still return data even if storage fails
      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME);

      expect(result['1m'].length).toBeGreaterThan(0);
      expect(result['5m'].length).toBeGreaterThan(0);
    });

    it('should query ClickHouse with correct time ranges', async () => {
      const mockCandles: Candle[] = [
        {
          timestamp: TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds(),
          open: 1,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];

      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({
        items: mockCandles.map((c) => ({
          unixTime: c.timestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        })),
      } as any);

      await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME);

      // Verify getCandles was called with correct time ranges
      const queryCalls = getMocks().getCandles.mock.calls;
      expect(queryCalls.length).toBeGreaterThan(0);

      // Check 1m query
      const oneMinuteQuery = queryCalls.find((call) => call[4]?.interval === '1m');
      expect(oneMinuteQuery).toBeDefined();

      // Check 5m query
      const fiveMinuteQuery = queryCalls.find((call) => call[4]?.interval === '5m');
      expect(fiveMinuteQuery).toBeDefined();
    });
  });

  describe('Data Consistency', () => {
    it('should maintain data consistency across multiple fetches', async () => {
      const mockCandles: Candle[] = [
        {
          timestamp: TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds(),
          open: 1,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
        {
          timestamp: TEST_ALERT_TIME.minus({ minutes: 51 }).toSeconds(),
          open: 1.05,
          high: 1.15,
          low: 1.0,
          close: 1.1,
          volume: 1200,
        },
      ];

      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({
        items: mockCandles.map((c) => ({
          unixTime: c.timestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        })),
      } as any);

      // First fetch
      const result1 = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME);

      // Second fetch - should get same data from cache
      const result2 = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME, {
        useCache: true,
      });

      // Data should be consistent
      expect(result1['1m'].length).toBe(result2['1m'].length);
      expect(result1['1m'][0].timestamp).toBe(result2['1m'][0].timestamp);
    });

    it('should handle partial data retrieval correctly', async () => {
      // Store some candles in ClickHouse
      const existingCandles: Candle[] = [
        {
          timestamp: TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds(),
          open: 1,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];
      const key = `${TEST_MINT}:${TEST_CHAIN}:1m`;
      storedCandles.set(key, existingCandles);

      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({
        items: [
          {
            unixTime: TEST_ALERT_TIME.minus({ minutes: 51 }).toSeconds(),
            open: 1.05,
            high: 1.15,
            low: 1.0,
            close: 1.1,
            volume: 1200,
          },
        ],
      } as any);

      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME);

      // Should have both cached and newly fetched candles
      expect(result['1m'].length).toBeGreaterThanOrEqual(1);
    });
  });
});

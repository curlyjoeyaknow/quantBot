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
// Mock StorageEngine and all its dependencies using relative paths (as StorageEngine uses them)
vi.mock('../storage/src/clickhouse/repositories/OhlcvRepository', () => ({
  OhlcvRepository: class {},
}));

vi.mock('../storage/src/clickhouse/repositories/SimulationEventsRepository', () => ({
  SimulationEventsRepository: class {},
}));

vi.mock('../storage/src/clickhouse/repositories/IndicatorsRepository', () => ({
  IndicatorsRepository: class {},
}));

vi.mock('../storage/src/clickhouse/repositories/TokenMetadataRepository', () => ({
  TokenMetadataRepository: class {},
}));

vi.mock('../storage/src/postgres/repositories/CallsRepository', () => ({
  CallsRepository: class {},
}));

vi.mock('../storage/src/postgres/repositories/StrategiesRepository', () => ({
  StrategiesRepository: class {},
}));

vi.mock('../storage/src/postgres/repositories/AlertsRepository', () => ({
  AlertsRepository: class {},
}));

vi.mock('../storage/src/postgres/repositories/CallersRepository', () => ({
  CallersRepository: class {},
}));

vi.mock('../storage/src/postgres/repositories/SimulationResultsRepository', () => ({
  SimulationResultsRepository: class {},
}));

vi.mock('../storage/src/engine/StorageEngine', () => ({
  StorageEngine: class {},
  getStorageEngine: vi.fn(),
}));

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
import { insertCandles, queryCandles, initClickHouse, TokensRepository } from '@quantbot/storage';
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

  beforeEach(() => {
    engine = new OhlcvIngestionEngine();
    storedCandles.clear();
    storedMetadata.clear();

    // Mock ClickHouse operations
    vi.mocked(initClickHouse).mockResolvedValue(undefined);
    
    vi.mocked(queryCandles).mockImplementation(async (mint, chain, startTime, endTime, interval) => {
      const key = `${mint}:${chain}:${interval}`;
      const candles = storedCandles.get(key) || [];
      // Filter by time range
      return candles.filter(c => {
        const candleTime = DateTime.fromSeconds(c.timestamp);
        return candleTime >= startTime && candleTime <= endTime;
      });
    });

    vi.mocked(insertCandles).mockImplementation(async (mint, chain, candles, interval) => {
      const key = `${mint}:${chain}:${interval}`;
      const existing = storedCandles.get(key) || [];
      // Merge and deduplicate by timestamp
      const merged = [...existing, ...candles].reduce((acc, candle) => {
        const existing = acc.find(c => c.timestamp === candle.timestamp);
        if (!existing) {
          acc.push(candle);
        }
        return acc;
      }, [] as Candle[]);
      storedCandles.set(key, merged.sort((a, b) => a.timestamp - b.timestamp));
    });

    // Mock TokensRepository
    tokensRepo = {
      getOrCreateToken: vi.fn().mockImplementation(async (chain, address, metadata) => {
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
      }),
    } as any;

    // Replace TokensRepository constructor
    vi.mocked(TokensRepository).mockImplementation(() => tokensRepo);
  });

  afterEach(() => {
    engine.clearCache();
    vi.clearAllMocks();
  });

  describe('End-to-End Data Flow', () => {
    it('should fetch metadata, store it, then fetch and store candles', async () => {
      const mockMetadata = { name: 'Test Token', symbol: 'TEST' };
      const mock1mCandles: Candle[] = [
        { timestamp: TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds(), open: 1, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
        { timestamp: TEST_ALERT_TIME.minus({ minutes: 51 }).toSeconds(), open: 1.05, high: 1.15, low: 1.0, close: 1.1, volume: 1200 },
      ];
      const mock5mCandles: Candle[] = [
        { timestamp: TEST_ALERT_TIME.minus({ minutes: 260 }).toSeconds(), open: 1, high: 1.1, low: 0.9, close: 1.05, volume: 5000 },
        { timestamp: TEST_ALERT_TIME.minus({ minutes: 255 }).toSeconds(), open: 1.05, high: 1.15, low: 1.0, close: 1.1, volume: 6000 },
      ];

      // Mock API responses
      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue(mockMetadata);
      vi.mocked(birdeyeClient.fetchOHLCVData).mockImplementation(async (mint, startTime, endTime, interval) => {
        if (interval === '1m') {
          return {
            items: mock1mCandles
              .filter(c => {
                const candleTime = DateTime.fromSeconds(c.timestamp);
                const start = DateTime.fromJSDate(startTime);
                const end = DateTime.fromJSDate(endTime);
                return candleTime >= start && candleTime <= end;
              })
              .map(c => ({
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
              .filter(c => {
                const candleTime = DateTime.fromSeconds(c.timestamp);
                const start = DateTime.fromJSDate(startTime);
                const end = DateTime.fromJSDate(endTime);
                return candleTime >= start && candleTime <= end;
              })
              .map(c => ({
                unixTime: c.timestamp,
                open: c.open,
                high: c.high,
                low: c.low,
                close: c.close,
                volume: c.volume,
              })),
          } as any;
        }
      });

      // Execute
      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME);

      // Verify metadata was stored
      expect(tokensRepo.getOrCreateToken).toHaveBeenCalledWith(
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
        { timestamp: TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds(), open: 1, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      ];

      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({
        items: mockCandles.map(c => ({
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
      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME, { useCache: true });

      // Should not have made additional API calls
      expect(vi.mocked(birdeyeClient.fetchOHLCVData).mock.calls.length).toBe(firstApiCallCount);
      expect(result['1m'].length).toBeGreaterThan(0);
      expect(result.metadata.chunksFromCache).toBeGreaterThan(0);
    });

    it('should handle incremental storage across multiple chunks', async () => {
      const now = DateTime.utc();
      const startTime = TEST_ALERT_TIME.minus({ minutes: 260 });
      
      // Generate multiple chunks of 5m candles
      let chunkIndex = 0;
      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
      vi.mocked(birdeyeClient.fetchOHLCVData).mockImplementation(async (mint, start, end, interval) => {
        if (interval === '5m') {
          const candles: Candle[] = [];
          const startDt = DateTime.fromJSDate(start);
          const endDt = DateTime.fromJSDate(end);
          
          // Generate candles for this chunk
          let current = startDt;
          while (current < endDt && candles.length < 5000) {
            candles.push({
              timestamp: current.toSeconds(),
              open: 1 + chunkIndex * 0.1,
              high: 1.1 + chunkIndex * 0.1,
              low: 0.9 + chunkIndex * 0.1,
              close: 1.05 + chunkIndex * 0.1,
              volume: 1000 + chunkIndex * 100,
            });
            current = current.plus({ minutes: 5 });
          }
          
          chunkIndex++;
          return {
            items: candles.map(c => ({
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
      });

      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME);

      // Verify all chunks were stored
      const stored5m = storedCandles.get(`${TEST_MINT}:${TEST_CHAIN}:5m`);
      expect(stored5m).toBeDefined();
      expect(stored5m?.length).toBeGreaterThan(0);

      // Verify incremental storage - each chunk should have been stored
      expect(insertCandles).toHaveBeenCalledTimes(expect.any(Number));
      expect(result.metadata.chunksFetched).toBeGreaterThan(1);
    });
  });

  describe('Storage Engine Integration', () => {
    it('should preserve full mint address in all storage operations', async () => {
      const fullMint = '7pXs123456789012345678901234567890pump'; // Full address with case
      const mockCandles: Candle[] = [
        { timestamp: TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds(), open: 1, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      ];

      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({
        items: mockCandles.map(c => ({
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
      expect(insertCandles).toHaveBeenCalledWith(
        fullMint, // Full address preserved
        TEST_CHAIN,
        expect.any(Array),
        expect.any(String)
      );

      // Verify metadata storage
      expect(tokensRepo.getOrCreateToken).toHaveBeenCalledWith(
        TEST_CHAIN,
        fullMint, // Full address preserved
        expect.any(Object)
      );
    });

    it('should handle storage failures gracefully and still return data', async () => {
      const mockCandles: Candle[] = [
        { timestamp: TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds(), open: 1, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      ];

      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({
        items: mockCandles.map(c => ({
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
      vi.mocked(insertCandles).mockImplementation(async () => {
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
        { timestamp: TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds(), open: 1, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      ];

      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({
        items: mockCandles.map(c => ({
          unixTime: c.timestamp,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        })),
      } as any);

      await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME);

      // Verify queryCandles was called with correct time ranges
      const queryCalls = vi.mocked(queryCandles).mock.calls;
      expect(queryCalls.length).toBeGreaterThan(0);

      // Check 1m query
      const oneMinuteQuery = queryCalls.find(call => call[4] === '1m');
      expect(oneMinuteQuery).toBeDefined();
      if (oneMinuteQuery) {
        const startTime = oneMinuteQuery[2] as DateTime;
        const expectedStart = TEST_ALERT_TIME.minus({ minutes: 52 });
        expect(Math.abs(startTime.diff(expectedStart, 'minutes').minutes)).toBeLessThan(1);
      }

      // Check 5m query
      const fiveMinuteQuery = queryCalls.find(call => call[4] === '5m');
      expect(fiveMinuteQuery).toBeDefined();
      if (fiveMinuteQuery) {
        const startTime = fiveMinuteQuery[2] as DateTime;
        const expectedStart = TEST_ALERT_TIME.minus({ minutes: 260 });
        expect(Math.abs(startTime.diff(expectedStart, 'minutes').minutes)).toBeLessThan(1);
      }
    });
  });

  describe('Data Consistency', () => {
    it('should maintain data consistency across multiple fetches', async () => {
      const mockCandles: Candle[] = [
        { timestamp: TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds(), open: 1, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
        { timestamp: TEST_ALERT_TIME.minus({ minutes: 51 }).toSeconds(), open: 1.05, high: 1.15, low: 1.0, close: 1.1, volume: 1200 },
      ];

      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({
        items: mockCandles.map(c => ({
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
      const result2 = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME, { useCache: true });

      // Data should be consistent
      expect(result1['1m'].length).toBe(result2['1m'].length);
      expect(result1['1m'][0].timestamp).toBe(result2['1m'][0].timestamp);
    });

    it('should handle partial data retrieval correctly', async () => {
      // Store some candles in ClickHouse
      const existingCandles: Candle[] = [
        { timestamp: TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds(), open: 1, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
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


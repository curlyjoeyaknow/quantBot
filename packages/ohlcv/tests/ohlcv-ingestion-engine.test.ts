/**
 * Unit tests for OHLCV Ingestion Engine
 *
 * Tests cover:
 * - Metadata fetching and storage
 * - 1m and 5m candle fetching strategies
 * - Multi-layer caching (in-memory, ClickHouse)
 * - Incremental storage
 * - Error handling
 * - Mint address preservation (CRITICAL)
 */

// IMPORTANT: Mocks must be defined BEFORE imports to prevent module resolution issues
// Mock dependencies
const mockStorageEngine = {
  storeCandles: vi.fn(),
  getCandles: vi.fn(),
};

// Create mock birdeyeClient - must be defined before the mock
const mockBirdeyeClient = {
  fetchOHLCVData: vi.fn(),
  getTokenMetadata: vi.fn(),
  fetchHistoricalPriceAtUnixTime: vi.fn(),
};

vi.mock('@quantbot/api-clients', () => ({
  birdeyeClient: mockBirdeyeClient,
  getBirdeyeClient: () => mockBirdeyeClient,
}));

vi.mock('@quantbot/storage', () => ({
  getStorageEngine: vi.fn(() => mockStorageEngine),
  initClickHouse: vi.fn(),
  TokensRepository: vi.fn(),
}));

vi.mock('@quantbot/ingestion', () => ({
  fetchMultiChainMetadata: vi.fn(),
  isEvmAddress: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import { OhlcvIngestionEngine } from '../src/ohlcv-ingestion-engine';
import { getBirdeyeClient } from '@quantbot/api-clients';
import { getStorageEngine, initClickHouse, TokensRepository } from '@quantbot/storage';
import { fetchMultiChainMetadata, isEvmAddress } from '@quantbot/ingestion';
import type { Candle } from '@quantbot/core';

// Get the mocked birdeyeClient
const birdeyeClient = getBirdeyeClient();

vi.mock('@quantbot/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('OhlcvIngestionEngine', () => {
  let engine: OhlcvIngestionEngine;
  const TEST_MINT = '7pXs123456789012345678901234567890pump'; // Full address, case-preserved
  const TEST_CHAIN = 'solana' as const;
  const TEST_ALERT_TIME = DateTime.fromISO('2024-01-15T10:30:00Z');

  beforeEach(() => {
    engine = new OhlcvIngestionEngine();
    vi.clearAllMocks();
    vi.mocked(initClickHouse).mockResolvedValue(undefined);

    // Mock TokensRepository
    const mockTokensRepo = {
      getOrCreateToken: vi.fn().mockResolvedValue({
        id: 1,
        chain: TEST_CHAIN,
        address: TEST_MINT,
        symbol: 'TEST',
        name: 'Test Token',
      }),
    };
    vi.mocked(TokensRepository).mockImplementation(function () {
      return mockTokensRepo as any;
    });

    // Default mocks for birdeyeClient
    vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
    vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({ items: [] } as any);
    // Mock fetchHistoricalPriceAtUnixTime for the probe (returns a price to indicate data exists, so probe continues)
    vi.mocked(birdeyeClient.fetchHistoricalPriceAtUnixTime).mockResolvedValue({
      value: 1.0,
    } as any);

    // Default mocks for ingestion functions - default to Solana addresses
    vi.mocked(isEvmAddress).mockReturnValue(false);
    vi.mocked(fetchMultiChainMetadata).mockResolvedValue({
      address: TEST_MINT,
      addressKind: 'solana',
      metadata: [],
      primaryMetadata: undefined,
    });
  });

  afterEach(() => {
    engine.clearCache();
  });

  describe('initialize', () => {
    it('should initialize ClickHouse', async () => {
      await engine.initialize();
      expect(initClickHouse).toHaveBeenCalled();
    });

    it('should only initialize once', async () => {
      await engine.initialize();
      await engine.initialize();
      expect(initClickHouse).toHaveBeenCalledTimes(1);
    });

    it('should handle initialization errors', async () => {
      vi.mocked(initClickHouse).mockRejectedValue(new Error('Init failed'));
      await expect(engine.initialize()).rejects.toThrow('Init failed');
    });
  });

  describe('fetchCandles - Metadata', () => {
    it('should fetch and store metadata before candles', async () => {
      const mockMetadata = { name: 'Test Token', symbol: 'TEST' };
      // For Solana addresses, birdeyeClient.getTokenMetadata is still used directly
      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue(mockMetadata);
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({ items: [] } as any);
      // Mock fetchHistoricalPriceAtUnixTime for the probe (returns a price to indicate data exists, so probe continues)
      vi.mocked(birdeyeClient.fetchHistoricalPriceAtUnixTime).mockResolvedValue({
        value: 1.0,
      } as any);
      mockStorageEngine.getCandles.mockResolvedValue([]);
      // Ensure isEvmAddress returns false for Solana addresses
      vi.mocked(isEvmAddress).mockReturnValue(false);

      await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME);

      expect(birdeyeClient.getTokenMetadata).toHaveBeenCalledWith(TEST_MINT, TEST_CHAIN);
      // TokensRepository instance method should be called
      const tokensRepoInstance = (engine as any).tokensRepo;
      expect(tokensRepoInstance.getOrCreateToken).toHaveBeenCalledWith(
        TEST_CHAIN,
        TEST_MINT,
        expect.objectContaining({ name: mockMetadata.name, symbol: mockMetadata.symbol })
      );
    });

    it('should continue even if metadata fetch fails', async () => {
      vi.mocked(birdeyeClient.getTokenMetadata).mockRejectedValue(new Error('Metadata failed'));
      vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({ items: [] } as any);
      mockStorageEngine.getCandles.mockResolvedValue([]);

      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME);

      expect(result.metadata.tokenStored).toBe(false);
      // Should still fetch candles
      expect(birdeyeClient.fetchOHLCVData).toHaveBeenCalled();
    });
  });

  describe('fetchCandles - 1m Candles', () => {
    it('should fetch 1m candles from -52 minutes before alert', async () => {
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
      mockStorageEngine.getCandles.mockResolvedValue([]);
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

      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME);

      expect(result['1m'].length).toBe(2);
      expect(result.metadata.total1mCandles).toBe(2);

      // Verify fetch was called with correct time range
      const fetchCall = vi
        .mocked(birdeyeClient.fetchOHLCVData)
        .mock.calls.find((call) => call[3] === '1m');
      expect(fetchCall).toBeDefined();
      if (fetchCall) {
        const startTime = DateTime.fromJSDate(fetchCall[1] as Date);
        const expectedStart = TEST_ALERT_TIME.minus({ minutes: 52 });
        expect(Math.abs(startTime.diff(expectedStart, 'minutes').minutes)).toBeLessThan(1);
      }
    });

    it('should use cache for 1m candles if available', async () => {
      const cachedCandles: Candle[] = [
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
      mockStorageEngine.getCandles.mockResolvedValue(cachedCandles);

      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME, {
        useCache: true,
      });

      expect(result['1m']).toEqual(cachedCandles);
      expect(result.metadata.chunksFromCache).toBeGreaterThan(0);
      expect(birdeyeClient.fetchOHLCVData).not.toHaveBeenCalled();
    });

    it('should store 1m candles immediately after fetching', async () => {
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
      mockStorageEngine.getCandles.mockResolvedValue([]);
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

      expect(mockStorageEngine.storeCandles).toHaveBeenCalledWith(
        TEST_MINT,
        TEST_CHAIN,
        expect.arrayContaining([expect.objectContaining({ timestamp: mockCandles[0].timestamp })]),
        '1m'
      );
    });
  });

  describe('fetchCandles - 5m Candles', () => {
    it('should fetch 5m candles from -260 minutes before alert', async () => {
      const mockCandles: Candle[] = [
        {
          timestamp: TEST_ALERT_TIME.minus({ minutes: 260 }).toSeconds(),
          open: 1,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
        {
          timestamp: TEST_ALERT_TIME.minus({ minutes: 255 }).toSeconds(),
          open: 1.05,
          high: 1.15,
          low: 1.0,
          close: 1.1,
          volume: 1200,
        },
      ];

      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
      mockStorageEngine.getCandles.mockResolvedValue([]);
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

      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME);

      expect(result['5m'].length).toBe(2);
      expect(result.metadata.total5mCandles).toBe(2);

      // Verify fetch was called with correct time range
      const fetchCall = vi
        .mocked(birdeyeClient.fetchOHLCVData)
        .mock.calls.find((call) => call[3] === '5m');
      expect(fetchCall).toBeDefined();
      if (fetchCall) {
        const startTime = DateTime.fromJSDate(fetchCall[1] as Date);
        const expectedStart = TEST_ALERT_TIME.minus({ minutes: 260 });
        expect(Math.abs(startTime.diff(expectedStart, 'minutes').minutes)).toBeLessThan(1);
      }
    });

    it('should chunk 5m candles when fetching large time ranges', async () => {
      const now = DateTime.utc();
      const startTime = TEST_ALERT_TIME.minus({ minutes: 260 });

      // Simulate multiple chunks
      let chunkCount = 0;
      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
      mockStorageEngine.getCandles.mockResolvedValue([]);
      vi.mocked(birdeyeClient.fetchOHLCVData).mockImplementation(() => {
        chunkCount++;
        const candles: Candle[] = [];
        // Return 5000 candles per chunk
        for (let i = 0; i < 5000; i++) {
          candles.push({
            timestamp: startTime.plus({ minutes: i * 5 }).toSeconds(),
            open: 1,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 1000,
          });
        }
        return Promise.resolve({
          items: candles.map((c) => ({
            unixTime: c.timestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
          })),
        } as any);
      });

      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME);

      // Should have fetched multiple chunks
      expect(result.metadata.chunksFetched).toBeGreaterThan(1);
      expect(result.metadata.chunksFromAPI).toBeGreaterThan(0);
    });

    it('should store each 5m chunk immediately', async () => {
      const mockCandles: Candle[] = [
        {
          timestamp: TEST_ALERT_TIME.minus({ minutes: 260 }).toSeconds(),
          open: 1,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];

      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
      mockStorageEngine.getCandles.mockResolvedValue([]);
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

      expect(mockStorageEngine.storeCandles).toHaveBeenCalledWith(
        TEST_MINT,
        TEST_CHAIN,
        expect.arrayContaining([expect.objectContaining({ timestamp: mockCandles[0].timestamp })]),
        '5m'
      );
    });
  });

  describe('Caching', () => {
    it('should use in-memory cache on subsequent calls', async () => {
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
      mockStorageEngine.getCandles.mockResolvedValue([]);
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

      // First call - should fetch from API
      await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME);
      const firstCallCount = vi.mocked(birdeyeClient.fetchOHLCVData).mock.calls.length;

      // Second call - should use cache
      mockStorageEngine.getCandles.mockResolvedValue(mockCandles);
      await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME, { useCache: true });

      // Should not have made additional API calls
      expect(vi.mocked(birdeyeClient.fetchOHLCVData).mock.calls.length).toBe(firstCallCount);
    });

    it('should bypass cache when forceRefresh is true', async () => {
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
      mockStorageEngine.getCandles.mockResolvedValue(mockCandles);
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

      await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME, { forceRefresh: true });

      // Should have called API despite cache
      expect(birdeyeClient.fetchOHLCVData).toHaveBeenCalled();
    });

    it('should use ClickHouse cache before API', async () => {
      const cachedCandles: Candle[] = [
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
      mockStorageEngine.getCandles.mockResolvedValue(cachedCandles);

      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME, {
        useCache: true,
      });

      expect(result['1m']).toEqual(cachedCandles);
      expect(birdeyeClient.fetchOHLCVData).not.toHaveBeenCalled();
    });
  });

  describe('Mint Address Preservation', () => {
    it('should preserve full mint address in all operations', async () => {
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
      mockStorageEngine.getCandles.mockResolvedValue([]);
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

      // Verify full address is used in all calls
      expect(birdeyeClient.getTokenMetadata).toHaveBeenCalledWith(fullMint, TEST_CHAIN);
      expect(birdeyeClient.fetchOHLCVData).toHaveBeenCalledWith(
        fullMint,
        expect.any(Date),
        expect.any(Date),
        expect.any(String),
        TEST_CHAIN
      );
      expect(mockStorageEngine.storeCandles).toHaveBeenCalledWith(
        fullMint,
        TEST_CHAIN,
        expect.any(Array),
        expect.any(String)
      );
    });
  });

  describe('Error Handling', () => {
    it('should handle API fetch errors gracefully', async () => {
      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
      mockStorageEngine.getCandles.mockResolvedValue([]);
      vi.mocked(birdeyeClient.fetchOHLCVData).mockRejectedValue(new Error('API Error'));

      await expect(engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME)).rejects.toThrow(
        'API Error'
      );
    });

    it('should handle storage errors but still return data', async () => {
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
      mockStorageEngine.getCandles.mockResolvedValue([]);
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
      mockStorageEngine.storeCandles.mockRejectedValue(new Error('Storage Error'));

      // Should not throw - storage error is logged but doesn't prevent returning data
      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME);

      expect(result['1m'].length).toBeGreaterThan(0);
    });
  });

  describe('Cache Management', () => {
    it('should clear in-memory cache', () => {
      engine.clearCache();
      const stats = engine.getCacheStats();
      expect(stats.inMemoryEntries).toBe(0);
    });

    it('should track cache statistics', async () => {
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
      mockStorageEngine.getCandles.mockResolvedValue([]);
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

      const stats = engine.getCacheStats();
      expect(stats.inMemoryEntries).toBeGreaterThan(0);
      expect(stats.cacheSize).toBeGreaterThan(0);
    });
  });

  describe('Result Metadata', () => {
    it('should return comprehensive metadata', async () => {
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
          timestamp: TEST_ALERT_TIME.minus({ minutes: 260 }).toSeconds(),
          open: 1,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];

      vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
      mockStorageEngine.getCandles.mockResolvedValue([]);
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
      // Ensure isEvmAddress returns false for Solana addresses
      vi.mocked(isEvmAddress).mockReturnValue(false);

      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME);

      expect(result.metadata).toMatchObject({
        tokenStored: true,
        total1mCandles: expect.any(Number),
        total5mCandles: expect.any(Number),
        chunksFetched: expect.any(Number),
        chunksFromCache: expect.any(Number),
        chunksFromAPI: expect.any(Number),
      });
    });
  });
});

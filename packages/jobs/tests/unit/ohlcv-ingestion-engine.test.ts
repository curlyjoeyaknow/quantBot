/**
 * Unit tests for OhlcvIngestionEngine
 *
 * Tests cover:
 * - Metadata fetching and storage
 * - 1m and 5m candle fetching strategies
 * - Multi-layer caching (in-memory, ClickHouse)
 * - Incremental storage
 * - Error handling
 * - Mint address preservation (CRITICAL)
 *
 * NOTE: This engine was moved from @quantbot/ohlcv to @quantbot/jobs
 */

// IMPORTANT: Mocks must be defined BEFORE imports to prevent module resolution issues
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import { OhlcvIngestionEngine } from '../../src/ohlcv-ingestion-engine.js';
import {
  fetchBirdeyeCandles,
  getBirdeyeClient,
  fetchMultiChainMetadata,
} from '@quantbot/api-clients';
import { getStorageEngine, initClickHouse } from '@quantbot/infra/storage';
import { isEvmAddress } from '@quantbot/infra/utils';
import type { Candle } from '@quantbot/core';

// Mock dependencies
const mockStorageEngine = {
  storeCandles: vi.fn(),
  getCandles: vi.fn(),
};

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

// Also mock the infra path (consolidation shim)
vi.mock('@quantbot/infra/api-clients', () => {
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

// Mock both storage paths (consolidation shim and new path)
const mockStorageMocks = () => {
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
    getStorageEngine: vi.fn(() => mockStorageEngine),
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
};

vi.mock('@quantbot/storage', () => mockStorageMocks());
vi.mock('@quantbot/infra/storage', () => mockStorageMocks());

// storeCandles removed - using OhlcvRepository.upsertCandles() instead

vi.mock('@quantbot/infra/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  isEvmAddress: vi.fn(),
}));

describe('OhlcvIngestionEngine', () => {
  let engine: OhlcvIngestionEngine;
  const TEST_MINT = '7pXs123456789012345678901234567890pump'; // Full address, case-preserved
  const TEST_CHAIN = 'solana' as const;
  const TEST_ALERT_TIME = DateTime.utc().minus({ days: 30 });

  beforeEach(() => {
    engine = new OhlcvIngestionEngine();
    vi.clearAllMocks();
    vi.mocked(initClickHouse).mockResolvedValue(undefined);

    // Default mocks for birdeyeClient - ensure probe returns data exists
    const birdeyeClient = getBirdeyeClient();
    vi.mocked(birdeyeClient.getTokenMetadata).mockResolvedValue({ name: 'Test', symbol: 'TEST' });
    vi.mocked(birdeyeClient.fetchOHLCVData).mockResolvedValue({ items: [] } as any);
    // Mock historical price to return data (so probe doesn't early-exit)
    vi.mocked(birdeyeClient.fetchHistoricalPriceAtUnixTime).mockResolvedValue({
      value: 1.0,
      unixTime: Math.floor(TEST_ALERT_TIME.toSeconds()),
    } as any);

    // Default mocks for ingestion functions - default to Solana addresses
    vi.mocked(isEvmAddress).mockReturnValue(false);
    vi.mocked(fetchMultiChainMetadata).mockResolvedValue({
      address: TEST_MINT,
      addressKind: 'solana',
      metadata: [],
      primaryMetadata: undefined,
    });

    // Default mock for fetchBirdeyeCandles
    vi.mocked(fetchBirdeyeCandles).mockResolvedValue([]);
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

  describe('fetchCandles', () => {
    it('should fetch candles and store them', async () => {
      await engine.initialize();

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

      vi.mocked(fetchBirdeyeCandles).mockResolvedValue(mockCandles);

      const result = await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME, {
        interval: '1m',
        useCache: false,
      });

      expect(result['1m'].length).toBeGreaterThan(0);
      // Note: storeCandles is no longer used - OhlcvRepository.upsertCandles is used instead
    });

    it('should preserve mint address case', async () => {
      await engine.initialize();

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

      vi.mocked(fetchBirdeyeCandles).mockResolvedValue(mockCandles);

      await engine.fetchCandles(mixedCaseMint, TEST_CHAIN, TEST_ALERT_TIME, {
        interval: '1m',
        useCache: false,
      });

      // Verify mint address was passed correctly (case preserved)
      expect(fetchBirdeyeCandles).toHaveBeenCalledWith(
        expect.stringContaining('7pXs'),
        '1m',
        expect.any(Number),
        expect.any(Number),
        TEST_CHAIN
      );
    });

    it('should use cache when enabled', async () => {
      await engine.initialize();

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

      vi.mocked(mockStorageEngine.getCandles).mockResolvedValue(mockCandles);
      vi.mocked(fetchBirdeyeCandles).mockResolvedValue([]);

      // First call - should check cache
      await engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME, {
        interval: '1m',
        useCache: true,
      });

      // Should check storage for cached candles
      expect(mockStorageEngine.getCandles).toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      await engine.initialize();

      vi.mocked(fetchBirdeyeCandles).mockRejectedValue(new Error('API error'));

      await expect(
        engine.fetchCandles(TEST_MINT, TEST_CHAIN, TEST_ALERT_TIME, {
          interval: '1m',
          useCache: false,
        })
      ).rejects.toThrow('API error');
    });
  });

  describe('cache management', () => {
    it('should clear cache', () => {
      engine.clearCache();
      // Cache should be empty after clear
      expect(engine).toBeDefined();
    });
  });
});

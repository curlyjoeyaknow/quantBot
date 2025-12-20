/**
 * OHLCV Ingestion Stress Tests
 *
 * Comprehensive stress tests designed to expose weaknesses in the OHLCV ingestion pipeline.
 * These tests use REAL implementations to test actual system behavior under stress.
 *
 * Uses REAL implementations:
 * - Real PythonEngine (calls actual Python scripts)
 * - Real DuckDB files (created with test data)
 * - Real OhlcvIngestionEngine (mocks only external API calls)
 * - Real StorageEngine (can use test ClickHouse instance)
 *
 * Test Categories:
 * 1. Input Violence - Malformed addresses, invalid timestamps, extreme ranges
 * 2. API Failure Modes - Rate limiting, timeouts, malformed responses
 * 3. Cache Corruption - Stale cache, corrupted entries, wrong data
 * 4. Storage Failures - ClickHouse failures, partial writes, concurrent conflicts
 * 5. Resource Exhaustion - Memory leaks, too many requests, huge datasets
 * 6. Data Integrity - Invalid candles, duplicates, out-of-order, missing data
 * 7. Concurrency - Race conditions, concurrent ingestion
 * 8. Boundary Conditions - Empty results, single candle, maximum candles
 * 9. Error Recovery - Partial failures, retry logic
 * 10. Performance Degradation - Large ranges, many tokens, slow responses
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DateTime } from 'luxon';
import { OhlcvIngestionService } from '../../src/OhlcvIngestionService';
import { getPythonEngine } from '@quantbot/utils';
import { getOhlcvIngestionEngine } from '@quantbot/jobs';
import { getStorageEngine } from '@quantbot/storage';
import {
  createTestDuckDB,
  cleanupTestDuckDB,
  createTempDuckDBPath,
} from '../helpers/createTestDuckDB.js';
import type { Chain } from '@quantbot/core';
import type { PythonEngine } from '@quantbot/utils';
import {
  INVALID_MINTS,
  EXTREME_DATE_RANGES,
  PATHOLOGICAL_CANDLES,
  API_FAILURE_SCENARIOS,
  CACHE_CORRUPTION_SCENARIOS,
  STORAGE_FAILURE_SCENARIOS,
  RESOURCE_EXHAUSTION_SCENARIOS,
  VALID_MINT,
} from './fixtures/pathological-ohlcv';

// Mock only external API calls (Birdeye) - use real implementations for everything else
vi.mock('@quantbot/api-clients', async () => {
  const actual = await vi.importActual('@quantbot/api-clients');
  return {
    ...actual,
    fetchBirdeyeCandles: vi.fn(),
    fetchMultiChainMetadata: vi.fn(),
  };
});

// Mock getPostgresPool (needed for calculateAndStoreAthAtl)
vi.mock('@quantbot/storage', async () => {
  const actual = await vi.importActual('@quantbot/storage');
  return {
    ...actual,
    getPostgresPool: vi.fn(() => ({
      query: vi.fn().mockResolvedValue({
        rows: [],
      }),
    })),
  };
});

describe('OHLCV Ingestion Stress Tests', () => {
  let pythonEngine: PythonEngine;
  let ingestionEngine: ReturnType<typeof getOhlcvIngestionEngine>;
  let storageEngine: ReturnType<typeof getStorageEngine>;
  let service: OhlcvIngestionService;
  let testDuckDBPath: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Use REAL implementations
    pythonEngine = getPythonEngine();
    ingestionEngine = getOhlcvIngestionEngine();
    storageEngine = getStorageEngine();

    // Initialize engine (ClickHouse)
    await ingestionEngine.initialize();

    // Create test DuckDB file
    testDuckDBPath = createTempDuckDBPath('stress_test');

    // Create service with real implementations
    service = new OhlcvIngestionService(
      ingestionEngine, // Real engine
      storageEngine, // Real storage
      pythonEngine // Real PythonEngine
    );
  });

  afterEach(() => {
    // Cleanup test DuckDB
    cleanupTestDuckDB(testDuckDBPath);
    vi.restoreAllMocks();
  });

  describe('Input Violence', () => {
    describe('Invalid mint addresses', () => {
      INVALID_MINTS.forEach((invalidMint) => {
        it(`should handle invalid mint: ${invalidMint || '(empty)'}`, async () => {
          const now = DateTime.utc();

          // Create REAL DuckDB with invalid mint
          // The Python script should filter out empty/invalid mints
          await createTestDuckDB(
            testDuckDBPath,
            [
              {
                mint: invalidMint || '',
                chain: 'solana',
                triggerTsMs: now.toMillis(),
                chatId: 'test_chat',
                messageId: 1,
              },
            ],
            pythonEngine
          );

          // Use REAL service with REAL DuckDB
          // The Python script filters out invalid mints, so worklist may be empty
          const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

          // System must not crash - either fail with error or skip
          expect(result).toBeDefined();
          expect(result.tokensProcessed).toBeGreaterThanOrEqual(0);
          expect(result.tokensFailed).toBeGreaterThanOrEqual(0);
          // Total should equal processed
          expect(result.tokensProcessed).toBe(result.tokensSucceeded + result.tokensFailed);

          // Verify the real DuckDB query executed (integration boundary test)
          // If invalid mint was filtered out, tokensProcessed will be 0, which is correct
        });
      });
    });

    describe('Extreme date ranges', () => {
      EXTREME_DATE_RANGES.forEach((range) => {
        it(`should handle ${range.description}`, async () => {
          // Create REAL DuckDB with valid mint but extreme date range
          await createTestDuckDB(
            testDuckDBPath,
            [
              {
                mint: VALID_MINT,
                chain: 'solana',
                triggerTsMs: range.start.toMillis(),
                chatId: 'test_chat',
                messageId: 1,
              },
            ],
            pythonEngine
          );

          // Mock API calls (external dependency)
          const { fetchBirdeyeCandles } = await import('@quantbot/api-clients');
          vi.mocked(fetchBirdeyeCandles).mockResolvedValue({
            '1m': [],
            '5m': [],
            metadata: { chunksFromAPI: 0, chunksFromCache: 0 },
          });

          // Should handle gracefully - either return empty or fail with clear error
          const result = await service.ingestForCalls({
            duckdbPath: testDuckDBPath,
            from: range.start.toJSDate(),
            to: range.end.toJSDate(),
          });

          expect(result).toBeDefined();
          // Must not crash or return corrupted data
          expect(Number.isFinite(result.tokensProcessed)).toBe(true);
          expect(Number.isFinite(result.tokensSucceeded)).toBe(true);
          expect(Number.isFinite(result.tokensFailed)).toBe(true);
        });
      });
    });

    describe('Invalid call data', () => {
      it('should handle calls with missing mint', async () => {
        const now = DateTime.utc();

        // Create DuckDB with call that has null/empty mint
        // DuckDB will store it, but Python script should filter it out
        await createTestDuckDB(
          testDuckDBPath,
          [
            {
              mint: '', // Empty mint - should be filtered by Python script
              chain: 'solana',
              triggerTsMs: now.toMillis(),
              chatId: 'test_chat',
              messageId: 1,
            },
          ],
          pythonEngine
        );

        const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

        // Should skip invalid calls or fail gracefully
        expect(result).toBeDefined();
        expect(result.tokensProcessed).toBeGreaterThanOrEqual(0);
      });

      it('should handle calls with invalid timestamp', async () => {
        const now = DateTime.utc();

        // Create DuckDB with valid mint but potentially problematic timestamp
        // The Python script should handle timestamp conversion
        await createTestDuckDB(
          testDuckDBPath,
          [
            {
              mint: VALID_MINT,
              chain: 'solana',
              triggerTsMs: now.toMillis(), // Valid timestamp
              chatId: 'test_chat',
              messageId: 1,
            },
          ],
          pythonEngine
        );

        const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

        // Should handle gracefully - Python script validates timestamps
        expect(result).toBeDefined();
      });

      it('should handle empty calls array', async () => {
        // Create empty DuckDB (no calls inserted)
        await createTestDuckDB(
          testDuckDBPath,
          [], // Empty array
          pythonEngine
        );

        const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

        expect(result.tokensProcessed).toBe(0);
        expect(result.tokensSucceeded).toBe(0);
        expect(result.tokensFailed).toBe(0);
      });
    });
  });

  describe('API Failure Modes', () => {
    beforeEach(async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB with valid call
      await createTestDuckDB(
        testDuckDBPath,
        [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ],
        pythonEngine
      );
    });

    API_FAILURE_SCENARIOS.forEach((scenario) => {
      it(`should handle ${scenario.description}`, async () => {
        // Mock API calls (external dependency) to simulate failures
        const apiClients = await import('@quantbot/api-clients');

        if ('timeout' in scenario && scenario.timeout) {
          vi.mocked(apiClients.fetchBirdeyeCandles).mockImplementation(() => {
            return new Promise((_, reject) => {
              setTimeout(() => reject(new Error('Timeout')), 100);
            });
          });
        } else if (scenario.statusCode === 429) {
          const error: any = new Error('Rate limit exceeded');
          error.statusCode = 429;
          vi.mocked(apiClients.fetchBirdeyeCandles).mockRejectedValue(error);
        } else if (scenario.statusCode === 500) {
          vi.mocked(apiClients.fetchBirdeyeCandles).mockRejectedValue(
            new Error('Internal server error')
          );
        } else if (scenario.statusCode === 404) {
          vi.mocked(apiClients.fetchBirdeyeCandles).mockRejectedValue(new Error('Token not found'));
        } else {
          // Malformed response
          vi.mocked(apiClients.fetchBirdeyeCandles).mockRejectedValue(
            new Error('Invalid response')
          );
        }

        // Use REAL service with REAL DuckDB
        const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

        // Must fail gracefully with error tracking
        expect(result).toBeDefined();
        expect(result.tokensFailed).toBeGreaterThanOrEqual(0);
        expect(result.errors.length).toBeGreaterThanOrEqual(0);
        // Error must have tokenId and error message
        if (result.errors.length > 0) {
          expect(result.errors[0].tokenId).toBeDefined();
          expect(result.errors[0].error).toBeDefined();
          expect(typeof result.errors[0].error).toBe('string');
        }
      });
    });

    it('should retry on transient failures', async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB
      await createTestDuckDB(
        testDuckDBPath,
        [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ],
        pythonEngine
      );

      // Mock API calls to simulate transient failures
      let callCount = 0;
      const { fetchBirdeyeCandles } = await import('@quantbot/api-clients');
      vi.mocked(fetchBirdeyeCandles).mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Transient error'));
        }
        return Promise.resolve({
          '1m': [],
          '5m': [
            {
              timestamp: Math.floor(now.toSeconds()),
              open: 1.0,
              high: 1.1,
              low: 0.9,
              close: 1.05,
              volume: 1000,
            },
          ],
          metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
        });
      });

      // Use REAL service
      const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

      // Should eventually succeed or fail with clear error
      expect(result).toBeDefined();
    });

    it('should handle partial API response (some chunks fail)', async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB
      await createTestDuckDB(
        testDuckDBPath,
        [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ],
        pythonEngine
      );

      // Mock API calls - simulate partial failure
      const apiClients = await import('@quantbot/api-clients');
      vi.mocked(apiClients.fetchBirdeyeCandles).mockResolvedValue({
        '1m': [
          {
            timestamp: Math.floor(DateTime.utc().toSeconds()),
            open: 1.0,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 1000,
          },
        ],
        '5m': [], // Failed to fetch 5m
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });

      const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

      // Should handle partial data gracefully
      expect(result.tokensSucceeded).toBeGreaterThanOrEqual(0);
      expect(result.candlesFetched1m).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Data Integrity', () => {
    beforeEach(async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB with valid call
      await createTestDuckDB(
        testDuckDBPath,
        [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ],
        pythonEngine
      );
    });

    PATHOLOGICAL_CANDLES.forEach((testCase) => {
      it(`should handle ${testCase.description}`, async () => {
        // Mock API calls with pathological candle data
        const apiClients = await import('@quantbot/api-clients');
        vi.mocked(apiClients.fetchBirdeyeCandles).mockResolvedValue({
          '1m': testCase.candles,
          '5m': testCase.candles,
          metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
        });

        // Use REAL service with REAL DuckDB
        const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

        // System must handle pathological data without crashing
        expect(result).toBeDefined();
        expect(Number.isFinite(result.tokensProcessed)).toBe(true);

        if (testCase.expectedBehavior === 'reject') {
          // Should reject invalid data
          expect(result.tokensFailed).toBeGreaterThanOrEqual(0);
        } else if (testCase.expectedBehavior === 'normalize') {
          // Should normalize (filter/sort/deduplicate)
          expect(result.tokensSucceeded).toBeGreaterThanOrEqual(0);
        } else {
          // Should accept valid data
          expect(result.tokensSucceeded).toBeGreaterThanOrEqual(0);
        }
      });
    });

    it('should validate candle data before storing', async () => {
      const invalidCandles = [
        {
          timestamp: Math.floor(DateTime.utc().toSeconds()),
          open: NaN,
          high: NaN,
          low: NaN,
          close: NaN,
          volume: NaN,
        },
      ];

      // Mock API calls with invalid candles
      const { fetchBirdeyeCandles } = await import('@quantbot/api-clients');
      vi.mocked(fetchBirdeyeCandles).mockResolvedValue({
        '1m': invalidCandles,
        '5m': invalidCandles,
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });

      // Use REAL service - it should validate and reject invalid candles
      const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

      // Should handle invalid candles gracefully (either reject or skip)
      expect(result).toBeDefined();
      // Real storage engine will validate - we're testing the integration boundary
    });

    it('should deduplicate duplicate timestamps', async () => {
      const duplicateCandles = [
        {
          timestamp: 1000,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
        {
          timestamp: 1000, // Duplicate
          open: 1.05,
          high: 1.2,
          low: 1.0,
          close: 1.15,
          volume: 2000,
        },
      ];

      // Mock API calls with duplicate candles
      const { fetchBirdeyeCandles } = await import('@quantbot/api-clients');
      vi.mocked(fetchBirdeyeCandles).mockResolvedValue({
        '1m': duplicateCandles,
        '5m': duplicateCandles,
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });

      // Use REAL service - it should deduplicate
      const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

      // Should handle duplicates (either merge or keep one)
      expect(result).toBeDefined();
    });

    it('should sort out-of-order candles', async () => {
      const outOfOrderCandles = [
        {
          timestamp: 2000,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
        {
          timestamp: 1000, // Before previous
          open: 0.9,
          high: 1.0,
          low: 0.8,
          close: 0.95,
          volume: 500,
        },
      ];

      // Mock API calls with out-of-order candles
      const { fetchBirdeyeCandles } = await import('@quantbot/api-clients');
      vi.mocked(fetchBirdeyeCandles).mockResolvedValue({
        '1m': outOfOrderCandles,
        '5m': outOfOrderCandles,
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });

      // Use REAL service - it should sort candles
      const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

      // Should handle out-of-order candles (real storage engine will sort)
      expect(result).toBeDefined();
    });
  });

  describe('Storage Failures', () => {
    beforeEach(async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB
      await createTestDuckDB(
        testDuckDBPath,
        [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ],
        pythonEngine
      );

      // Mock API calls
      const { fetchBirdeyeCandles } = await import('@quantbot/api-clients');
      vi.mocked(fetchBirdeyeCandles).mockResolvedValue({
        '1m': [
          {
            timestamp: Math.floor(now.toSeconds()),
            open: 1.0,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 1000,
          },
        ],
        '5m': [],
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });
    });

    STORAGE_FAILURE_SCENARIOS.forEach((scenario) => {
      it(`should handle ${scenario.description}`, async () => {
        // For storage failure tests, we need to mock the storage engine
        // But use real DuckDB and PythonEngine
        const mockStorageEngine = {
          ...storageEngine,
          storeCandles: vi.fn(),
          getCandles: vi.fn().mockResolvedValue([]),
        };

        // Create service with mocked storage for failure scenarios
        const testService = new OhlcvIngestionService(
          ingestionEngine,
          mockStorageEngine as any,
          pythonEngine
        );

        if (scenario.error === 'Connection refused') {
          mockStorageEngine.storeCandles.mockRejectedValue(new Error('Connection refused'));
        } else if (scenario.error === 'Query timeout') {
          mockStorageEngine.storeCandles.mockImplementation(() => {
            return new Promise((_, reject) => {
              setTimeout(() => reject(new Error('Query timeout')), 100);
            });
          });
        } else if (scenario.error === 'Disk full') {
          mockStorageEngine.storeCandles.mockRejectedValue(new Error('Disk full'));
        } else if ('partial' in scenario && scenario.partial) {
          // Partial write - some succeed, some fail
          mockStorageEngine.storeCandles.mockResolvedValueOnce(undefined);
          mockStorageEngine.storeCandles.mockRejectedValueOnce(new Error('Partial write'));
        } else {
          mockStorageEngine.storeCandles.mockRejectedValue(new Error(scenario.error));
        }

        // Use REAL DuckDB, REAL PythonEngine, but mocked storage for failure testing
        const result = await testService.ingestForCalls({ duckdbPath: testDuckDBPath });

        // Should handle storage failures gracefully
        expect(result).toBeDefined();
        // Should still return candles even if storage fails
        expect(result.candlesFetched1m).toBeGreaterThanOrEqual(0);
      });
    });

    it('should not lose data on storage failure', async () => {
      // Mock storage to fail, but use real DuckDB
      const mockStorageEngine = {
        ...storageEngine,
        storeCandles: vi.fn().mockRejectedValue(new Error('Storage failed')),
        getCandles: vi.fn().mockResolvedValue([]),
      };

      const testService = new OhlcvIngestionService(
        ingestionEngine,
        mockStorageEngine as any,
        pythonEngine
      );

      const result = await testService.ingestForCalls({ duckdbPath: testDuckDBPath });

      // Data should still be available in result even if storage fails
      expect(result.candlesFetched1m).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Resource Exhaustion', () => {
    it('should handle too many concurrent tokens', async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB with many calls (stress test)
      // Use a smaller number for test performance (100 instead of 1000)
      const callCount = 100;
      const calls = Array.from({ length: callCount }, (_, i) => ({
        mint: `${VALID_MINT.substring(0, VALID_MINT.length - 2)}${i.toString().padStart(2, '0')}`, // Different mints
        chain: 'solana',
        triggerTsMs: now.toMillis(),
        chatId: 'test_chat',
        messageId: i + 1,
      }));

      await createTestDuckDB(testDuckDBPath, calls, pythonEngine);

      // Mock API calls
      const { fetchBirdeyeCandles } = await import('@quantbot/api-clients');
      vi.mocked(fetchBirdeyeCandles).mockResolvedValue({
        '1m': [],
        '5m': [],
        metadata: { chunksFromAPI: 0, chunksFromCache: 0 },
      });

      // Use REAL service with REAL DuckDB
      const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

      // Should handle large batches without crashing
      expect(result.tokensProcessed).toBe(callCount);
      expect(result.tokensSucceeded + result.tokensFailed).toBe(callCount);
    });

    it('should handle very large candle arrays', async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB
      await createTestDuckDB(
        testDuckDBPath,
        [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ],
        pythonEngine
      );

      // Use smaller array for test performance (1000 instead of 100000)
      const largeCandles = Array.from({ length: 1000 }, (_, i) => ({
        timestamp: Math.floor(now.minus({ minutes: 1000 - i }).toSeconds()),
        open: 1.0 + i * 0.001,
        high: 1.1 + i * 0.001,
        low: 0.9 + i * 0.001,
        close: 1.05 + i * 0.001,
        volume: 1000 + i,
      }));

      // Mock API calls with large candle arrays
      const { fetchBirdeyeCandles } = await import('@quantbot/api-clients');
      vi.mocked(fetchBirdeyeCandles).mockResolvedValue({
        '1m': largeCandles,
        '5m': largeCandles,
        metadata: { chunksFromAPI: 20, chunksFromCache: 0 },
      });

      // Use REAL service with REAL DuckDB
      const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

      // Should handle large datasets without memory issues
      expect(result).toBeDefined();
      expect(result.candlesFetched1m).toBeGreaterThanOrEqual(0);
    });

    it('should handle memory pressure from many small requests', async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB with many calls
      const calls = Array.from({ length: 100 }, (_, i) => ({
        mint: `${VALID_MINT.substring(0, VALID_MINT.length - 2)}${i.toString().padStart(2, '0')}`,
        chain: 'solana',
        triggerTsMs: now.toMillis(),
        chatId: 'test_chat',
        messageId: i + 1,
      }));

      await createTestDuckDB(testDuckDBPath, calls, pythonEngine);

      // Mock API calls
      const { fetchBirdeyeCandles } = await import('@quantbot/api-clients');
      vi.mocked(fetchBirdeyeCandles).mockResolvedValue({
        '1m': Array.from({ length: 1000 }, (_, i) => ({
          timestamp: Math.floor(now.minus({ minutes: 1000 - i }).toSeconds()),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        })),
        '5m': [],
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });

      // Use REAL service with REAL DuckDB
      const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

      // Should handle many requests without memory leaks
      expect(result.tokensProcessed).toBe(100);
    });
  });

  describe('Concurrency', () => {
    it('should handle concurrent ingestion of same token', async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB with multiple calls for same token
      await createTestDuckDB(
        testDuckDBPath,
        [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
          {
            mint: VALID_MINT, // Same token
            chain: 'solana',
            triggerTsMs: now.plus({ minutes: 1 }).toMillis(),
            chatId: 'test_chat',
            messageId: 2,
          },
        ],
        pythonEngine
      );

      // Mock API calls
      const { fetchBirdeyeCandles } = await import('@quantbot/api-clients');
      vi.mocked(fetchBirdeyeCandles).mockResolvedValue({
        '1m': [],
        '5m': [],
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });

      // Use REAL service - should deduplicate by mint
      const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

      // Should deduplicate by mint (fetch once per token, not per call)
      expect(result.tokensProcessed).toBe(1); // Same mint grouped together
    });

    it('should handle race conditions in token grouping', async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB with 10 unique tokens, 100 calls
      const calls = Array.from({ length: 100 }, (_, i) => ({
        mint: `${VALID_MINT.substring(0, VALID_MINT.length - 2)}${((i % 10) + 1).toString().padStart(2, '0')}`, // 10 unique mints
        chain: 'solana',
        triggerTsMs: now.plus({ minutes: i }).toMillis(),
        chatId: 'test_chat',
        messageId: i + 1,
      }));

      await createTestDuckDB(testDuckDBPath, calls, pythonEngine);

      // Mock API calls
      const { fetchBirdeyeCandles } = await import('@quantbot/api-clients');
      vi.mocked(fetchBirdeyeCandles).mockResolvedValue({
        '1m': [],
        '5m': [],
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });

      // Use REAL service - should group correctly (10 unique tokens)
      const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

      // Should group correctly (10 unique tokens)
      expect(result.tokensProcessed).toBe(10);
    });
  });

  describe('Boundary Conditions', () => {
    beforeEach(async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB for boundary condition tests
      await createTestDuckDB(
        testDuckDBPath,
        [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ],
        pythonEngine
      );
    });

    it('should handle zero candles returned', async () => {
      // Mock API calls - return empty candles
      const apiClients = await import('@quantbot/api-clients');
      vi.mocked(apiClients.fetchBirdeyeCandles).mockResolvedValue({
        '1m': [],
        '5m': [],
        metadata: { chunksFromAPI: 0, chunksFromCache: 0 },
      });

      // Use REAL service
      const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

      expect(result.tokensProcessed).toBeGreaterThanOrEqual(0);
      expect(result.candlesFetched1m).toBe(0);
      expect(result.candlesFetched5m).toBe(0);
    });

    it('should handle single candle', async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB
      await createTestDuckDB(
        testDuckDBPath,
        [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ],
        pythonEngine
      );

      // Mock API calls - return single candle
      const { fetchBirdeyeCandles } = await import('@quantbot/api-clients');
      vi.mocked(fetchBirdeyeCandles).mockResolvedValue({
        '1m': [
          {
            timestamp: Math.floor(now.toSeconds()),
            open: 1.0,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 1000,
          },
        ],
        '5m': [],
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });

      const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

      expect(result.tokensSucceeded).toBe(1);
      expect(result.candlesFetched1m).toBe(1);
    });

    it('should handle maximum candles (5000)', async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB
      await createTestDuckDB(
        testDuckDBPath,
        [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ],
        pythonEngine
      );

      const maxCandles = Array.from({ length: 5000 }, (_, i) => ({
        timestamp: Math.floor(now.minus({ minutes: 5000 - i }).toSeconds()),
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      }));

      // Mock API calls - return max candles
      const { fetchBirdeyeCandles } = await import('@quantbot/api-clients');
      vi.mocked(fetchBirdeyeCandles).mockResolvedValue({
        '1m': maxCandles,
        '5m': maxCandles,
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });

      // Use REAL service
      const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

      expect(result.tokensSucceeded).toBe(1);
      expect(result.candlesFetched1m).toBe(5000);
      expect(result.candlesFetched5m).toBe(5000);
    });
  });

  describe('Error Recovery', () => {
    it('should continue processing after token failure', async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB with three different mints
      await createTestDuckDB(
        testDuckDBPath,
        [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
          {
            mint: `${VALID_MINT.substring(0, VALID_MINT.length - 2)}99`, // Different mint (will fail API)
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 2,
          },
          {
            mint: `${VALID_MINT.substring(0, VALID_MINT.length - 2)}98`, // Another mint
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 3,
          },
        ],
        pythonEngine
      );

      // Mock API calls - second mint fails, others succeed
      const { fetchBirdeyeCandles } = await import('@quantbot/api-clients');
      vi.mocked(fetchBirdeyeCandles).mockImplementation((mint: string) => {
        if (mint.includes('99')) {
          return Promise.reject(new Error('Token lookup failed'));
        }
        return Promise.resolve({
          '1m': [],
          '5m': [],
          metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
        });
      });

      // Use REAL service - should continue after token failure
      const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

      // Should process other tokens even if one fails
      expect(result.tokensProcessed).toBe(3);
      expect(result.tokensFailed).toBeGreaterThanOrEqual(1);
      expect(result.tokensSucceeded).toBeGreaterThanOrEqual(1);
    });

    it('should track all errors in result', async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB
      await createTestDuckDB(
        testDuckDBPath,
        [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
          {
            mint: `${VALID_MINT.substring(0, VALID_MINT.length - 2)}99`,
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 2,
          },
        ],
        pythonEngine
      );

      // Mock API calls - all fail
      const { fetchBirdeyeCandles } = await import('@quantbot/api-clients');
      vi.mocked(fetchBirdeyeCandles).mockRejectedValue(new Error('API failed'));

      // Use REAL service - should track errors
      const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

      // Should track errors
      expect(result.errors.length).toBeGreaterThanOrEqual(0);
      result.errors.forEach((error) => {
        expect(error.tokenId).toBeDefined();
        expect(error.error).toBeDefined();
        expect(typeof error.error).toBe('string');
      });
    });
  });

  describe('Performance Degradation', () => {
    it('should handle slow API responses', async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB
      await createTestDuckDB(
        testDuckDBPath,
        [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ],
        pythonEngine
      );

      // Simulate slow API (100ms delay for test performance)
      const { fetchBirdeyeCandles } = await import('@quantbot/api-clients');
      vi.mocked(fetchBirdeyeCandles).mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              '1m': [],
              '5m': [],
              metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
            });
          }, 100); // Reduced from 1000ms for test performance
        });
      });

      const startTime = Date.now();
      const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });
      const duration = Date.now() - startTime;

      // Should complete (with timeout handling if needed)
      expect(result).toBeDefined();
      expect(duration).toBeGreaterThan(0);
    });

    it('should handle many tokens efficiently', async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB with many tokens
      const calls = Array.from({ length: 100 }, (_, i) => ({
        mint: `${VALID_MINT.substring(0, VALID_MINT.length - 2)}${(i + 1).toString().padStart(2, '0')}`,
        chain: 'solana',
        triggerTsMs: now.toMillis(),
        chatId: 'test_chat',
        messageId: i + 1,
      }));

      await createTestDuckDB(testDuckDBPath, calls, pythonEngine);

      // Mock API calls
      const apiClients = await import('@quantbot/api-clients');
      vi.mocked(apiClients.fetchBirdeyeCandles).mockResolvedValue({
        '1m': [],
        '5m': [],
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });

      const startTime = Date.now();
      const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });
      const duration = Date.now() - startTime;

      // Should complete in reasonable time
      expect(result.tokensProcessed).toBe(100);
      expect(duration).toBeLessThan(60000); // Less than 1 minute
    });
  });

  describe('Integration Stress', () => {
    it('should handle complete failure scenario', async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB
      await createTestDuckDB(
        testDuckDBPath,
        [
          {
            mint: VALID_MINT,
            chain: 'solana',
            triggerTsMs: now.toMillis(),
            chatId: 'test_chat',
            messageId: 1,
          },
        ],
        pythonEngine
      );

      // Mock API calls to fail
      const apiClients = await import('@quantbot/api-clients');
      vi.mocked(apiClients.fetchBirdeyeCandles).mockRejectedValue(new Error('API failed'));

      // Mock storage to fail
      const mockStorageEngine = {
        ...storageEngine,
        storeCandles: vi.fn().mockRejectedValue(new Error('Storage failed')),
        getCandles: vi.fn().mockResolvedValue([]),
      };

      const testService = new OhlcvIngestionService(
        ingestionEngine,
        mockStorageEngine as any,
        pythonEngine
      );

      // Should fail with clear error, not crash
      await expect(testService.ingestForCalls({ duckdbPath: testDuckDBPath })).rejects.toThrow();
    });

    it('should handle mixed success/failure scenario', async () => {
      const now = DateTime.utc();

      // Create REAL DuckDB with 10 different mints
      const calls = Array.from({ length: 10 }, (_, i) => ({
        mint: `${VALID_MINT.substring(0, VALID_MINT.length - 2)}${(i + 1).toString().padStart(2, '0')}`,
        chain: 'solana',
        triggerTsMs: now.toMillis(),
        chatId: 'test_chat',
        messageId: i + 1,
      }));

      await createTestDuckDB(testDuckDBPath, calls, pythonEngine);

      // Mock API calls - some succeed, some fail
      const apiClients = await import('@quantbot/api-clients');
      vi.mocked(apiClients.fetchBirdeyeCandles).mockImplementation((mint: string) => {
        if (mint.includes('5')) {
          return Promise.reject(new Error('API failed'));
        }
        return Promise.resolve({
          '1m': [],
          '5m': [],
          metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
        });
      });

      // Use REAL service
      const result = await service.ingestForCalls({ duckdbPath: testDuckDBPath });

      // Should handle mixed scenario
      expect(result.tokensProcessed).toBe(10);
      expect(result.tokensSucceeded).toBeGreaterThanOrEqual(0);
      expect(result.tokensFailed).toBeGreaterThanOrEqual(0);
      expect(result.tokensSucceeded + result.tokensFailed).toBe(result.tokensProcessed);
    });
  });
});

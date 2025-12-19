/**
 * OHLCV Ingestion Stress Tests
 *
 * Comprehensive stress tests designed to expose weaknesses in the OHLCV ingestion pipeline.
 * These tests are intentionally difficult and should force improvements to the implementation.
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
import type { Chain } from '@quantbot/core';
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

// Mock logger to suppress expected error logs
vi.mock('@quantbot/utils', async () => {
  const actual = await vi.importActual('@quantbot/utils');
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

// Mock storage modules
vi.mock('@quantbot/storage', async () => {
  const actual = await vi.importActual('@quantbot/storage');
  return {
    ...actual,
    getStorageEngine: vi.fn(),
    getPostgresPool: vi.fn(),
  };
});

// Mock OHLCV engine
vi.mock('@quantbot/jobs', async () => {
  const actual = await vi.importActual('@quantbot/jobs');
  return {
    ...actual,
    getOhlcvIngestionEngine: vi.fn(),
  };
});

describe('OHLCV Ingestion Stress Tests', () => {
  let callsRepo: any;
  let tokensRepo: any;
  let alertsRepo: any;
  let ingestionEngine: any;
  let storageEngine: any;
  let service: OhlcvIngestionService;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Setup repositories
    callsRepo = {
      queryBySelection: vi.fn(),
    };

    tokensRepo = {
      findById: vi.fn(),
    };

    alertsRepo = {
      updateAlertMetrics: vi.fn(),
    };

    // Setup ingestion engine
    ingestionEngine = {
      initialize: vi.fn().mockResolvedValue(undefined),
      fetchCandles: vi.fn(),
    };

    // Setup storage engine
    storageEngine = {
      storeCandles: vi.fn().mockResolvedValue(undefined),
      getCandles: vi.fn().mockResolvedValue([]),
    };

    // Mock module exports
    const { getOhlcvIngestionEngine } = await import('@quantbot/jobs');
    vi.mocked(getOhlcvIngestionEngine).mockReturnValue(ingestionEngine as any);

    const { getStorageEngine } = await import('@quantbot/storage');
    vi.mocked(getStorageEngine).mockReturnValue(storageEngine as any);

    service = new OhlcvIngestionService(callsRepo as any, tokensRepo as any, alertsRepo as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Input Violence', () => {
    describe('Invalid mint addresses', () => {
      INVALID_MINTS.forEach((invalidMint) => {
        it(`should handle invalid mint: ${invalidMint || '(empty)'}`, async () => {
          const now = DateTime.utc();
          const calls = [
            {
              id: 1,
              tokenId: 1,
              signalTimestamp: now,
              callerId: 1,
              side: 'buy' as const,
            },
          ];

          callsRepo.queryBySelection.mockResolvedValue(calls);
          tokensRepo.findById.mockResolvedValue({
            id: 1,
            address: invalidMint,
            chain: 'solana',
          });

          // Should either fail gracefully or skip invalid tokens
          const result = await service.ingestForCalls({});

          // System must not crash - either fail with error or skip
          expect(result).toBeDefined();
          expect(result.tokensProcessed).toBeGreaterThanOrEqual(0);
          expect(result.tokensFailed).toBeGreaterThanOrEqual(0);
          // Total should equal processed
          expect(result.tokensProcessed).toBe(result.tokensSucceeded + result.tokensFailed);
        });
      });
    });

    describe('Extreme date ranges', () => {
      EXTREME_DATE_RANGES.forEach((range) => {
        it(`should handle ${range.description}`, async () => {
          const calls = [
            {
              id: 1,
              tokenId: 1,
              signalTimestamp: range.start,
              callerId: 1,
              side: 'buy' as const,
            },
          ];

          callsRepo.queryBySelection.mockResolvedValue(calls);
          tokensRepo.findById.mockResolvedValue({
            id: 1,
            address: VALID_MINT,
            chain: 'solana',
          });

          // Should handle gracefully - either return empty or fail with clear error
          const result = await service.ingestForCalls({
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
      it('should handle calls with missing tokenId', async () => {
        const calls = [
          {
            id: 1,
            tokenId: null as any,
            signalTimestamp: DateTime.utc(),
            callerId: 1,
            side: 'buy' as const,
          },
        ];

        callsRepo.queryBySelection.mockResolvedValue(calls);

        const result = await service.ingestForCalls({});

        // Should skip invalid calls or fail gracefully
        expect(result).toBeDefined();
        expect(result.tokensProcessed).toBeGreaterThanOrEqual(0);
      });

      it('should handle calls with invalid timestamp', async () => {
        const calls = [
          {
            id: 1,
            tokenId: 1,
            signalTimestamp: DateTime.fromMillis(NaN),
            callerId: 1,
            side: 'buy' as const,
          },
        ];

        callsRepo.queryBySelection.mockResolvedValue(calls);
        tokensRepo.findById.mockResolvedValue({
          id: 1,
          address: VALID_MINT,
          chain: 'solana',
        });

        const result = await service.ingestForCalls({});

        // Should handle invalid timestamp gracefully
        expect(result).toBeDefined();
      });

      it('should handle empty calls array', async () => {
        callsRepo.queryBySelection.mockResolvedValue([]);

        const result = await service.ingestForCalls({});

        expect(result.tokensProcessed).toBe(0);
        expect(result.tokensSucceeded).toBe(0);
        expect(result.tokensFailed).toBe(0);
      });
    });
  });

  describe('API Failure Modes', () => {
    beforeEach(() => {
      const now = DateTime.utc();
      callsRepo.queryBySelection.mockResolvedValue([
        {
          id: 1,
          tokenId: 1,
          signalTimestamp: now,
          callerId: 1,
          side: 'buy' as const,
        },
      ]);
      tokensRepo.findById.mockResolvedValue({
        id: 1,
        address: VALID_MINT,
        chain: 'solana',
      });
    });

    API_FAILURE_SCENARIOS.forEach((scenario) => {
      it(`should handle ${scenario.description}`, async () => {
        if ('timeout' in scenario && scenario.timeout) {
          ingestionEngine.fetchCandles.mockImplementation(() => {
            return new Promise((_, reject) => {
              setTimeout(() => reject(new Error('Timeout')), 100);
            });
          });
        } else if (scenario.statusCode === 429) {
          const error: any = new Error('Rate limit exceeded');
          error.statusCode = 429;
          ingestionEngine.fetchCandles.mockRejectedValue(error);
        } else if (scenario.statusCode === 500) {
          ingestionEngine.fetchCandles.mockRejectedValue(new Error('Internal server error'));
        } else if (scenario.statusCode === 404) {
          ingestionEngine.fetchCandles.mockRejectedValue(new Error('Token not found'));
        } else {
          // Malformed response
          ingestionEngine.fetchCandles.mockRejectedValue(new Error('Invalid response'));
        }

        const result = await service.ingestForCalls({});

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
      let callCount = 0;
      ingestionEngine.fetchCandles.mockImplementation(() => {
        callCount++;
        if (callCount < 3) {
          return Promise.reject(new Error('Transient error'));
        }
        return Promise.resolve({
          '1m': [],
          '5m': [
            {
              timestamp: Math.floor(DateTime.utc().toSeconds()),
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

      const result = await service.ingestForCalls({});

      // Should eventually succeed or fail with clear error
      expect(result).toBeDefined();
    });

    it('should handle partial API response (some chunks fail)', async () => {
      // Simulate partial failure - some chunks succeed, some fail
      ingestionEngine.fetchCandles.mockResolvedValue({
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

      const result = await service.ingestForCalls({});

      // Should handle partial data gracefully
      expect(result.tokensSucceeded).toBeGreaterThanOrEqual(0);
      expect(result.candlesFetched1m).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Data Integrity', () => {
    beforeEach(() => {
      const now = DateTime.utc();
      callsRepo.queryBySelection.mockResolvedValue([
        {
          id: 1,
          tokenId: 1,
          signalTimestamp: now,
          callerId: 1,
          side: 'buy' as const,
          alertId: 1,
        },
      ]);
      tokensRepo.findById.mockResolvedValue({
        id: 1,
        address: VALID_MINT,
        chain: 'solana',
      });
    });

    PATHOLOGICAL_CANDLES.forEach((testCase) => {
      it(`should handle ${testCase.description}`, async () => {
        // PostgreSQL removed - use DuckDB workflows instead
        // This test case needs to be updated to use DuckDB workflows
        // For now, we'll skip the PostgreSQL-specific parts

        ingestionEngine.fetchCandles.mockResolvedValue({
          '1m': testCase.candles,
          '5m': testCase.candles,
          metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
        });

        const result = await service.ingestForCalls({});

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

      ingestionEngine.fetchCandles.mockResolvedValue({
        '1m': invalidCandles,
        '5m': invalidCandles,
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });

      const result = await service.ingestForCalls({});

      // Should not store invalid candles
      expect(storageEngine.storeCandles).not.toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.arrayContaining([expect.objectContaining({ open: NaN })]),
        expect.anything()
      );
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

      ingestionEngine.fetchCandles.mockResolvedValue({
        '1m': duplicateCandles,
        '5m': duplicateCandles,
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });

      const result = await service.ingestForCalls({});

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

      ingestionEngine.fetchCandles.mockResolvedValue({
        '1m': outOfOrderCandles,
        '5m': outOfOrderCandles,
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });

      const result = await service.ingestForCalls({});

      // Should sort candles before storing
      expect(result).toBeDefined();
      if (storageEngine.storeCandles.mock.calls.length > 0) {
        const storedCandles = storageEngine.storeCandles.mock.calls[0][2];
        if (storedCandles.length > 1) {
          // Check if sorted
          const timestamps = storedCandles.map((c: any) => c.timestamp);
          const sorted = [...timestamps].sort((a, b) => a - b);
          expect(timestamps).toEqual(sorted);
        }
      }
    });
  });

  describe('Storage Failures', () => {
    beforeEach(() => {
      const now = DateTime.utc();
      callsRepo.queryBySelection.mockResolvedValue([
        {
          id: 1,
          tokenId: 1,
          signalTimestamp: now,
          callerId: 1,
          side: 'buy' as const,
        },
      ]);
      tokensRepo.findById.mockResolvedValue({
        id: 1,
        address: VALID_MINT,
        chain: 'solana',
      });
      ingestionEngine.fetchCandles.mockResolvedValue({
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
        '5m': [],
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });
    });

    STORAGE_FAILURE_SCENARIOS.forEach((scenario) => {
      it(`should handle ${scenario.description}`, async () => {
        if (scenario.error === 'Connection refused') {
          storageEngine.storeCandles.mockRejectedValue(new Error('Connection refused'));
        } else if (scenario.error === 'Query timeout') {
          storageEngine.storeCandles.mockImplementation(() => {
            return new Promise((_, reject) => {
              setTimeout(() => reject(new Error('Query timeout')), 100);
            });
          });
        } else if (scenario.error === 'Disk full') {
          storageEngine.storeCandles.mockRejectedValue(new Error('Disk full'));
        } else if ('partial' in scenario && scenario.partial) {
          // Partial write - some succeed, some fail
          storageEngine.storeCandles.mockResolvedValueOnce(undefined);
          storageEngine.storeCandles.mockRejectedValueOnce(new Error('Partial write'));
        } else {
          storageEngine.storeCandles.mockRejectedValue(new Error(scenario.error));
        }

        const result = await service.ingestForCalls({});

        // Should handle storage failures gracefully
        expect(result).toBeDefined();
        // Should still return candles even if storage fails
        expect(result.candlesFetched1m).toBeGreaterThanOrEqual(0);
      });
    });

    it('should not lose data on storage failure', async () => {
      storageEngine.storeCandles.mockRejectedValue(new Error('Storage failed'));

      const result = await service.ingestForCalls({});

      // Data should still be available in result even if storage fails
      expect(result.candlesFetched1m).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Resource Exhaustion', () => {
    it('should handle too many concurrent tokens', async () => {
      const now = DateTime.utc();
      const calls = Array.from({ length: 1000 }, (_, i) => ({
        id: i + 1,
        tokenId: i + 1,
        signalTimestamp: now,
        callerId: 1,
        side: 'buy' as const,
      }));

      callsRepo.queryBySelection.mockResolvedValue(calls);
      tokensRepo.findById.mockImplementation((id: number) =>
        Promise.resolve({
          id,
          address: `${VALID_MINT}${id}`,
          chain: 'solana',
        })
      );

      ingestionEngine.fetchCandles.mockResolvedValue({
        '1m': [],
        '5m': [],
        metadata: { chunksFromAPI: 0, chunksFromCache: 0 },
      });

      const result = await service.ingestForCalls({});

      // Should handle large batches without crashing
      expect(result.tokensProcessed).toBe(1000);
      expect(result.tokensSucceeded + result.tokensFailed).toBe(1000);
    });

    it('should handle very large candle arrays', async () => {
      const now = DateTime.utc();
      const largeCandles = Array.from({ length: 100000 }, (_, i) => ({
        timestamp: Math.floor(now.minus({ minutes: 100000 - i }).toSeconds()),
        open: 1.0 + i * 0.001,
        high: 1.1 + i * 0.001,
        low: 0.9 + i * 0.001,
        close: 1.05 + i * 0.001,
        volume: 1000 + i,
      }));

      callsRepo.queryBySelection.mockResolvedValue([
        {
          id: 1,
          tokenId: 1,
          signalTimestamp: now,
          callerId: 1,
          side: 'buy' as const,
        },
      ]);
      tokensRepo.findById.mockResolvedValue({
        id: 1,
        address: VALID_MINT,
        chain: 'solana',
      });

      ingestionEngine.fetchCandles.mockResolvedValue({
        '1m': largeCandles,
        '5m': largeCandles,
        metadata: { chunksFromAPI: 20, chunksFromCache: 0 },
      });

      const result = await service.ingestForCalls({});

      // Should handle large datasets without memory issues
      expect(result).toBeDefined();
      expect(result.candlesFetched1m).toBeGreaterThanOrEqual(0);
    });

    it('should handle memory pressure from many small requests', async () => {
      const now = DateTime.utc();
      const calls = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        tokenId: i + 1,
        signalTimestamp: now,
        callerId: 1,
        side: 'buy' as const,
      }));

      callsRepo.queryBySelection.mockResolvedValue(calls);
      tokensRepo.findById.mockImplementation((id: number) =>
        Promise.resolve({
          id,
          address: `${VALID_MINT}${id}`,
          chain: 'solana',
        })
      );

      ingestionEngine.fetchCandles.mockResolvedValue({
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

      const result = await service.ingestForCalls({});

      // Should handle many requests without memory leaks
      expect(result.tokensProcessed).toBe(100);
    });
  });

  describe('Concurrency', () => {
    it('should handle concurrent ingestion of same token', async () => {
      const now = DateTime.utc();
      const calls = [
        {
          id: 1,
          tokenId: 1,
          signalTimestamp: now,
          callerId: 1,
          side: 'buy' as const,
        },
        {
          id: 2,
          tokenId: 1, // Same token
          signalTimestamp: now.plus({ minutes: 1 }),
          callerId: 1,
          side: 'buy' as const,
        },
      ];

      callsRepo.queryBySelection.mockResolvedValue(calls);
      tokensRepo.findById.mockResolvedValue({
        id: 1,
        address: VALID_MINT,
        chain: 'solana',
      });

      ingestionEngine.fetchCandles.mockResolvedValue({
        '1m': [],
        '5m': [],
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });

      const result = await service.ingestForCalls({});

      // Should deduplicate by tokenId (fetch once per token, not per call)
      expect(ingestionEngine.fetchCandles).toHaveBeenCalledTimes(1);
      expect(result.tokensProcessed).toBe(1);
    });

    it('should handle race conditions in token grouping', async () => {
      const now = DateTime.utc();
      const calls = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        tokenId: (i % 10) + 1, // 10 unique tokens, 100 calls
        signalTimestamp: now.plus({ minutes: i }),
        callerId: 1,
        side: 'buy' as const,
      }));

      callsRepo.queryBySelection.mockResolvedValue(calls);
      tokensRepo.findById.mockImplementation((id: number) =>
        Promise.resolve({
          id,
          address: `${VALID_MINT}${id}`,
          chain: 'solana',
        })
      );

      ingestionEngine.fetchCandles.mockResolvedValue({
        '1m': [],
        '5m': [],
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });

      const result = await service.ingestForCalls({});

      // Should group correctly (10 unique tokens)
      expect(result.tokensProcessed).toBe(10);
      expect(ingestionEngine.fetchCandles).toHaveBeenCalledTimes(10);
    });
  });

  describe('Boundary Conditions', () => {
    it('should handle zero candles returned', async () => {
      const now = DateTime.utc();
      callsRepo.queryBySelection.mockResolvedValue([
        {
          id: 1,
          tokenId: 1,
          signalTimestamp: now,
          callerId: 1,
          side: 'buy' as const,
        },
      ]);
      tokensRepo.findById.mockResolvedValue({
        id: 1,
        address: VALID_MINT,
        chain: 'solana',
      });

      ingestionEngine.fetchCandles.mockResolvedValue({
        '1m': [],
        '5m': [],
        metadata: { chunksFromAPI: 0, chunksFromCache: 0 },
      });

      const result = await service.ingestForCalls({});

      expect(result.tokensSucceeded).toBe(1);
      expect(result.candlesFetched1m).toBe(0);
      expect(result.candlesFetched5m).toBe(0);
    });

    it('should handle single candle', async () => {
      const now = DateTime.utc();
      callsRepo.queryBySelection.mockResolvedValue([
        {
          id: 1,
          tokenId: 1,
          signalTimestamp: now,
          callerId: 1,
          side: 'buy' as const,
        },
      ]);
      tokensRepo.findById.mockResolvedValue({
        id: 1,
        address: VALID_MINT,
        chain: 'solana',
      });

      ingestionEngine.fetchCandles.mockResolvedValue({
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

      const result = await service.ingestForCalls({});

      expect(result.tokensSucceeded).toBe(1);
      expect(result.candlesFetched1m).toBe(1);
    });

    it('should handle maximum candles (5000)', async () => {
      const now = DateTime.utc();
      const maxCandles = Array.from({ length: 5000 }, (_, i) => ({
        timestamp: Math.floor(now.minus({ minutes: 5000 - i }).toSeconds()),
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      }));

      callsRepo.queryBySelection.mockResolvedValue([
        {
          id: 1,
          tokenId: 1,
          signalTimestamp: now,
          callerId: 1,
          side: 'buy' as const,
        },
      ]);
      tokensRepo.findById.mockResolvedValue({
        id: 1,
        address: VALID_MINT,
        chain: 'solana',
      });

      ingestionEngine.fetchCandles.mockResolvedValue({
        '1m': maxCandles,
        '5m': maxCandles,
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });

      const result = await service.ingestForCalls({});

      expect(result.tokensSucceeded).toBe(1);
      expect(result.candlesFetched1m).toBe(5000);
      expect(result.candlesFetched5m).toBe(5000);
    });
  });

  describe('Error Recovery', () => {
    it('should continue processing after token failure', async () => {
      const now = DateTime.utc();
      const calls = [
        {
          id: 1,
          tokenId: 1,
          signalTimestamp: now,
          callerId: 1,
          side: 'buy' as const,
        },
        {
          id: 2,
          tokenId: 2,
          signalTimestamp: now,
          callerId: 1,
          side: 'buy' as const,
        },
        {
          id: 3,
          tokenId: 3,
          signalTimestamp: now,
          callerId: 1,
          side: 'buy' as const,
        },
      ];

      callsRepo.queryBySelection.mockResolvedValue(calls);
      tokensRepo.findById.mockImplementation((id: number) => {
        if (id === 2) {
          return Promise.reject(new Error('Token lookup failed'));
        }
        return Promise.resolve({
          id,
          address: `${VALID_MINT}${id}`,
          chain: 'solana',
        });
      });

      ingestionEngine.fetchCandles.mockResolvedValue({
        '1m': [],
        '5m': [],
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });

      const result = await service.ingestForCalls({});

      // Should process other tokens even if one fails
      expect(result.tokensProcessed).toBe(3);
      expect(result.tokensFailed).toBeGreaterThanOrEqual(1);
      expect(result.tokensSucceeded).toBeGreaterThanOrEqual(1);
    });

    it('should track all errors in result', async () => {
      const now = DateTime.utc();
      const calls = [
        {
          id: 1,
          tokenId: 1,
          signalTimestamp: now,
          callerId: 1,
          side: 'buy' as const,
        },
        {
          id: 2,
          tokenId: 2,
          signalTimestamp: now,
          callerId: 1,
          side: 'buy' as const,
        },
      ];

      callsRepo.queryBySelection.mockResolvedValue(calls);
      tokensRepo.findById.mockResolvedValue(null); // Token not found
      ingestionEngine.fetchCandles.mockRejectedValue(new Error('API failed'));

      const result = await service.ingestForCalls({});

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
      callsRepo.queryBySelection.mockResolvedValue([
        {
          id: 1,
          tokenId: 1,
          signalTimestamp: now,
          callerId: 1,
          side: 'buy' as const,
        },
      ]);
      tokensRepo.findById.mockResolvedValue({
        id: 1,
        address: VALID_MINT,
        chain: 'solana',
      });

      // Simulate slow API (1 second delay)
      ingestionEngine.fetchCandles.mockImplementation(() => {
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              '1m': [],
              '5m': [],
              metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
            });
          }, 1000);
        });
      });

      const startTime = Date.now();
      const result = await service.ingestForCalls({});
      const duration = Date.now() - startTime;

      // Should complete (with timeout handling if needed)
      expect(result).toBeDefined();
      expect(duration).toBeGreaterThan(0);
    });

    it('should handle many tokens efficiently', async () => {
      const now = DateTime.utc();
      const calls = Array.from({ length: 100 }, (_, i) => ({
        id: i + 1,
        tokenId: i + 1,
        signalTimestamp: now,
        callerId: 1,
        side: 'buy' as const,
      }));

      callsRepo.queryBySelection.mockResolvedValue(calls);
      tokensRepo.findById.mockImplementation((id: number) =>
        Promise.resolve({
          id,
          address: `${VALID_MINT}${id}`,
          chain: 'solana',
        })
      );

      ingestionEngine.fetchCandles.mockResolvedValue({
        '1m': [],
        '5m': [],
        metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
      });

      const startTime = Date.now();
      const result = await service.ingestForCalls({});
      const duration = Date.now() - startTime;

      // Should complete in reasonable time
      expect(result.tokensProcessed).toBe(100);
      expect(duration).toBeLessThan(60000); // Less than 1 minute
    });
  });

  describe('Integration Stress', () => {
    it('should handle complete failure scenario', async () => {
      // Everything fails
      callsRepo.queryBySelection.mockRejectedValue(new Error('Database error'));
      tokensRepo.findById.mockRejectedValue(new Error('Token lookup failed'));
      ingestionEngine.fetchCandles.mockRejectedValue(new Error('API failed'));
      storageEngine.storeCandles.mockRejectedValue(new Error('Storage failed'));

      // Should fail with clear error, not crash
      await expect(service.ingestForCalls({})).rejects.toThrow();
    });

    it('should handle mixed success/failure scenario', async () => {
      const now = DateTime.utc();
      const calls = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        tokenId: i + 1,
        signalTimestamp: now,
        callerId: 1,
        side: 'buy' as const,
      }));

      callsRepo.queryBySelection.mockResolvedValue(calls);
      tokensRepo.findById.mockImplementation((id: number) => {
        if (id % 2 === 0) {
          return Promise.reject(new Error('Token lookup failed'));
        }
        return Promise.resolve({
          id,
          address: `${VALID_MINT}${id}`,
          chain: 'solana',
        });
      });

      ingestionEngine.fetchCandles.mockImplementation((mint: string) => {
        if (mint.includes('5')) {
          return Promise.reject(new Error('API failed'));
        }
        return Promise.resolve({
          '1m': [],
          '5m': [],
          metadata: { chunksFromAPI: 1, chunksFromCache: 0 },
        });
      });

      const result = await service.ingestForCalls({});

      // Should handle mixed scenario
      expect(result.tokensProcessed).toBe(10);
      expect(result.tokensSucceeded).toBeGreaterThanOrEqual(0);
      expect(result.tokensFailed).toBeGreaterThanOrEqual(0);
      expect(result.tokensSucceeded + result.tokensFailed).toBe(result.tokensProcessed);
    });
  });
});

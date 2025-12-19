/**
 * Golden Path Tests for ingestOhlcv Workflow
 *
 * Tests the complete happy path for OHLCV ingestion workflow.
 * These tests validate the entire orchestration flow from worklist to stored candles.
 *
 * Golden Path:
 * 1. Generate worklist from DuckDB (offline)
 * 2. Fetch candles from Birdeye API (online)
 * 3. Store candles in ClickHouse (ingestion)
 * 4. Update DuckDB metadata (ingestion)
 * 5. Return structured, JSON-serializable result
 *
 * Tests use mocked WorkflowContext and validate orchestration behavior.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';

// Mock dependencies BEFORE imports to prevent module resolution issues
vi.mock('@quantbot/ingestion', () => ({
  generateOhlcvWorklist: vi.fn(),
}));

vi.mock('@quantbot/ohlcv', () => ({
  storeCandles: vi.fn(),
}));

vi.mock('@quantbot/utils', async () => {
  const actual = await vi.importActual<typeof import('@quantbot/utils')>('@quantbot/utils');
  return {
    ...actual,
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    ValidationError: class extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'ValidationError';
      }
    },
  };
});

vi.mock('@quantbot/jobs', () => ({
  OhlcvBirdeyeFetch: vi.fn().mockImplementation(() => ({
    fetchWorkList: vi.fn(),
  })),
}));

vi.mock('@quantbot/simulation', () => ({
  DuckDBStorageService: vi.fn().mockImplementation(() => ({
    updateOhlcvMetadata: vi.fn(),
  })),
}));

// Now import after mocks are set up
import { ingestOhlcv } from '../../src/ohlcv/ingestOhlcv.js';
import { generateOhlcvWorklist } from '@quantbot/ingestion';
import { storeCandles } from '@quantbot/ohlcv';
import type { IngestOhlcvContext } from '../../src/ohlcv/ingestOhlcv.js';
import type { WorkflowContext } from '../../src/types.js';
import type { OhlcvWorkItem } from '@quantbot/ingestion';
import type { Candle } from '@quantbot/core';

describe('ingestOhlcv Workflow - Golden Path', () => {
  let mockContext: IngestOhlcvContext;
  const TEST_DUCKDB_PATH = '/path/to/test.duckdb';
  const TEST_MINT = '7pXs123456789012345678901234567890pump';
  const TEST_CHAIN = 'solana' as const;
  const TEST_ALERT_TIME = DateTime.utc().minus({ days: 1 });
  const TEST_START_TIME = TEST_ALERT_TIME.minus({ minutes: 260 });
  const TEST_END_TIME = TEST_ALERT_TIME.plus({ minutes: 1440 });

  const mockWorkItem: OhlcvWorkItem = {
    mint: TEST_MINT,
    chain: TEST_CHAIN,
    interval: '1m',
    startTime: TEST_START_TIME,
    endTime: TEST_END_TIME,
    alertTime: TEST_ALERT_TIME,
    priority: 10,
    callCount: 5,
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Create mock context
    mockContext = {
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      clock: {
        now: () => DateTime.utc(),
      },
      ids: {
        generate: () => 'test-id-1',
      },
      jobs: {
        ohlcvBirdeyeFetch: {
          fetchWorkList: vi.fn(),
        },
      },
      duckdbStorage: {
        updateOhlcvMetadata: vi.fn(),
      },
    } as any;
  });

  describe('GOLDEN: Complete ingestion flow - worklist → fetch → store → metadata', () => {
    it('should complete full golden path: generate worklist → fetch → store → update metadata', async () => {
      // Setup: Worklist generation returns items
      const worklist: OhlcvWorkItem[] = [mockWorkItem];
      vi.mocked(generateOhlcvWorklist).mockResolvedValue(worklist);

      // Setup: Fetch returns candles
      const mockCandles: Candle[] = [
        {
          timestamp: Math.floor(TEST_START_TIME.toSeconds()),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
        {
          timestamp: Math.floor(TEST_START_TIME.toSeconds()) + 60,
          open: 1.05,
          high: 1.15,
          low: 0.95,
          close: 1.1,
          volume: 2000,
        },
      ];

      mockContext.jobs.ohlcvBirdeyeFetch.fetchWorkList = vi.fn().mockResolvedValue([
        {
          workItem: mockWorkItem,
          success: true,
          candles: mockCandles,
          candlesFetched: 2,
          skipped: false,
          durationMs: 100,
        },
      ]);

      // Setup: Storage and metadata updates succeed
      vi.mocked(storeCandles).mockResolvedValue(undefined);
      mockContext.duckdbStorage!.updateOhlcvMetadata = vi.fn().mockResolvedValue({
        success: true,
      });

      // Execute: Run workflow
      const result = await ingestOhlcv(
        {
          duckdbPath: TEST_DUCKDB_PATH,
          from: '2024-01-01',
          to: '2024-01-02',
          side: 'buy',
          chain: TEST_CHAIN,
          interval: '1m',
          preWindowMinutes: 260,
          postWindowMinutes: 1440,
          errorMode: 'collect',
          checkCoverage: true,
          rateLimitMs: 100,
          maxRetries: 3,
        },
        mockContext
      );

      // Assert: Complete result structure (JSON-serializable)
      expect(result.worklistGenerated).toBe(1);
      expect(result.workItemsProcessed).toBe(1);
      expect(result.workItemsSucceeded).toBe(1);
      expect(result.workItemsFailed).toBe(0);
      expect(result.workItemsSkipped).toBe(0);
      expect(result.totalCandlesFetched).toBe(2);
      expect(result.totalCandlesStored).toBe(2);
      expect(result.errors).toEqual([]);
      expect(result.startedAtISO).toBeDefined();
      expect(result.completedAtISO).toBeDefined();
      expect(result.durationMs).toBeGreaterThan(0);

      // Assert: Worklist was generated
      expect(generateOhlcvWorklist).toHaveBeenCalledWith(TEST_DUCKDB_PATH, {
        from: expect.any(Date),
        to: expect.any(Date),
        side: 'buy',
        chain: TEST_CHAIN,
        interval: '1m',
        preWindowMinutes: 260,
        postWindowMinutes: 1440,
      });

      // Assert: Fetch was called
      expect(mockContext.jobs.ohlcvBirdeyeFetch.fetchWorkList).toHaveBeenCalledWith(worklist);

      // Assert: Candles were stored
      expect(storeCandles).toHaveBeenCalledWith(TEST_MINT, TEST_CHAIN, mockCandles, '1m');

      // Assert: Metadata was updated
      expect(mockContext.duckdbStorage!.updateOhlcvMetadata).toHaveBeenCalledWith(
        TEST_DUCKDB_PATH,
        TEST_MINT,
        TEST_ALERT_TIME.toISO()!,
        60, // 1m = 60 seconds
        TEST_START_TIME.toISO()!,
        TEST_END_TIME.toISO()!,
        2 // candle count
      );

      // Assert: Result is JSON-serializable (no Date objects, no class instances)
      const jsonString = JSON.stringify(result);
      const parsed = JSON.parse(jsonString);
      expect(parsed).toEqual(result);
    });

    it('should handle multiple work items in worklist', async () => {
      const worklist: OhlcvWorkItem[] = [
        mockWorkItem,
        {
          ...mockWorkItem,
          mint: '8pXs123456789012345678901234567890pump',
        },
        {
          ...mockWorkItem,
          mint: '9pXs123456789012345678901234567890pump',
        },
      ];

      vi.mocked(generateOhlcvWorklist).mockResolvedValue(worklist);

      const mockCandles: Candle[] = [
        {
          timestamp: Math.floor(TEST_START_TIME.toSeconds()),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];

      mockContext.jobs.ohlcvBirdeyeFetch.fetchWorkList = vi.fn().mockResolvedValue(
        worklist.map((item) => ({
          workItem: item,
          success: true,
          candles: mockCandles,
          candlesFetched: 1,
          skipped: false,
          durationMs: 100,
        }))
      );

      vi.mocked(storeCandles).mockResolvedValue(undefined);
      mockContext.duckdbStorage!.updateOhlcvMetadata = vi.fn().mockResolvedValue({
        success: true,
      });

      const result = await ingestOhlcv(
        {
          duckdbPath: TEST_DUCKDB_PATH,
          side: 'buy',
          chain: TEST_CHAIN,
          interval: '1m',
          preWindowMinutes: 260,
          postWindowMinutes: 1440,
          errorMode: 'collect',
          checkCoverage: true,
          rateLimitMs: 100,
          maxRetries: 3,
        },
        mockContext
      );

      // Assert: All items processed
      expect(result.worklistGenerated).toBe(3);
      expect(result.workItemsProcessed).toBe(3);
      expect(result.workItemsSucceeded).toBe(3);
      expect(result.totalCandlesFetched).toBe(3);
      expect(result.totalCandlesStored).toBe(3);

      // Assert: Storage called for each item
      expect(storeCandles).toHaveBeenCalledTimes(3);
    });

    it('should handle skipped items (sufficient coverage)', async () => {
      const worklist: OhlcvWorkItem[] = [mockWorkItem];
      vi.mocked(generateOhlcvWorklist).mockResolvedValue(worklist);

      mockContext.jobs.ohlcvBirdeyeFetch.fetchWorkList = vi.fn().mockResolvedValue([
        {
          workItem: mockWorkItem,
          success: true,
          candles: [],
          candlesFetched: 0,
          skipped: true, // Skipped due to coverage
          durationMs: 50,
        },
      ]);

      const result = await ingestOhlcv(
        {
          duckdbPath: TEST_DUCKDB_PATH,
          side: 'buy',
          chain: TEST_CHAIN,
          interval: '1m',
          preWindowMinutes: 260,
          postWindowMinutes: 1440,
          errorMode: 'collect',
          checkCoverage: true,
          rateLimitMs: 100,
          maxRetries: 3,
        },
        mockContext
      );

      // Assert: Skipped item counted correctly
      expect(result.workItemsProcessed).toBe(1);
      expect(result.workItemsSucceeded).toBe(1);
      expect(result.workItemsSkipped).toBe(1);
      expect(result.totalCandlesFetched).toBe(0);
      expect(result.totalCandlesStored).toBe(0);

      // Assert: No storage call for skipped items
      expect(storeCandles).not.toHaveBeenCalled();
    });
  });

  describe('GOLDEN: Error handling - collect mode', () => {
    it('should collect errors and continue processing (errorMode: collect)', async () => {
      const worklist: OhlcvWorkItem[] = [
        mockWorkItem,
        {
          ...mockWorkItem,
          mint: 'failMint',
        },
        {
          ...mockWorkItem,
          mint: 'successMint',
        },
      ];

      vi.mocked(generateOhlcvWorklist).mockResolvedValue(worklist);

      const mockCandles: Candle[] = [
        {
          timestamp: Math.floor(TEST_START_TIME.toSeconds()),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];

      mockContext.jobs.ohlcvBirdeyeFetch.fetchWorkList = vi.fn().mockResolvedValue([
        {
          workItem: mockWorkItem,
          success: true,
          candles: mockCandles,
          candlesFetched: 1,
          skipped: false,
          durationMs: 100,
        },
        {
          workItem: worklist[1],
          success: false,
          candles: [],
          candlesFetched: 0,
          skipped: false,
          error: 'API error',
          durationMs: 50,
        },
        {
          workItem: worklist[2],
          success: true,
          candles: mockCandles,
          candlesFetched: 1,
          skipped: false,
          durationMs: 100,
        },
      ]);

      vi.mocked(storeCandles).mockResolvedValue(undefined);
      mockContext.duckdbStorage!.updateOhlcvMetadata = vi.fn().mockResolvedValue({
        success: true,
      });

      const result = await ingestOhlcv(
        {
          duckdbPath: TEST_DUCKDB_PATH,
          side: 'buy',
          chain: TEST_CHAIN,
          interval: '1m',
          preWindowMinutes: 260,
          postWindowMinutes: 1440,
          errorMode: 'collect',
          checkCoverage: true,
          rateLimitMs: 100,
          maxRetries: 3,
        },
        mockContext
      );

      // Assert: Errors collected, processing continued
      expect(result.workItemsProcessed).toBe(3);
      expect(result.workItemsSucceeded).toBe(2);
      expect(result.workItemsFailed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].mint).toBe('failMint');
      expect(result.errors[0].error).toBe('API error');

      // Assert: Successful items still processed
      expect(storeCandles).toHaveBeenCalledTimes(2);
    });

    it('should fail fast on worklist generation error (errorMode: failFast)', async () => {
      vi.mocked(generateOhlcvWorklist).mockRejectedValue(new Error('DuckDB error'));

      await expect(
        ingestOhlcv(
          {
            duckdbPath: TEST_DUCKDB_PATH,
            side: 'buy',
            chain: TEST_CHAIN,
            interval: '1m',
            preWindowMinutes: 260,
            postWindowMinutes: 1440,
            errorMode: 'failFast',
            checkCoverage: true,
            rateLimitMs: 100,
            maxRetries: 3,
          },
          mockContext
        )
      ).rejects.toThrow('DuckDB error');
    });
  });

  describe('GOLDEN: Edge cases - boundary conditions', () => {
    it('should handle empty worklist gracefully', async () => {
      vi.mocked(generateOhlcvWorklist).mockResolvedValue([]);

      const result = await ingestOhlcv(
        {
          duckdbPath: TEST_DUCKDB_PATH,
          side: 'buy',
          chain: TEST_CHAIN,
          interval: '1m',
          preWindowMinutes: 260,
          postWindowMinutes: 1440,
          errorMode: 'collect',
          checkCoverage: true,
          rateLimitMs: 100,
          maxRetries: 3,
        },
        mockContext
      );

      // Assert: Empty result structure
      expect(result.worklistGenerated).toBe(0);
      expect(result.workItemsProcessed).toBe(0);
      expect(result.workItemsSucceeded).toBe(0);
      expect(result.totalCandlesFetched).toBe(0);
      expect(result.totalCandlesStored).toBe(0);
      expect(result.errors).toEqual([]);

      // Assert: No fetch or storage calls
      expect(mockContext.jobs.ohlcvBirdeyeFetch.fetchWorkList).not.toHaveBeenCalled();
      expect(storeCandles).not.toHaveBeenCalled();
    });

    it('should handle storage errors gracefully', async () => {
      const worklist: OhlcvWorkItem[] = [mockWorkItem];
      vi.mocked(generateOhlcvWorklist).mockResolvedValue(worklist);

      const mockCandles: Candle[] = [
        {
          timestamp: Math.floor(TEST_START_TIME.toSeconds()),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];

      mockContext.jobs.ohlcvBirdeyeFetch.fetchWorkList = vi.fn().mockResolvedValue([
        {
          workItem: mockWorkItem,
          success: true,
          candles: mockCandles,
          candlesFetched: 1,
          skipped: false,
          durationMs: 100,
        },
      ]);

      vi.mocked(storeCandles).mockRejectedValue(new Error('Storage error'));

      const result = await ingestOhlcv(
        {
          duckdbPath: TEST_DUCKDB_PATH,
          side: 'buy',
          chain: TEST_CHAIN,
          interval: '1m',
          preWindowMinutes: 260,
          postWindowMinutes: 1440,
          errorMode: 'collect',
          checkCoverage: true,
          rateLimitMs: 100,
          maxRetries: 3,
        },
        mockContext
      );

      // Assert: Error captured, workflow continues
      expect(result.workItemsFailed).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].error).toContain('Storage error');
    });

    it('should handle all supported intervals correctly', async () => {
      const intervals: Array<'15s' | '1m' | '5m' | '1H'> = ['15s', '1m', '5m', '1H'];

      for (const interval of intervals) {
        const workItem = { ...mockWorkItem, interval };
        const worklist: OhlcvWorkItem[] = [workItem];

        vi.mocked(generateOhlcvWorklist).mockResolvedValue(worklist);

        const mockCandles: Candle[] = [
          {
            timestamp: Math.floor(TEST_START_TIME.toSeconds()),
            open: 1.0,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 1000,
          },
        ];

        mockContext.jobs.ohlcvBirdeyeFetch.fetchWorkList = vi.fn().mockResolvedValue([
          {
            workItem,
            success: true,
            candles: mockCandles,
            candlesFetched: 1,
            skipped: false,
            durationMs: 100,
          },
        ]);

        vi.mocked(storeCandles).mockResolvedValue(undefined);
        mockContext.duckdbStorage!.updateOhlcvMetadata = vi.fn().mockResolvedValue({
          success: true,
        });

        const result = await ingestOhlcv(
          {
            duckdbPath: TEST_DUCKDB_PATH,
            side: 'buy',
            chain: TEST_CHAIN,
            interval,
            preWindowMinutes: 260,
            postWindowMinutes: 1440,
            errorMode: 'collect',
            checkCoverage: true,
            rateLimitMs: 100,
            maxRetries: 3,
          },
          mockContext
        );

        expect(result.workItemsSucceeded).toBe(1);
        expect(storeCandles).toHaveBeenCalledWith(TEST_MINT, TEST_CHAIN, mockCandles, interval);
      }
    });
  });

  describe('GOLDEN: Result serialization - JSON-safe', () => {
    it('should return JSON-serializable result (no Date objects, no class instances)', async () => {
      const worklist: OhlcvWorkItem[] = [mockWorkItem];
      vi.mocked(generateOhlcvWorklist).mockResolvedValue(worklist);

      const mockCandles: Candle[] = [
        {
          timestamp: Math.floor(TEST_START_TIME.toSeconds()),
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        },
      ];

      mockContext.jobs.ohlcvBirdeyeFetch.fetchWorkList = vi.fn().mockResolvedValue([
        {
          workItem: mockWorkItem,
          success: true,
          candles: mockCandles,
          candlesFetched: 1,
          skipped: false,
          durationMs: 100,
        },
      ]);

      vi.mocked(storeCandles).mockResolvedValue(undefined);
      mockContext.duckdbStorage!.updateOhlcvMetadata = vi.fn().mockResolvedValue({
        success: true,
      });

      const result = await ingestOhlcv(
        {
          duckdbPath: TEST_DUCKDB_PATH,
          side: 'buy',
          chain: TEST_CHAIN,
          interval: '1m',
          preWindowMinutes: 260,
          postWindowMinutes: 1440,
          errorMode: 'collect',
          checkCoverage: true,
          rateLimitMs: 100,
          maxRetries: 3,
        },
        mockContext
      );

      // Assert: Can serialize to JSON
      const jsonString = JSON.stringify(result);
      expect(jsonString).toBeDefined();

      // Assert: Can parse back
      const parsed = JSON.parse(jsonString);
      expect(parsed).toEqual(result);

      // Assert: No Date objects (all ISO strings)
      expect(typeof parsed.startedAtISO).toBe('string');
      expect(typeof parsed.completedAtISO).toBe('string');
      expect(parsed.startedAtISO).toMatch(/^\d{4}-\d{2}-\d{2}T/); // ISO format
    });
  });
});

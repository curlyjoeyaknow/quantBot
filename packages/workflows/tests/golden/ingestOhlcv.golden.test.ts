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
  getCoverage: vi.fn(),
}));

// Mock API clients to avoid requiring API keys in tests
vi.mock('@quantbot/infra/api-clients', () => ({
  getBirdeyeClient: vi.fn(() => ({
    fetchOhlcv: vi.fn(),
    fetchTokenCreationInfo: vi.fn(),
    fetchOHLCVData: vi.fn(),
    getTokenMetadata: vi.fn(),
    fetchHistoricalPriceAtUnixTime: vi.fn(),
  })),
}));

// Also mock the infra path (consolidation shim)
vi.mock('@quantbot/infra/api-clients', () => ({
  getBirdeyeClient: vi.fn(() => ({
    fetchOhlcv: vi.fn(),
    fetchTokenCreationInfo: vi.fn(),
    fetchOHLCVData: vi.fn(),
    getTokenMetadata: vi.fn(),
    fetchHistoricalPriceAtUnixTime: vi.fn(),
  })),
}));

vi.mock('@quantbot/infra/utils', async () => {
  const actual =
    await vi.importActual<typeof import('@quantbot/infra/utils')>('@quantbot/infra/utils');
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

// No need to mock @quantbot/jobs or @quantbot/backtest - workflow uses ports directly

// Now import after mocks are set up
import { ingestOhlcv } from '../../src/ohlcv/ingestOhlcv.js';
import { generateOhlcvWorklist } from '@quantbot/ingestion';
import { storeCandles, getCoverage } from '@quantbot/ohlcv';
import type { IngestOhlcvContext } from '../../src/ohlcv/ingestOhlcv.js';
import type { WorkflowContext } from '../../src/types.js';
import type { OhlcvWorkItem } from '@quantbot/core';
import type { Candle } from '@quantbot/core';
import { createOhlcvIngestionContext } from '../../src/context/createOhlcvIngestionContext.js';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

describe('ingestOhlcv Workflow - Golden Path', () => {
  let mockContext: IngestOhlcvContext;
  let testStateDbPath: string;
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

  beforeEach(async () => {
    vi.clearAllMocks();
    // Default: getCoverage returns insufficient coverage (so fetch happens)
    vi.mocked(getCoverage).mockResolvedValue({
      hasData: false,
      candleCount: 0,
      coverageRatio: 0.0,
      gaps: [],
    });

    // Create temporary DuckDB file for state port (real adapter, test-friendly path)
    testStateDbPath = join(tmpdir(), `test-state-${randomUUID()}.duckdb`);

    // Create context with real port adapters using test-friendly configuration
    // This uses REAL adapters, not mocks - just configured for tests (temp files, etc.)
    mockContext = await createOhlcvIngestionContext({
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      duckdbPath: testStateDbPath, // Use temp file for state port
    });

    // Wrap port methods in spies so we can assert on calls
    // We keep the real adapter implementations but add spy functionality for tests
    const originalFetchOhlcv = mockContext.ports.marketData.fetchOhlcv;
    mockContext.ports.marketData.fetchOhlcv = vi.fn(originalFetchOhlcv);

    const originalStateSet = mockContext.ports.state.set;
    mockContext.ports.state.set = vi.fn(originalStateSet);

    const originalStateGet = mockContext.ports.state.get;
    mockContext.ports.state.get = vi.fn(originalStateGet);
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

      // Setup: Mock marketData.fetchOhlcv to return test data
      // (already wrapped in spy, just set the return value)
      vi.mocked(mockContext.ports.marketData.fetchOhlcv).mockResolvedValue(mockCandles);

      // Setup: Storage and metadata updates succeed
      vi.mocked(storeCandles).mockResolvedValue(undefined);
      // Mock state.set to return success (already wrapped in spy)
      vi.mocked(mockContext.ports.state.set).mockResolvedValue({ success: true });

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

      // Assert: Market data port was called
      expect(mockContext.ports.marketData.fetchOhlcv).toHaveBeenCalled();

      // Assert: Candles were stored
      expect(storeCandles).toHaveBeenCalledWith(TEST_MINT, TEST_CHAIN, mockCandles, '1m');

      // Assert: Metadata was updated via StatePort
      expect(mockContext.ports.state.set).toHaveBeenCalled();

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

      // Setup: Coverage check returns insufficient coverage (so fetch happens)
      vi.mocked(getCoverage).mockResolvedValue({
        hasData: false,
        candleCount: 0,
        coverageRatio: 0.0,
        gaps: [],
      });

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

      // Setup: Market data port returns candles for each work item
      vi.mocked(mockContext.ports.marketData.fetchOhlcv).mockResolvedValue(mockCandles);

      vi.mocked(storeCandles).mockResolvedValue(undefined);
      vi.mocked(mockContext.ports.state.set).mockResolvedValue({ success: true });

      const result = await ingestOhlcv(
        {
          duckdbPath: TEST_DUCKDB_PATH,
          side: 'buy',
          chain: TEST_CHAIN,
          interval: '1m',
          preWindowMinutes: 260,
          postWindowMinutes: 1440,
          errorMode: 'collect',
          checkCoverage: false, // Disable coverage check for this test to avoid timeout
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
    }, 30000); // 30 second timeout

    it('should handle skipped items (sufficient coverage)', async () => {
      const worklist: OhlcvWorkItem[] = [mockWorkItem];
      vi.mocked(generateOhlcvWorklist).mockResolvedValue(worklist);

      // Setup: Idempotency check returns not found (so item is processed)
      vi.mocked(mockContext.ports.state.get).mockResolvedValue({ found: false });

      // Setup: Coverage check returns sufficient coverage (skipped)
      vi.mocked(getCoverage).mockResolvedValue({
        hasData: true,
        candleCount: 1000,
        coverageRatio: 0.98, // Above 0.95 threshold, so skip
        gaps: [],
      });
      // Market data port not called for skipped items (reset mock)
      vi.mocked(mockContext.ports.marketData.fetchOhlcv).mockClear();

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
      // Note: When coverage is sufficient, the item is added to fetchResults with success: true
      // but candlesFetched: 0 and candlesStored: 0. It's not marked as "skipped" in the final result.
      // The workflow treats it as a successful item with no work done.
      expect(result.workItemsProcessed).toBe(1);
      expect(result.workItemsSucceeded).toBe(1);
      expect(result.totalCandlesFetched).toBe(0);
      expect(result.totalCandlesStored).toBe(0);

      // Assert: No storage call for skipped items
      expect(storeCandles).not.toHaveBeenCalled();
      // Assert: Coverage check was called
      expect(getCoverage).toHaveBeenCalled();
    });
  });

  describe('GOLDEN: Mint filtering', () => {
    it('should filter worklist by specific mints when provided', async () => {
      const targetMints = [
        '7pXs123456789012345678901234567890pump',
        '8pXs123456789012345678901234567890pump',
      ];
      const otherMint = '9pXs123456789012345678901234567890pump';

      // Mock worklist with all mints (Python will filter)
      const filteredWorklist: OhlcvWorkItem[] = [
        {
          ...mockWorkItem,
          mint: targetMints[0],
        },
        {
          ...mockWorkItem,
          mint: targetMints[1],
        },
      ];

      vi.mocked(generateOhlcvWorklist).mockResolvedValue(filteredWorklist);

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

      // Setup: Market data port returns candles for each work item
      vi.mocked(mockContext.ports.marketData.fetchOhlcv).mockResolvedValue(mockCandles);

      vi.mocked(storeCandles).mockResolvedValue(undefined);
      vi.mocked(mockContext.ports.state.set).mockResolvedValue({ success: true });

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
          mints: targetMints, // Filter by specific mints
        },
        mockContext
      );

      // Assert: Only filtered mints were processed
      expect(result.worklistGenerated).toBe(2);
      expect(result.workItemsProcessed).toBe(2);
      expect(result.workItemsSucceeded).toBe(2);

      // Assert: generateOhlcvWorklist was called with mints parameter
      expect(generateOhlcvWorklist).toHaveBeenCalledWith(
        TEST_DUCKDB_PATH,
        expect.objectContaining({
          mints: targetMints,
        })
      );

      // Assert: Market data port was called for each target mint
      expect(mockContext.ports.marketData.fetchOhlcv).toHaveBeenCalledTimes(2);
    }, 15000); // 15 second timeout for workflow with multiple items

    it('should handle empty worklist when mints filter returns no results', async () => {
      const targetMints = ['nonexistentMint'];

      // Mock empty worklist (no mints match)
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
          mints: targetMints,
        },
        mockContext
      );

      // Assert: Empty result (no items to process)
      expect(result.worklistGenerated).toBe(0);
      expect(result.workItemsProcessed).toBe(0);
      expect(result.workItemsSucceeded).toBe(0);
      expect(result.totalCandlesFetched).toBe(0);
      expect(result.totalCandlesStored).toBe(0);

      // Assert: generateOhlcvWorklist was called with mints
      expect(generateOhlcvWorklist).toHaveBeenCalledWith(
        TEST_DUCKDB_PATH,
        expect.objectContaining({
          mints: targetMints,
        })
      );

      // Assert: No fetch or storage calls
      expect(mockContext.ports.marketData.fetchOhlcv).not.toHaveBeenCalled();
      expect(storeCandles).not.toHaveBeenCalled();
    });

    it('should preserve mint address case exactly when filtering', async () => {
      const mixedCaseMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

      const filteredWorklist: OhlcvWorkItem[] = [
        {
          ...mockWorkItem,
          mint: mixedCaseMint,
        },
      ];

      vi.mocked(generateOhlcvWorklist).mockResolvedValue(filteredWorklist);

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

      // Setup: Market data port returns candles
      mockContext.ports.marketData.fetchOhlcv = vi.fn().mockResolvedValue(mockCandles);

      vi.mocked(storeCandles).mockResolvedValue(undefined);
      mockContext.ports.state.set = vi.fn().mockResolvedValue({ success: true });

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
          mints: [mixedCaseMint], // Pass exact case
        },
        mockContext
      );

      // Assert: Mint case preserved
      expect(result.worklistGenerated).toBe(1);
      // Verify market data port was called with correct mint
      expect(mockContext.ports.marketData.fetchOhlcv).toHaveBeenCalled();
      const fetchCall = mockContext.ports.marketData.fetchOhlcv.mock.calls[0][0];
      expect(fetchCall.tokenAddress).toBe(mixedCaseMint);
    });
  });

  describe('GOLDEN: Error handling - collect mode', () => {
    it('should collect errors and continue processing (errorMode: collect)', async () => {
      // Create worklist with 3 items: first succeeds, second fails, third succeeds
      // Use proper mint addresses (32-44 chars) to pass createTokenAddress validation
      const firstMint = TEST_MINT; // '7pXs123456789012345678901234567890pump'
      const failMint = '8pXs123456789012345678901234567890pump'; // 32 chars
      const successMint = '9pXs123456789012345678901234567890pump'; // 32 chars

      const worklist: OhlcvWorkItem[] = [
        { ...mockWorkItem, mint: firstMint },
        { ...mockWorkItem, mint: failMint },
        { ...mockWorkItem, mint: successMint },
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

      // Setup: Idempotency check returns not found for all items (so they all get processed)
      mockContext.ports.state.get = vi.fn().mockResolvedValue({ found: false });

      // Setup: Coverage check returns insufficient coverage for all items (so fetch happens)
      vi.mocked(getCoverage).mockResolvedValue({
        hasData: false,
        candleCount: 0,
        coverageRatio: 0.0,
        gaps: [],
      });

      // Setup: Market data port returns candles for first and third, error for second
      // The workflow processes items sequentially and retries on failure
      // We need to mock per mint address, and the second mint should always fail
      vi.mocked(mockContext.ports.marketData.fetchOhlcv).mockImplementation((request) => {
        // Extract mint from tokenAddress
        // createTokenAddress returns a branded string (TokenAddress), not an object
        const mint = request.tokenAddress as string;

        // Second work item should always fail (even on retries)
        if (mint === failMint) {
          return Promise.reject(new Error('API error'));
        }
        // First and third work items succeed
        return Promise.resolve(mockCandles);
      });

      vi.mocked(storeCandles).mockResolvedValue(undefined);
      mockContext.ports.state.set = vi.fn().mockResolvedValue({ success: true });

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
      expect(result.errors[0].mint).toBe(failMint);
      expect(result.errors[0].error).toBe('API error');

      // Assert: Market data port was called (at least 3 times, possibly more due to retries)
      expect(mockContext.ports.marketData.fetchOhlcv).toHaveBeenCalled();

      // Assert: Successful items still processed (2 successful fetches = 2 storage calls)
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
      expect(mockContext.ports.marketData.fetchOhlcv).not.toHaveBeenCalled();
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

      // Setup: Market data port returns candles
      mockContext.ports.marketData.fetchOhlcv = vi.fn().mockResolvedValue(mockCandles);

      vi.mocked(storeCandles).mockRejectedValue(new Error('Storage error'));
      // Reset state.set to default behavior (already wrapped in spy)
      vi.mocked(mockContext.ports.state.set).mockResolvedValue({ success: true });

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

        // Setup: Market data port returns candles
        mockContext.ports.marketData.fetchOhlcv = vi.fn().mockResolvedValue(mockCandles);

        vi.mocked(storeCandles).mockResolvedValue(undefined);
        mockContext.ports.state.set = vi.fn().mockResolvedValue({ success: true });

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
    }, 30000); // 30 second timeout
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

      // Setup: Market data port returns candles
      mockContext.ports.marketData.fetchOhlcv = vi.fn().mockResolvedValue(mockCandles);

      vi.mocked(storeCandles).mockResolvedValue(undefined);
      mockContext.ports.state.set = vi.fn().mockResolvedValue({ success: true });

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

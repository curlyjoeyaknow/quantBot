/**
 * Golden Path Tests for OhlcvBirdeyeFetch
 *
 * Tests the complete happy path for fetching OHLCV candles from Birdeye API.
 * These tests validate the entire fetch flow from work item to raw candles.
 *
 * Golden Path:
 * 1. Receive work item with mint, chain, interval, time window
 * 2. Check coverage (optional, can skip if sufficient)
 * 3. Fetch candles from Birdeye API
 * 4. Return raw candles (no storage)
 *
 * Tests use real implementations where possible and push to absolute limits.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { OhlcvBirdeyeFetch } from '../../src/ohlcv-birdeye-fetch.js';
import { fetchBirdeyeCandles } from '@quantbot/api-clients';
import { getCoverage } from '@quantbot/ohlcv';
import type { OhlcvWorkItem } from '@quantbot/ingestion';
import type { Candle } from '@quantbot/core';

// Mock dependencies
vi.mock('@quantbot/api-clients', () => ({
  fetchBirdeyeCandles: vi.fn(),
}));

vi.mock('@quantbot/ohlcv', () => ({
  getCoverage: vi.fn(),
}));

vi.mock('@quantbot/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('OhlcvBirdeyeFetch - Golden Path', () => {
  let fetchService: OhlcvBirdeyeFetch;
  const TEST_MINT = '7pXs1234567890123456789012345678901234pump'; // Full 44-char address
  const TEST_CHAIN = 'solana' as const;
  const TEST_INTERVAL = '1m' as const;
  const TEST_ALERT_TIME = DateTime.utc().minus({ days: 1 });
  const TEST_START_TIME = TEST_ALERT_TIME.minus({ minutes: 260 });
  const TEST_END_TIME = TEST_ALERT_TIME.plus({ minutes: 1440 });

  const mockWorkItem: OhlcvWorkItem = {
    mint: TEST_MINT,
    chain: TEST_CHAIN,
    interval: TEST_INTERVAL,
    startTime: TEST_START_TIME,
    endTime: TEST_END_TIME,
    alertTime: TEST_ALERT_TIME,
    priority: 10,
    callCount: 5,
  };

  beforeEach(() => {
    fetchService = new OhlcvBirdeyeFetch({
      rateLimitMs: 10, // Fast for tests
      maxRetries: 3,
      checkCoverage: true,
      minCoverageToSkip: 0.95,
    });
    vi.clearAllMocks();
  });

  describe('GOLDEN: Complete fetch flow - successful fetch', () => {
    it('should complete full golden path: work item → coverage check → API fetch → return candles', async () => {
      // Setup: Coverage check indicates we need data
      vi.mocked(getCoverage).mockResolvedValue({
        hasData: false,
        coverageRatio: 0,
        candleCount: 0,
      });

      // Setup: Birdeye API returns candles
      const expectedCandles: Candle[] = [
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
        {
          timestamp: Math.floor(TEST_START_TIME.toSeconds()) + 120,
          open: 1.1,
          high: 1.2,
          low: 1.0,
          close: 1.15,
          volume: 3000,
        },
      ];

      vi.mocked(fetchBirdeyeCandles).mockResolvedValue(expectedCandles);

      // Execute: Fetch work item
      const result = await fetchService.fetchWorkItem(mockWorkItem);

      // Assert: Complete success
      expect(result.success).toBe(true);
      expect(result.candles).toEqual(expectedCandles);
      expect(result.candlesFetched).toBe(3);
      expect(result.skipped).toBe(false);
      expect(result.error).toBeUndefined();
      expect(result.durationMs).toBeGreaterThanOrEqual(0); // Duration can be 0 in fast tests

      // Assert: Coverage was checked
      expect(getCoverage).toHaveBeenCalledWith(
        TEST_MINT,
        TEST_CHAIN,
        TEST_START_TIME.toJSDate(),
        TEST_END_TIME.toJSDate(),
        TEST_INTERVAL
      );

      // Assert: API was called with correct parameters
      expect(fetchBirdeyeCandles).toHaveBeenCalledWith(
        TEST_MINT,
        TEST_INTERVAL,
        Math.floor(TEST_START_TIME.toSeconds()),
        Math.floor(TEST_END_TIME.toSeconds()),
        TEST_CHAIN
      );

      // Assert: Mint address preserved exactly (case and length)
      const apiCall = vi.mocked(fetchBirdeyeCandles).mock.calls[0];
      expect(apiCall[0]).toBe(TEST_MINT); // Exact match, no truncation
      expect(apiCall[0].length).toBeGreaterThanOrEqual(32); // Valid address length (32-44 chars)
    });

    it('should handle large candle responses (5000+ candles - API limit)', async () => {
      // Setup: Generate 5000 candles (maximum efficient chunk size)
      const largeCandleSet: Candle[] = [];
      const baseTimestamp = Math.floor(TEST_START_TIME.toSeconds());
      for (let i = 0; i < 5000; i++) {
        largeCandleSet.push({
          timestamp: baseTimestamp + i * 60, // 1 minute intervals
          open: 1.0 + i * 0.0001,
          high: 1.1 + i * 0.0001,
          low: 0.9 + i * 0.0001,
          close: 1.05 + i * 0.0001,
          volume: 1000 + i,
        });
      }

      vi.mocked(getCoverage).mockResolvedValue({
        hasData: false,
        coverageRatio: 0,
        candleCount: 0,
      });

      vi.mocked(fetchBirdeyeCandles).mockResolvedValue(largeCandleSet);

      // Execute
      const result = await fetchService.fetchWorkItem(mockWorkItem);

      // Assert: All candles returned
      expect(result.success).toBe(true);
      expect(result.candlesFetched).toBe(5000);
      expect(result.candles).toHaveLength(5000);
      expect(result.candles[0].timestamp).toBe(baseTimestamp);
      expect(result.candles[4999].timestamp).toBe(baseTimestamp + 4999 * 60);
    });

    it('should preserve mint address case exactly (critical for Solana)', async () => {
      const mixedCaseMint = '7pXsAbCdEfGhIjKlMnOpQrStUvWxYz12345678901234';
      const workItem = { ...mockWorkItem, mint: mixedCaseMint };

      vi.mocked(getCoverage).mockResolvedValue({
        hasData: false,
        coverageRatio: 0,
        candleCount: 0,
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

      vi.mocked(fetchBirdeyeCandles).mockResolvedValue(mockCandles);

      await fetchService.fetchWorkItem(workItem);

      // Assert: Mint address passed exactly as provided (case preserved)
      const apiCall = vi.mocked(fetchBirdeyeCandles).mock.calls[0];
      expect(apiCall[0]).toBe(mixedCaseMint);
      expect(apiCall[0]).toMatch(/7pXsAbCdEfGhIjKlMnOpQrStUvWxYz/); // Exact case match
    });
  });

  describe('GOLDEN: Worklist processing - multiple items', () => {
    it('should process worklist with rate limiting and return all results', async () => {
      const workItems: OhlcvWorkItem[] = [
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

      vi.mocked(getCoverage).mockResolvedValue({
        hasData: false,
        coverageRatio: 0,
        candleCount: 0,
      });

      vi.mocked(fetchBirdeyeCandles).mockResolvedValue(mockCandles);

      const rateLimitMs = 50;
      fetchService = new OhlcvBirdeyeFetch({ rateLimitMs, checkCoverage: false });

      const startTime = Date.now();
      const results = await fetchService.fetchWorkList(workItems);
      const duration = Date.now() - startTime;

      // Assert: All items processed
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.success)).toBe(true);
      expect(results.every((r) => r.candlesFetched === 1)).toBe(true);

      // Assert: Rate limiting applied (at least 2 delays for 3 items)
      expect(duration).toBeGreaterThanOrEqual(rateLimitMs * 2);

      // Assert: All mints processed correctly
      expect(results[0].workItem.mint).toBe(workItems[0].mint);
      expect(results[1].workItem.mint).toBe(workItems[1].mint);
      expect(results[2].workItem.mint).toBe(workItems[2].mint);
    });

    it('should handle mixed success/failure in worklist gracefully', async () => {
      const workItems: OhlcvWorkItem[] = [
        mockWorkItem,
        { ...mockWorkItem, mint: 'failMint' },
        { ...mockWorkItem, mint: 'successMint' },
      ];

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

      vi.mocked(getCoverage).mockResolvedValue({
        hasData: false,
        coverageRatio: 0,
        candleCount: 0,
      });

      vi.mocked(fetchBirdeyeCandles)
        .mockResolvedValueOnce(mockCandles) // First succeeds
        .mockRejectedValueOnce(new Error('API error')) // Second fails
        .mockResolvedValueOnce(mockCandles); // Third succeeds

      const results = await fetchService.fetchWorkList(workItems);

      // Assert: All items processed, failures captured
      expect(results).toHaveLength(3);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('API error');
      expect(results[2].success).toBe(true);

      // Assert: Successful items have candles
      expect(results[0].candlesFetched).toBe(1);
      expect(results[1].candlesFetched).toBe(0);
      expect(results[2].candlesFetched).toBe(1);
    });
  });

  describe('GOLDEN: Coverage optimization - skip unnecessary fetches', () => {
    it('should skip fetch when coverage is sufficient', async () => {
      vi.mocked(getCoverage).mockResolvedValue({
        hasData: true,
        coverageRatio: 0.98, // Above 0.95 threshold
        candleCount: 2000,
      });

      const result = await fetchService.fetchWorkItem(mockWorkItem);

      // Assert: Skipped, no API call
      expect(result.success).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.candlesFetched).toBe(0);
      expect(result.candles).toEqual([]);
      expect(fetchBirdeyeCandles).not.toHaveBeenCalled();
    });

    it('should fetch when coverage is below threshold', async () => {
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

      vi.mocked(getCoverage).mockResolvedValue({
        hasData: true,
        coverageRatio: 0.9, // Below 0.95 threshold
        candleCount: 500,
      });

      vi.mocked(fetchBirdeyeCandles).mockResolvedValue(mockCandles);

      const result = await fetchService.fetchWorkItem(mockWorkItem);

      // Assert: Fetched despite partial coverage
      expect(result.success).toBe(true);
      expect(result.skipped).toBe(false);
      expect(result.candlesFetched).toBe(1);
      expect(fetchBirdeyeCandles).toHaveBeenCalled();
    });
  });

  describe('GOLDEN: Circuit breaker - failure handling', () => {
    it('should open circuit breaker after threshold failures and block requests', async () => {
      const threshold = 5;
      fetchService = new OhlcvBirdeyeFetch({
        circuitBreakerThreshold: threshold,
        checkCoverage: false,
      });

      vi.mocked(fetchBirdeyeCandles).mockRejectedValue(new Error('API error'));

      // Trigger failures up to threshold
      for (let i = 0; i < threshold; i++) {
        await fetchService.fetchWorkItem(mockWorkItem);
      }

      // Assert: Circuit breaker state
      const state = fetchService.getCircuitBreakerState();
      expect(state.failureCount).toBe(threshold);
      expect(state.isOpen).toBe(true);

      // Next call should be blocked
      const result = await fetchService.fetchWorkItem(mockWorkItem);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Circuit breaker open');
      expect(fetchBirdeyeCandles).toHaveBeenCalledTimes(threshold); // No additional call
    });

    it('should reset circuit breaker on successful fetch', async () => {
      const threshold = 3;
      fetchService = new OhlcvBirdeyeFetch({
        circuitBreakerThreshold: threshold,
        checkCoverage: false,
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

      // Trigger failures
      vi.mocked(fetchBirdeyeCandles).mockRejectedValue(new Error('API error'));
      for (let i = 0; i < threshold - 1; i++) {
        await fetchService.fetchWorkItem(mockWorkItem);
      }

      // Success should reset
      vi.mocked(fetchBirdeyeCandles).mockResolvedValue(mockCandles);
      const successResult = await fetchService.fetchWorkItem(mockWorkItem);

      expect(successResult.success).toBe(true);
      expect(fetchService.getCircuitBreakerState().failureCount).toBe(0);
      expect(fetchService.getCircuitBreakerState().isOpen).toBe(false);
    });
  });

  describe('GOLDEN: Edge cases - boundary conditions', () => {
    it('should handle empty candle response gracefully', async () => {
      vi.mocked(getCoverage).mockResolvedValue({
        hasData: false,
        coverageRatio: 0,
        candleCount: 0,
      });

      vi.mocked(fetchBirdeyeCandles).mockResolvedValue([]);

      const result = await fetchService.fetchWorkItem(mockWorkItem);

      expect(result.success).toBe(true);
      expect(result.candles).toEqual([]);
      expect(result.candlesFetched).toBe(0);
      expect(result.skipped).toBe(false); // Not skipped, just no data
    });

    it('should handle very large time windows (stress test)', async () => {
      const largeWindowWorkItem: OhlcvWorkItem = {
        ...mockWorkItem,
        startTime: DateTime.utc().minus({ days: 30 }),
        endTime: DateTime.utc(),
      };

      const largeCandleSet: Candle[] = [];
      const baseTimestamp = Math.floor(largeWindowWorkItem.startTime.toSeconds());
      // Generate 1 candle per minute for 30 days = 43,200 candles
      for (let i = 0; i < 43200; i++) {
        largeCandleSet.push({
          timestamp: baseTimestamp + i * 60,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        });
      }

      vi.mocked(getCoverage).mockResolvedValue({
        hasData: false,
        coverageRatio: 0,
        candleCount: 0,
      });

      vi.mocked(fetchBirdeyeCandles).mockResolvedValue(largeCandleSet);

      const result = await fetchService.fetchWorkItem(largeWindowWorkItem);

      expect(result.success).toBe(true);
      expect(result.candlesFetched).toBe(43200);
      expect(result.candles).toHaveLength(43200);
    });

    it('should handle all supported intervals correctly', async () => {
      const intervals: Array<'15s' | '1m' | '5m' | '1H'> = ['15s', '1m', '5m', '1H'];

      for (const interval of intervals) {
        const workItem = { ...mockWorkItem, interval };
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

        vi.mocked(getCoverage).mockResolvedValue({
          hasData: false,
          coverageRatio: 0,
          candleCount: 0,
        });

        vi.mocked(fetchBirdeyeCandles).mockResolvedValue(mockCandles);

        const result = await fetchService.fetchWorkItem(workItem);

        expect(result.success).toBe(true);
        expect(fetchBirdeyeCandles).toHaveBeenCalledWith(
          TEST_MINT,
          interval,
          expect.any(Number),
          expect.any(Number),
          TEST_CHAIN
        );
      }
    });

    it('should handle all supported chains correctly', async () => {
      const chains: Array<'solana' | 'ethereum' | 'base' | 'bsc'> = [
        'solana',
        'ethereum',
        'base',
        'bsc',
      ];

      for (const chain of chains) {
        const workItem = { ...mockWorkItem, chain };
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

        vi.mocked(getCoverage).mockResolvedValue({
          hasData: false,
          coverageRatio: 0,
          candleCount: 0,
        });

        vi.mocked(fetchBirdeyeCandles).mockResolvedValue(mockCandles);

        const result = await fetchService.fetchWorkItem(workItem);

        expect(result.success).toBe(true);
        expect(fetchBirdeyeCandles).toHaveBeenCalledWith(
          TEST_MINT,
          TEST_INTERVAL,
          expect.any(Number),
          expect.any(Number),
          chain
        );
      }
    });
  });
});

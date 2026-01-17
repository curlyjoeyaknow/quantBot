/**
 * Unit tests for OhlcvBirdeyeFetch
 *
 * Tests cover:
 * - Fetching candles from Birdeye API (fetch only, no storage)
 * - Coverage checking to skip unnecessary API calls
 * - Rate limiting
 * - Circuit breaker behavior
 * - Error handling
 * - Worklist processing
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import { OhlcvBirdeyeFetch } from '../../src/ohlcv-birdeye-fetch.js';
import { fetchBirdeyeCandles } from '@quantbot/api-clients';
import { getCoverage } from '@quantbot/data/ohlcv';
import type { OhlcvWorkItem } from '@quantbot/data/ingestion';
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

describe('OhlcvBirdeyeFetch', () => {
  let fetchService: OhlcvBirdeyeFetch;
  const TEST_MINT = '7pXs123456789012345678901234567890pump';
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

  describe('fetchWorkItem', () => {
    it('should fetch candles from Birdeye API', async () => {
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

      vi.mocked(getCoverage).mockResolvedValue({
        hasData: false,
        coverageRatio: 0,
        candleCount: 0,
      });

      vi.mocked(fetchBirdeyeCandles).mockResolvedValue(mockCandles);

      const result = await fetchService.fetchWorkItem(mockWorkItem);

      expect(result.success).toBe(true);
      expect(result.candles).toEqual(mockCandles);
      expect(result.candlesFetched).toBe(2);
      expect(result.skipped).toBe(false);
      expect(fetchBirdeyeCandles).toHaveBeenCalledWith(
        TEST_MINT,
        TEST_INTERVAL,
        Math.floor(TEST_START_TIME.toSeconds()),
        Math.floor(TEST_END_TIME.toSeconds()),
        TEST_CHAIN
      );
    });

    it('should skip fetch if coverage is sufficient', async () => {
      vi.mocked(getCoverage).mockResolvedValue({
        hasData: true,
        coverageRatio: 0.98, // Above threshold
        candleCount: 1000,
      });

      const result = await fetchService.fetchWorkItem(mockWorkItem);

      expect(result.success).toBe(true);
      expect(result.candles).toEqual([]);
      expect(result.candlesFetched).toBe(0);
      expect(result.skipped).toBe(true);
      expect(fetchBirdeyeCandles).not.toHaveBeenCalled();
    });

    it('should fetch if coverage is below threshold', async () => {
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

      // Set hasData: false to avoid early return for insufficient candles
      // The code has a MIN_REQUIRED_CANDLES check that returns early if hasData && candleCount < 5000
      vi.mocked(getCoverage).mockResolvedValue({
        hasData: false, // No existing data, so we should fetch
        coverageRatio: 0.9, // Below threshold
        candleCount: 0, // No existing candles
      });

      vi.mocked(fetchBirdeyeCandles).mockResolvedValue(mockCandles);

      const result = await fetchService.fetchWorkItem(mockWorkItem);

      expect(result.success).toBe(true);
      expect(result.candlesFetched).toBe(1);
      expect(result.skipped).toBe(false);
      expect(fetchBirdeyeCandles).toHaveBeenCalled();
    });

    it('should handle API errors gracefully', async () => {
      vi.mocked(getCoverage).mockResolvedValue({
        hasData: false,
        coverageRatio: 0,
        candleCount: 0,
      });

      vi.mocked(fetchBirdeyeCandles).mockRejectedValue(new Error('API error'));

      const result = await fetchService.fetchWorkItem(mockWorkItem);

      expect(result.success).toBe(false);
      expect(result.candles).toEqual([]);
      expect(result.candlesFetched).toBe(0);
      expect(result.error).toBe('API error');
    });

    it('should open circuit breaker after threshold failures', async () => {
      const threshold = 10;
      fetchService = new OhlcvBirdeyeFetch({
        circuitBreakerThreshold: threshold,
        checkCoverage: false, // Disable coverage check for this test
      });

      vi.mocked(fetchBirdeyeCandles).mockRejectedValue(new Error('API error'));

      // Trigger failures up to threshold
      for (let i = 0; i < threshold; i++) {
        await fetchService.fetchWorkItem(mockWorkItem);
      }

      // Next call should be blocked by circuit breaker
      const result = await fetchService.fetchWorkItem(mockWorkItem);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Circuit breaker open');
      expect(fetchBirdeyeCandles).toHaveBeenCalledTimes(threshold);
    });

    it('should reset circuit breaker on success', async () => {
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

      // Success should reset counter
      vi.mocked(fetchBirdeyeCandles).mockResolvedValue(mockCandles);
      const successResult = await fetchService.fetchWorkItem(mockWorkItem);

      expect(successResult.success).toBe(true);
      expect(fetchService.getCircuitBreakerState().failureCount).toBe(0);
    });

    it('should handle empty candle response', async () => {
      vi.mocked(getCoverage).mockResolvedValue({
        hasData: false,
        coverageRatio: 0,
        candleCount: 0,
      });

      vi.mocked(fetchBirdeyeCandles).mockResolvedValue([]);

      const result = await fetchService.fetchWorkItem(mockWorkItem);

      // Empty response is treated as failure (invalid token or no data available)
      // This is intentional - empty array means no data, not success
      expect(result.success).toBe(false);
      expect(result.candles).toEqual([]);
      expect(result.candlesFetched).toBe(0);
      expect(result.skipped).toBe(false);
      expect(result.error).toContain('No candles returned');
    });
  });

  describe('fetchWorkList', () => {
    it('should process multiple work items', async () => {
      const workItems: OhlcvWorkItem[] = [
        mockWorkItem,
        {
          ...mockWorkItem,
          mint: '8pXs123456789012345678901234567890pump',
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

      const results = await fetchService.fetchWorkList(workItems);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(fetchBirdeyeCandles).toHaveBeenCalledTimes(2);
    });

    it('should apply rate limiting between requests', async () => {
      const workItems: OhlcvWorkItem[] = [mockWorkItem, { ...mockWorkItem, mint: '9pXs...' }];
      const rateLimitMs = 50;
      fetchService = new OhlcvBirdeyeFetch({ rateLimitMs, checkCoverage: false });

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

      const startTime = Date.now();
      await fetchService.fetchWorkList(workItems);
      const duration = Date.now() - startTime;

      // Should have at least one rate limit delay
      expect(duration).toBeGreaterThanOrEqual(rateLimitMs);
    });

    it('should handle mixed success and failure', async () => {
      const workItems: OhlcvWorkItem[] = [mockWorkItem, { ...mockWorkItem, mint: '10pXs...' }];

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

      vi.mocked(fetchBirdeyeCandles)
        .mockResolvedValueOnce(mockCandles)
        .mockRejectedValueOnce(new Error('API error'));

      const results = await fetchService.fetchWorkList(workItems);

      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(false);
      expect(results[1].error).toBe('API error');
    });
  });

  describe('circuit breaker', () => {
    it('should reset circuit breaker manually', () => {
      fetchService.resetCircuitBreaker();
      const state = fetchService.getCircuitBreakerState();
      expect(state.failureCount).toBe(0);
      expect(state.isOpen).toBe(false);
    });

    it('should report circuit breaker state correctly', () => {
      const state = fetchService.getCircuitBreakerState();
      expect(state).toHaveProperty('failureCount');
      expect(state).toHaveProperty('threshold');
      expect(state).toHaveProperty('isOpen');
    });
  });
});

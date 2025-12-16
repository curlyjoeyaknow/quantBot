/**
 * Tests for historical-candles.ts
 *
 * Tests cover:
 * - Historical candle fetching
 * - Time range calculation
 * - Error handling
 * - Mint address preservation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DateTime } from 'luxon';
import type { Candle } from '@quantbot/core';

// Create the mock function using vi.hoisted to ensure it's available before imports
const mockFetchHybridCandles = vi.hoisted(() => vi.fn());

// Mock storage module that fetchHybridCandles depends on
vi.mock('@quantbot/storage', () => ({
  queryCandles: vi.fn().mockResolvedValue([]),
  insertCandles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@quantbot/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock the candles module
vi.mock('../src/candles', () => ({
  fetchHybridCandles: mockFetchHybridCandles,
}));

// Import modules after mocks are set up
import { fetchHistoricalCandlesForMonitoring } from '../src/historical-candles';

describe('fetchHistoricalCandlesForMonitoring', () => {
  const FULL_MINT = '7pXs123456789012345678901234567890pump';
  const FULL_MINT_LOWERCASE = '7pxs123456789012345678901234567890pump';

  beforeEach(async () => {
    vi.clearAllMocks();
    // Clear the hoisted mock
    mockFetchHybridCandles.mockClear();
    // Set USE_CACHE_ONLY to prevent fetchHybridCandles from trying to use ClickHouse
    process.env.USE_CACHE_ONLY = 'true';
  });

  afterEach(() => {
    delete process.env.USE_CACHE_ONLY;
  });

  it('should fetch historical candles for 18 days', async () => {
    const mockCandles: Candle[] = Array.from({ length: 100 }, (_, i) => ({
      timestamp: Date.now() / 1000 - i * 300, // 5m intervals
      open: 1.0,
      high: 1.1,
      low: 0.9,
      close: 1.05,
      volume: 1000,
    }));

    mockFetchHybridCandles.mockResolvedValue(mockCandles);

    const result = await fetchHistoricalCandlesForMonitoring(FULL_MINT);

    expect(mockFetchHybridCandles).toHaveBeenCalledWith(
      FULL_MINT, // Full address, case-preserved
      expect.any(DateTime),
      expect.any(DateTime),
      'solana',
      undefined
    );
    expect(result.length).toBeLessThanOrEqual(5000);
  });

  it('should preserve exact case of mint address', async () => {
    mockFetchHybridCandles.mockResolvedValue([]);

    await fetchHistoricalCandlesForMonitoring(FULL_MINT_LOWERCASE);

    expect(mockFetchHybridCandles).toHaveBeenCalledWith(
      FULL_MINT_LOWERCASE, // Exact case preserved
      expect.any(DateTime),
      expect.any(DateTime),
      'solana',
      undefined
    );
  });

  it('should use alert time when provided', async () => {
    const alertTime = new Date('2024-01-15T10:30:00Z');
    mockFetchHybridCandles.mockResolvedValue([]);

    await fetchHistoricalCandlesForMonitoring(FULL_MINT, 'solana', alertTime);

    expect(mockFetchHybridCandles).toHaveBeenCalledWith(
      FULL_MINT,
      expect.any(DateTime),
      expect.any(DateTime),
      'solana',
      expect.any(DateTime)
    );
  });

  it('should limit results to 5000 candles', async () => {
    const mockCandles: Candle[] = Array.from({ length: 10000 }, (_, i) => ({
      timestamp: Date.now() / 1000 - i * 300,
      open: 1.0,
      high: 1.1,
      low: 0.9,
      close: 1.05,
      volume: 1000,
    }));

    mockFetchHybridCandles.mockResolvedValue(mockCandles);

    const result = await fetchHistoricalCandlesForMonitoring(FULL_MINT);

    expect(result.length).toBe(5000);
  });

  it('should handle errors gracefully', async () => {
    mockFetchHybridCandles.mockRejectedValue(new Error('API error'));

    const result = await fetchHistoricalCandlesForMonitoring(FULL_MINT);

    expect(result).toEqual([]);
  });

  it('should use custom chain when provided', async () => {
    mockFetchHybridCandles.mockResolvedValue([]);

    await fetchHistoricalCandlesForMonitoring(FULL_MINT, 'ethereum');

    expect(mockFetchHybridCandles).toHaveBeenCalledWith(
      FULL_MINT,
      expect.any(DateTime),
      expect.any(DateTime),
      'ethereum',
      undefined
    );
  });
});

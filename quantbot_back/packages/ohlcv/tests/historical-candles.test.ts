/**
 * Tests for historical-candles.ts (Offline-Only)
 *
 * Tests cover:
 * - Historical candle fetching from ClickHouse (offline)
 * - Time range calculation
 * - Error handling
 * - Mint address preservation
 * - 5000 candle limit
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import type { Candle } from '@quantbot/core';

// Create hoisted mocks
const mockGetCandles = vi.hoisted(() => vi.fn());
const mockGetStorageEngine = vi.hoisted(() =>
  vi.fn(() => ({
    getCandles: mockGetCandles,
  }))
);

vi.mock('@quantbot/storage', () => ({
  getStorageEngine: mockGetStorageEngine,
}));

vi.mock('@quantbot/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Import modules after mocks are set up
import { fetchHistoricalCandlesForMonitoring } from '../src/historical-candles';

describe('fetchHistoricalCandlesForMonitoring', () => {
  const FULL_MINT = '7pXs123456789012345678901234567890pump';
  const FULL_MINT_LOWERCASE = '7pxs123456789012345678901234567890pump';

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCandles.mockClear();
  });

  it('should fetch historical candles for 18 days from ClickHouse', async () => {
    const mockCandles: Candle[] = Array.from({ length: 100 }, (_, i) => ({
      timestamp: Date.now() / 1000 - i * 300, // 5m intervals
      open: 1.0,
      high: 1.1,
      low: 0.9,
      close: 1.05,
      volume: 1000,
    }));

    mockGetCandles.mockResolvedValue(mockCandles);

    const result = await fetchHistoricalCandlesForMonitoring(FULL_MINT);

    // Verify storage engine was called with correct parameters
    expect(mockGetStorageEngine).toHaveBeenCalled();
    expect(mockGetCandles).toHaveBeenCalledWith(
      FULL_MINT, // Full address, case-preserved
      'solana',
      expect.any(DateTime), // startTime (18 days ago)
      expect.any(DateTime), // endTime (now)
      { interval: '5m' }
    );
    expect(result.length).toBe(100); // All candles returned (less than 5000 limit)
  });

  it('should preserve exact case of mint address', async () => {
    mockGetCandles.mockResolvedValue([]);

    await fetchHistoricalCandlesForMonitoring(FULL_MINT_LOWERCASE);

    expect(mockGetCandles).toHaveBeenCalledWith(
      FULL_MINT_LOWERCASE, // Exact case preserved
      'solana',
      expect.any(DateTime),
      expect.any(DateTime),
      { interval: '5m' }
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

    mockGetCandles.mockResolvedValue(mockCandles);

    const result = await fetchHistoricalCandlesForMonitoring(FULL_MINT);

    expect(result.length).toBe(5000); // Limited to 5000
  });

  it('should handle errors gracefully', async () => {
    mockGetCandles.mockRejectedValue(new Error('ClickHouse error'));

    const result = await fetchHistoricalCandlesForMonitoring(FULL_MINT);

    expect(result).toEqual([]);
  });

  it('should use custom chain when provided', async () => {
    mockGetCandles.mockResolvedValue([]);

    await fetchHistoricalCandlesForMonitoring(FULL_MINT, 'ethereum');

    expect(mockGetCandles).toHaveBeenCalledWith(
      FULL_MINT,
      'ethereum',
      expect.any(DateTime),
      expect.any(DateTime),
      { interval: '5m' }
    );
  });
});

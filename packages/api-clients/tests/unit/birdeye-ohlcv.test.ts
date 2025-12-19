/**
 * Tests for birdeye-ohlcv.ts
 *
 * Tests cover:
 * - fetchBirdeyeCandles with chunking
 * - fetchBirdeyeCandlesDirect
 * - Conversion from BirdeyeOHLCVResponse to Candle[]
 * - Error handling
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchBirdeyeCandles, fetchBirdeyeCandlesDirect } from '../../src/birdeye-ohlcv';
import { BirdeyeClient, type BirdeyeOHLCVResponse } from '../../src/birdeye-client';
import type { Candle } from '@quantbot/core';

// Mock utils
vi.mock('@quantbot/utils', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock observability
vi.mock('@quantbot/observability', () => ({
  recordApiUsage: vi.fn().mockResolvedValue(undefined),
}));

// Mock birdeye-client
vi.mock('../../src/birdeye-client', async () => {
  const actual = await vi.importActual('../../src/birdeye-client');
  return {
    ...actual,
    getBirdeyeClient: vi.fn(),
  };
});

describe('birdeye-ohlcv', () => {
  let mockClient: Partial<BirdeyeClient>;
  let mockFetchOHLCVData: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockFetchOHLCVData = vi.fn();
    mockClient = {
      fetchOHLCVData: mockFetchOHLCVData,
    };

    const { getBirdeyeClient } = await import('../../src/birdeye-client');
    vi.mocked(getBirdeyeClient).mockReturnValue(mockClient as BirdeyeClient);
  });

  describe('fetchBirdeyeCandles', () => {
    const mint = 'So11111111111111111111111111111111111111112';
    const from = 1704067200; // 2024-01-01 00:00:00 UTC
    const to = 1704153600; // 2024-01-02 00:00:00 UTC (86400 seconds = 1440 minutes)

    it('should fetch and convert candles for single request', async () => {
      const mockResponse: BirdeyeOHLCVResponse = {
        items: [
          {
            unixTime: 1704067200,
            open: 1.0,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 1000,
          },
          {
            unixTime: 1704067260,
            open: 1.05,
            high: 1.15,
            low: 1.0,
            close: 1.1,
            volume: 1200,
          },
        ],
      };

      mockFetchOHLCVData.mockResolvedValue(mockResponse);

      const candles = await fetchBirdeyeCandles(mint, '1m', from, to, 'solana');

      expect(candles).toHaveLength(2);
      expect(candles[0]).toEqual({
        timestamp: 1704067200,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.05,
        volume: 1000,
      });
      expect(mockFetchOHLCVData).toHaveBeenCalledTimes(1);
    });

    it('should handle chunking for large requests (>5000 candles)', async () => {
      // Request for 10000 minutes (10000 candles at 1m interval)
      const largeTo = from + 10000 * 60; // 10000 minutes later

      // Mock responses for chunks
      const chunk1Response: BirdeyeOHLCVResponse = {
        items: Array.from({ length: 5000 }, (_, i) => ({
          unixTime: from + i * 60,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        })),
      };

      const chunk2Response: BirdeyeOHLCVResponse = {
        items: Array.from({ length: 5000 }, (_, i) => ({
          unixTime: from + (5000 + i) * 60,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        })),
      };

      mockFetchOHLCVData
        .mockResolvedValueOnce(chunk1Response)
        .mockResolvedValueOnce(chunk2Response);

      const candles = await fetchBirdeyeCandles(mint, '1m', from, largeTo, 'solana');

      expect(candles).toHaveLength(10000);
      expect(mockFetchOHLCVData).toHaveBeenCalledTimes(2);
    });

    it('should handle empty response', async () => {
      mockFetchOHLCVData.mockResolvedValue(null);

      const candles = await fetchBirdeyeCandles(mint, '1m', from, to, 'solana');

      expect(candles).toHaveLength(0);
    });

    it('should sort candles by timestamp', async () => {
      const mockResponse: BirdeyeOHLCVResponse = {
        items: [
          {
            unixTime: 1704153600, // Later timestamp
            open: 1.0,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 1000,
          },
          {
            unixTime: 1704067200, // Earlier timestamp
            open: 1.05,
            high: 1.15,
            low: 1.0,
            close: 1.1,
            volume: 1200,
          },
        ],
      };

      mockFetchOHLCVData.mockResolvedValue(mockResponse);

      const candles = await fetchBirdeyeCandles(mint, '1m', from, to, 'solana');

      expect(candles[0].timestamp).toBeLessThan(candles[1].timestamp);
    });

    it('should deduplicate candles by timestamp when chunking', async () => {
      const largeTo = from + 10000 * 60;

      // First chunk
      const chunk1Response: BirdeyeOHLCVResponse = {
        items: Array.from({ length: 5000 }, (_, i) => ({
          unixTime: from + i * 60,
          open: 1.0,
          high: 1.1,
          low: 0.9,
          close: 1.05,
          volume: 1000,
        })),
      };

      // Second chunk with overlap (last candle from chunk1)
      const chunk2Response: BirdeyeOHLCVResponse = {
        items: [
          {
            unixTime: from + 4999 * 60, // Duplicate of last from chunk1
            open: 1.0,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 1000,
          },
          ...Array.from({ length: 4999 }, (_, i) => ({
            unixTime: from + (5000 + i) * 60,
            open: 1.0,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 1000,
          })),
        ],
      };

      mockFetchOHLCVData
        .mockResolvedValueOnce(chunk1Response)
        .mockResolvedValueOnce(chunk2Response);

      const candles = await fetchBirdeyeCandles(mint, '1m', from, largeTo, 'solana');

      // Should have 9999 unique candles (not 10000 due to deduplication)
      expect(candles).toHaveLength(9999);
      const timestamps = new Set(candles.map((c) => c.timestamp));
      expect(timestamps.size).toBe(9999); // All unique
    });

    it('should support 1m interval', async () => {
      const mockResponse: BirdeyeOHLCVResponse = {
        items: [
          {
            unixTime: from,
            open: 1.0,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 1000,
          },
        ],
      };

      mockFetchOHLCVData.mockResolvedValue(mockResponse);
      const candles = await fetchBirdeyeCandles(mint, '1m', from, to, 'solana');
      expect(candles).toHaveLength(1);
      expect(mockFetchOHLCVData).toHaveBeenCalledTimes(1);
    });

    it('should support 5m interval', async () => {
      const mockResponse: BirdeyeOHLCVResponse = {
        items: [
          {
            unixTime: from,
            open: 1.0,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 1000,
          },
        ],
      };

      mockFetchOHLCVData.mockResolvedValue(mockResponse);
      const candles = await fetchBirdeyeCandles(mint, '5m', from, to, 'solana');
      expect(candles).toHaveLength(1);
    });
  });

  describe('fetchBirdeyeCandlesDirect', () => {
    it('should be an alias for fetchBirdeyeCandles', async () => {
      const mint = 'So11111111111111111111111111111111111111112';
      const from = 1704067200;
      const to = 1704153600;

      const mockResponse: BirdeyeOHLCVResponse = {
        items: [
          {
            unixTime: from,
            open: 1.0,
            high: 1.1,
            low: 0.9,
            close: 1.05,
            volume: 1000,
          },
        ],
      };

      mockFetchOHLCVData.mockResolvedValue(mockResponse);

      const candles = await fetchBirdeyeCandlesDirect(mint, '1m', from, to, 'solana');

      expect(candles).toHaveLength(1);
      expect(mockFetchOHLCVData).toHaveBeenCalledTimes(1);
    });
  });
});


/**
 * Golden Tests for Birdeye API Chunking
 * ======================================
 *
 * Known-answer tests for automatic chunking behavior.
 * Verifies that large requests are correctly chunked into 5000-candle windows.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BirdeyeOHLCVResponse } from '../../src/birdeye-client.js';

// Mock must be hoisted before imports
class MockBirdeyeClient {
  async fetchOHLCVData(
    _tokenAddress: string,
    startTime: Date,
    endTime: Date,
    interval: string,
    _chain: string = 'solana'
  ): Promise<BirdeyeOHLCVResponse | null> {
    // Calculate candles in this chunk
    const intervalSeconds =
      interval === '15s' ? 15 : interval === '1m' ? 60 : interval === '5m' ? 300 : 3600;
    const durationSeconds = Math.floor((endTime.getTime() - startTime.getTime()) / 1000);
    const candleCount = Math.min(Math.floor(durationSeconds / intervalSeconds), 5000);

    // Generate mock candles
    const items = Array.from({ length: candleCount }, (_, i) => ({
      unixTime: Math.floor(startTime.getTime() / 1000) + i * intervalSeconds,
      open: 1.0,
      high: 1.1,
      low: 0.9,
      close: 1.0,
      volume: 1000,
    }));

    // BirdeyeOHLCVResponse has items directly, not nested in data
    return {
      items: items.length > 0 ? items : [],
    } as BirdeyeOHLCVResponse;
  }
}

vi.mock('../../src/birdeye-client.js', () => ({
  BirdeyeClient: vi.fn(),
  getBirdeyeClient: () => new MockBirdeyeClient(),
}));

import { fetchBirdeyeCandles } from '../../src/birdeye-ohlcv.js';

describe('Birdeye API Chunking - Golden Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Automatic Chunking', () => {
    it('GOLDEN: should chunk requests exceeding 5000 candles', async () => {
      const mint = 'So11111111111111111111111111111111111111112';
      const interval = '1m';
      // Request 10000 candles (2 chunks of 5000)
      const from = 1704067200; // 2024-01-01 00:00:00 UTC
      const to = from + 10000 * 60; // 10000 minutes later

      const candles = await fetchBirdeyeCandles(mint, interval, from, to, 'solana');

      // Should return all 10000 candles
      expect(candles.length).toBe(10000);
      // Should be sorted by timestamp
      for (let i = 1; i < candles.length; i++) {
        expect(candles[i]!.timestamp).toBeGreaterThanOrEqual(candles[i - 1]!.timestamp);
      }
    });

    it('GOLDEN: should not chunk requests <= 5000 candles', async () => {
      const mint = 'So11111111111111111111111111111111111111112';
      const interval = '1m';
      // Request 1000 candles (single request)
      const from = 1704067200;
      const to = from + 1000 * 60; // 1000 minutes

      const candles = await fetchBirdeyeCandles(mint, interval, from, to, 'solana');

      // Should return all 1000 candles in one request
      expect(candles.length).toBe(1000);
    });

    it('GOLDEN: should handle 5-minute interval chunking correctly', async () => {
      const mint = 'So11111111111111111111111111111111111111112';
      const interval = '5m';
      // Request 6000 candles (2 chunks: 5000 + 1000)
      const from = 1704067200;
      const to = from + 6000 * 300; // 6000 five-minute periods

      const candles = await fetchBirdeyeCandles(mint, interval, from, to, 'solana');

      // Should return all 6000 candles
      expect(candles.length).toBe(6000);
      // Verify 5-minute spacing
      for (let i = 1; i < candles.length; i++) {
        expect(candles[i]!.timestamp - candles[i - 1]!.timestamp).toBe(300); // 5 minutes
      }
    });

    it('GOLDEN: should deduplicate candles across chunks', async () => {
      const mint = 'So11111111111111111111111111111111111111112';
      const interval = '1m';
      // Request overlapping chunks
      const from = 1704067200;
      const to = from + 10000 * 60;

      const candles = await fetchBirdeyeCandles(mint, interval, from, to, 'solana');

      // Verify no duplicates (each timestamp appears once)
      const timestamps = new Set(candles.map((c) => c.timestamp));
      expect(timestamps.size).toBe(candles.length);
    });

    it('GOLDEN: should return empty array for invalid token', async () => {
      const mint = 'InvalidTokenAddress';
      const interval = '1m';
      const from = 1704067200;
      const to = from + 100 * 60;

      // Mock client to return null (invalid token)
      const { getBirdeyeClient } = await import('../../src/birdeye-client.js');
      const client = getBirdeyeClient();
      vi.spyOn(client, 'fetchOHLCVData').mockResolvedValue(null);

      const candles = await fetchBirdeyeCandles(mint, interval, from, to, 'solana', client);

      expect(candles).toEqual([]);
    });
  });
});

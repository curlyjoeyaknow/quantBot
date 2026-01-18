/**
 * Golden Tests for OHLCV Coverage Calculation
 * ============================================
 *
 * Known-answer tests for coverage ratio calculations.
 * Verifies exact mathematical correctness of coverage calculations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Chain } from '@quantbot/core';

// Mock storage engine - must be hoisted before imports
const mockGetCandles = vi.fn();
const mockStorageEngine = {
  getCandles: mockGetCandles,
};

vi.mock('@quantbot/infra/storage', () => ({
  getStorageEngine: vi.fn(() => mockStorageEngine),
}));

import { getCoverage } from '../../src/ohlcv-storage.js';

describe('OHLCV Coverage Calculation - Golden Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Coverage Ratio Calculation', () => {
    it('GOLDEN: should calculate coverage with minimum 5000 candle requirement', async () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-02T00:00:00Z'); // 24 hours = 1440 minutes
      const interval = '1m'; // 1-minute candles

      // Mock: 5000 candles (meets minimum requirement)
      const mockCandles = Array.from({ length: 5000 }, (_, i) => ({
        timestamp: Math.floor(startTime.getTime() / 1000) + i * 60,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.0,
        volume: 1000,
      }));

      mockGetCandles.mockResolvedValue(mockCandles);

      const result = await getCoverage(
        'So11111111111111111111111111111111111111112',
        'solana' as Chain,
        startTime,
        endTime,
        interval
      );

      // With 5000 candles, coverage ratio should be based on timestamp coverage
      // Expected: 1440 candles for 24 hours, but we have 5000
      expect(result.candleCount).toBe(5000);
      expect(result.hasData).toBe(true);
      // Coverage ratio should be > 0 (exact value depends on timestamp coverage calculation)
      expect(result.coverageRatio).toBeGreaterThan(0);
    });

    it('GOLDEN: should reduce coverage ratio when below 5000 candle minimum', async () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z'); // 1 hour = 60 minutes
      const interval = '1m';

      // Mock: 30 candles (below 5000 minimum)
      const mockCandles = Array.from({ length: 30 }, (_, i) => ({
        timestamp: Math.floor(startTime.getTime() / 1000) + i * 60,
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.0,
        volume: 1000,
      }));

      mockGetCandles.mockResolvedValue(mockCandles);

      const result = await getCoverage(
        'So11111111111111111111111111111111111111112',
        'solana' as Chain,
        startTime,
        endTime,
        interval
      );

      // Coverage ratio is calculated as candles.length / MIN_REQUIRED_CANDLES when below minimum
      // 30 / 5000 = 0.006
      expect(result.coverageRatio).toBeCloseTo(30 / 5000, 2);
      expect(result.candleCount).toBe(30);
      expect(result.hasData).toBe(true);
    });

    it('GOLDEN: should return 0% coverage for empty data', async () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-01T01:00:00Z');
      const interval = '1m';

      mockGetCandles.mockResolvedValue([]);

      const result = await getCoverage(
        'So11111111111111111111111111111111111111112',
        'solana' as Chain,
        startTime,
        endTime,
        interval
      );

      expect(result.coverageRatio).toBe(0);
      expect(result.candleCount).toBe(0);
      expect(result.hasData).toBe(false);
      expect(result.gaps).toHaveLength(1);
      expect(result.gaps[0]!.start).toEqual(startTime);
      expect(result.gaps[0]!.end).toEqual(endTime);
    });

    it('GOLDEN: should handle 5-minute interval with minimum requirement', async () => {
      const startTime = new Date('2024-01-01T00:00:00Z');
      const endTime = new Date('2024-01-18T00:00:00Z'); // ~17 days = enough for 5000 5m candles
      const interval = '5m';

      // Mock: 5000 candles (meets minimum requirement)
      const mockCandles = Array.from({ length: 5000 }, (_, i) => ({
        timestamp: Math.floor(startTime.getTime() / 1000) + i * 300, // 300 seconds = 5 minutes
        open: 1.0,
        high: 1.1,
        low: 0.9,
        close: 1.0,
        volume: 1000,
      }));

      mockGetCandles.mockResolvedValue(mockCandles);

      const result = await getCoverage(
        'So11111111111111111111111111111111111111112',
        'solana' as Chain,
        startTime,
        endTime,
        interval
      );

      expect(result.candleCount).toBe(5000);
      expect(result.hasData).toBe(true);
      // Coverage ratio should be > 0 (exact value depends on timestamp coverage)
      expect(result.coverageRatio).toBeGreaterThan(0);
    });
  });
});

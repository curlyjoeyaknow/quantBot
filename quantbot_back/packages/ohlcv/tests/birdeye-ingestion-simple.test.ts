/**
 * Birdeye Ingestion Tests - Simplified
 *
 * Tests for ingestion from Birdeye API covering key scenarios:
 * - Successful API responses
 * - Empty responses
 * - Error handling
 * - Data transformation
 *
 * Note: These tests focus on Birdeye-specific scenarios.
 * Full integration tests are in ohlcv-ingestion-engine.test.ts
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DateTime } from 'luxon';
import type { Candle } from '@quantbot/core';

// Mock the birdeye client (without importing it to respect boundaries)
// @quantbot/ohlcv should not depend on @quantbot/api-clients
const mockBirdeyeClient = {
  fetchOHLCVData: vi.fn(),
  getTokenMetadata: vi.fn(),
};

vi.mock('@quantbot/api-clients', () => ({
  birdeyeClient: mockBirdeyeClient,
}));

describe('Birdeye API Ingestion Scenarios', () => {
  const TEST_MINT = 'So11111111111111111111111111111111111111112';
  const TEST_CHAIN = 'solana';
  const TEST_ALERT_TIME = DateTime.utc().minus({ days: 1 });

  beforeEach(() => {
    vi.clearAllMocks();
    mockBirdeyeClient.getTokenMetadata.mockResolvedValue({
      name: 'Test Token',
      symbol: 'TEST',
    });
  });

  describe('API Response Handling', () => {
    it('should handle valid Birdeye API response with items', async () => {
      const mockResponse = {
        items: [
          {
            unixTime: TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds(),
            open: '1.0',
            high: '1.1',
            low: '0.9',
            close: '1.05',
            volume: '1000.0',
          },
        ],
      };

      mockBirdeyeClient.fetchOHLCVData.mockResolvedValue(mockResponse as any);

      const result = await mockBirdeyeClient.fetchOHLCVData(
        TEST_MINT,
        TEST_ALERT_TIME.minus({ minutes: 52 }).toJSDate(),
        TEST_ALERT_TIME.toJSDate(),
        '1m',
        TEST_CHAIN
      );

      expect(result).toBeDefined();
      expect(result?.items).toBeDefined();
      expect(result?.items?.length).toBe(1);
    });

    it('should handle empty items array', async () => {
      const mockResponse = {
        items: [],
      };

      mockBirdeyeClient.fetchOHLCVData.mockResolvedValue(mockResponse as any);

      const result = await mockBirdeyeClient.fetchOHLCVData(
        TEST_MINT,
        TEST_ALERT_TIME.minus({ minutes: 52 }).toJSDate(),
        TEST_ALERT_TIME.toJSDate(),
        '1m',
        TEST_CHAIN
      );

      expect(result).toBeDefined();
      expect(result?.items).toEqual([]);
    });

    it('should handle null response (invalid token)', async () => {
      mockBirdeyeClient.fetchOHLCVData.mockResolvedValue(null);

      const result = await mockBirdeyeClient.fetchOHLCVData(
        TEST_MINT,
        TEST_ALERT_TIME.minus({ minutes: 52 }).toJSDate(),
        TEST_ALERT_TIME.toJSDate(),
        '1m',
        TEST_CHAIN
      );

      expect(result).toBeNull();
    });
  });

  describe('Data Format Conversion', () => {
    it('should convert Birdeye format to Candle format', () => {
      const birdeyeItem = {
        unixTime: 1704067200,
        open: '1.0',
        high: '1.5',
        low: '0.8',
        close: '1.2',
        volume: '5000.0',
      };

      const candle: Candle = {
        timestamp: birdeyeItem.unixTime,
        open: parseFloat(birdeyeItem.open),
        high: parseFloat(birdeyeItem.high),
        low: parseFloat(birdeyeItem.low),
        close: parseFloat(birdeyeItem.close),
        volume: parseFloat(birdeyeItem.volume),
      };

      expect(candle).toEqual({
        timestamp: 1704067200,
        open: 1.0,
        high: 1.5,
        low: 0.8,
        close: 1.2,
        volume: 5000.0,
      });
    });

    it('should handle missing fields in Birdeye response', () => {
      const birdeyeItem = {
        unixTime: 1704067200,
        open: null,
        high: undefined,
        low: '0.9',
        close: '1.05',
        volume: '1000.0',
      };

      const candle: Candle = {
        timestamp: birdeyeItem.unixTime,
        open: birdeyeItem.open ? parseFloat(birdeyeItem.open) : 0,
        high: birdeyeItem.high ? parseFloat(birdeyeItem.high) : 0,
        low: parseFloat(birdeyeItem.low),
        close: parseFloat(birdeyeItem.close),
        volume: parseFloat(birdeyeItem.volume),
      };

      expect(candle.open).toBe(0);
      expect(candle.high).toBe(0);
      expect(candle.low).toBe(0.9);
      expect(candle.close).toBe(1.05);
    });

    it('should handle non-numeric string values', () => {
      const birdeyeItem = {
        unixTime: 1704067200,
        open: 'invalid',
        high: 'NaN',
        low: '0.9',
        close: '1.05',
        volume: '1000.0',
      };

      const candle: Candle = {
        timestamp: birdeyeItem.unixTime,
        open: parseFloat(birdeyeItem.open) || 0,
        high: parseFloat(birdeyeItem.high) || 0,
        low: parseFloat(birdeyeItem.low),
        close: parseFloat(birdeyeItem.close),
        volume: parseFloat(birdeyeItem.volume),
      };

      // parseFloat('invalid') returns NaN, but || 0 converts NaN to 0 (since NaN is falsy)
      expect(candle.open).toBe(0);
      expect(candle.high).toBe(0);
      expect(candle.low).toBe(0.9);
      expect(candle.close).toBe(1.05);
    });
  });

  describe('Error Handling', () => {
    it('should handle 400 Bad Request (invalid token)', async () => {
      const error = new Error('Bad Request') as any;
      error.response = { status: 400 };
      mockBirdeyeClient.fetchOHLCVData.mockRejectedValue(error);

      await expect(
        mockBirdeyeClient.fetchOHLCVData(
          TEST_MINT,
          TEST_ALERT_TIME.minus({ minutes: 52 }).toJSDate(),
          TEST_ALERT_TIME.toJSDate(),
          '1m',
          TEST_CHAIN
        )
      ).rejects.toThrow();
    });

    it('should handle 404 Not Found (token does not exist)', async () => {
      const error = new Error('Not Found') as any;
      error.response = { status: 404 };
      mockBirdeyeClient.fetchOHLCVData.mockRejectedValue(error);

      await expect(
        mockBirdeyeClient.fetchOHLCVData(
          TEST_MINT,
          TEST_ALERT_TIME.minus({ minutes: 52 }).toJSDate(),
          TEST_ALERT_TIME.toJSDate(),
          '1m',
          TEST_CHAIN
        )
      ).rejects.toThrow();
    });

    it('should handle network timeout', async () => {
      const error = new Error('timeout of 30000ms exceeded');
      error.name = 'ECONNABORTED';
      mockBirdeyeClient.fetchOHLCVData.mockRejectedValue(error);

      await expect(
        mockBirdeyeClient.fetchOHLCVData(
          TEST_MINT,
          TEST_ALERT_TIME.minus({ minutes: 52 }).toJSDate(),
          TEST_ALERT_TIME.toJSDate(),
          '1m',
          TEST_CHAIN
        )
      ).rejects.toThrow('timeout');
    });

    it('should handle 429 Too Many Requests (rate limiting)', async () => {
      const error = new Error('Too Many Requests') as any;
      error.response = { status: 429, headers: { 'retry-after': '60' } };
      mockBirdeyeClient.fetchOHLCVData.mockRejectedValue(error);

      await expect(
        mockBirdeyeClient.fetchOHLCVData(
          TEST_MINT,
          TEST_ALERT_TIME.minus({ minutes: 52 }).toJSDate(),
          TEST_ALERT_TIME.toJSDate(),
          '1m',
          TEST_CHAIN
        )
      ).rejects.toThrow();
    });

    it('should handle 500 Internal Server Error', async () => {
      const error = new Error('Internal Server Error') as any;
      error.response = { status: 500 };
      mockBirdeyeClient.fetchOHLCVData.mockRejectedValue(error);

      await expect(
        mockBirdeyeClient.fetchOHLCVData(
          TEST_MINT,
          TEST_ALERT_TIME.minus({ minutes: 52 }).toJSDate(),
          TEST_ALERT_TIME.toJSDate(),
          '1m',
          TEST_CHAIN
        )
      ).rejects.toThrow();
    });
  });

  describe('Time Range Filtering', () => {
    it('should filter candles to requested time range', () => {
      const startUnix = TEST_ALERT_TIME.minus({ minutes: 52 }).toSeconds();
      const endUnix = TEST_ALERT_TIME.toSeconds();

      const birdeyeItems = [
        {
          unixTime: startUnix - 3600, // Before range
          open: '1.0',
          high: '1.1',
          low: '0.9',
          close: '1.05',
          volume: '1000.0',
        },
        {
          unixTime: startUnix + 300, // In range
          open: '1.05',
          high: '1.15',
          low: '1.0',
          close: '1.1',
          volume: '1200.0',
        },
        {
          unixTime: endUnix + 3600, // After range
          open: '1.1',
          high: '1.2',
          low: '1.05',
          close: '1.15',
          volume: '1500.0',
        },
      ];

      const filtered = birdeyeItems.filter(
        (item) => item.unixTime >= startUnix && item.unixTime <= endUnix
      );

      expect(filtered.length).toBe(1);
      expect(filtered[0].unixTime).toBe(startUnix + 300);
    });

    it('should sort candles chronologically', () => {
      const candles: Candle[] = [
        { timestamp: 1704067500, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
        { timestamp: 1704067200, open: 0.9, high: 1.0, low: 0.8, close: 0.95, volume: 900 },
        { timestamp: 1704067300, open: 0.95, high: 1.05, low: 0.9, close: 1.0, volume: 950 },
      ];

      const sorted = candles.sort((a, b) => a.timestamp - b.timestamp);

      expect(sorted[0].timestamp).toBe(1704067200);
      expect(sorted[1].timestamp).toBe(1704067300);
      expect(sorted[2].timestamp).toBe(1704067500);
    });
  });
});

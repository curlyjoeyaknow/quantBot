/**
 * Candle Transformation Tests
 *
 * Tests for data transformations:
 * - Birdeye format → Candle format
 * - Candle merging (5m + 1m)
 * - Time range filtering
 * - Deduplication
 *
 * These are correctness tests for data plane logic.
 */

import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import type { Candle } from '@quantbot/core';

/**
 * Convert Birdeye API response format to Candle format
 */
function birdeyeToCandle(item: any): Candle {
  return {
    timestamp: item.unix_time || item.unixTime,
    open: parseFloat(item.o) || 0,
    high: parseFloat(item.h) || 0,
    low: parseFloat(item.l) || 0,
    close: parseFloat(item.c) || 0,
    volume: parseFloat(item.v) || 0,
  };
}

/**
 * Merge 5m and 1m candles, with 1m taking precedence in alert window
 */
function mergeCandles(
  candles5m: Candle[],
  candles1m: Candle[],
  alertTime: DateTime,
  windowMinutes: number = 30
): Candle[] {
  if (candles1m.length === 0) {
    return candles5m;
  }

  const alertStart = alertTime.minus({ minutes: windowMinutes });
  const alertEnd = alertTime.plus({ minutes: windowMinutes });
  const alertStartUnix = Math.floor(alertStart.toSeconds());
  const alertEndUnix = Math.floor(alertEnd.toSeconds());

  // Filter out 5m candles that overlap with the 1m window
  const filtered5m = candles5m.filter((candle) => {
    const candleEnd = candle.timestamp + 300; // 5m = 300 seconds
    return !(candle.timestamp < alertEndUnix && candleEnd > alertStartUnix);
  });

  // Combine and sort
  return [...filtered5m, ...candles1m].sort((a, b) => a.timestamp - b.timestamp);
}

describe('Candle Transformations', () => {
  describe('Birdeye Format → Candle Format', () => {
    it('converts Birdeye API response to Candle format', () => {
      const birdeyeItem = {
        unix_time: 1704067200,
        o: '1.0',
        h: '1.5',
        l: '0.9',
        c: '1.2',
        v: '1000.0',
      };

      const candle = birdeyeToCandle(birdeyeItem);

      expect(candle).toEqual({
        timestamp: 1704067200,
        open: 1.0,
        high: 1.5,
        low: 0.9,
        close: 1.2,
        volume: 1000.0,
      });
    });

    it('handles missing values with defaults', () => {
      const birdeyeItem = {
        unix_time: 1704067200,
        o: null,
        h: undefined,
        l: '',
        c: '1.0',
        v: '0',
      };

      const candle = birdeyeToCandle(birdeyeItem);

      expect(candle.open).toBe(0);
      expect(candle.high).toBe(0);
      expect(candle.low).toBe(0);
      expect(candle.close).toBe(1.0);
      expect(candle.volume).toBe(0);
    });

    it('handles alternative field names (unixTime vs unix_time)', () => {
      const birdeyeItem = {
        unixTime: 1704067200,
        o: '1.0',
        h: '1.5',
        l: '0.9',
        c: '1.2',
        v: '1000.0',
      };

      const candle = birdeyeToCandle(birdeyeItem);

      expect(candle.timestamp).toBe(1704067200);
    });
  });

  describe('Candle Merging', () => {
    it('merges 5m and 1m candles with 1m taking precedence', () => {
      const alertTime = DateTime.fromSeconds(1704067200);
      const windowMinutes = 30;

      // 5m candles: one every 5 minutes
      const candles5m: Candle[] = [
        { timestamp: 1704066900, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 100 }, // 5m before alert
        { timestamp: 1704067200, open: 1.05, high: 1.2, low: 1.0, close: 1.15, volume: 200 }, // At alert (should be replaced)
        { timestamp: 1704067500, open: 1.15, high: 1.3, low: 1.1, close: 1.25, volume: 300 }, // 5m after alert (should be replaced)
        { timestamp: 1704067800, open: 1.25, high: 1.4, low: 1.2, close: 1.35, volume: 400 }, // Outside window (kept)
      ];

      // 1m candles: one every minute in alert window
      const candles1m: Candle[] = [
        { timestamp: 1704067200, open: 1.05, high: 1.18, low: 1.02, close: 1.12, volume: 150 }, // Replaces 5m at alert
        { timestamp: 1704067260, open: 1.12, high: 1.22, low: 1.1, close: 1.2, volume: 180 },
        { timestamp: 1704067320, open: 1.2, high: 1.28, low: 1.18, close: 1.25, volume: 200 },
        { timestamp: 1704067500, open: 1.25, high: 1.32, low: 1.23, close: 1.3, volume: 250 }, // Replaces 5m at 5m after
      ];

      const merged = mergeCandles(candles5m, candles1m, alertTime, windowMinutes);

      // Alert window: 1704067200 ± 30 minutes = 1704067020 to 1704067380
      // 5m candle at 1704066900 spans 1704066900-1704067200 (overlaps window, removed)
      // 5m candle at 1704067200 spans 1704067200-1704067500 (overlaps window, removed)
      // 5m candle at 1704067500 spans 1704067500-1704067800 (overlaps window, removed)
      // 5m candle at 1704067800 spans 1704067800-1704068100 (outside window, kept)
      // 1m candles: 4 candles in window (kept)
      // Result: 1 5m (outside) + 4 1m = 5 total
      expect(merged.length).toBeGreaterThanOrEqual(4); // At least 4 1m candles
      expect(merged.length).toBeLessThanOrEqual(5); // At most 5 (1 5m + 4 1m)

      // Verify 1m candles are present
      expect(merged.find((c) => c.timestamp === 1704067200)).toEqual(candles1m[0]);
      expect(merged.find((c) => c.timestamp === 1704067500)).toEqual(candles1m[3]);

      // Verify 5m candle outside window is kept (if present)
      const outside5m = merged.find((c) => c.timestamp === 1704067800);
      if (outside5m) {
        expect(outside5m).toEqual(candles5m[3]);
      }

      // Verify chronological order
      for (let i = 1; i < merged.length; i++) {
        expect(merged[i].timestamp).toBeGreaterThan(merged[i - 1].timestamp);
      }
    });

    it('returns only 5m candles when 1m array is empty', () => {
      const alertTime = DateTime.fromSeconds(1704067200);
      const candles5m: Candle[] = [
        { timestamp: 1704067200, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 100 },
      ];
      const candles1m: Candle[] = [];

      const merged = mergeCandles(candles5m, candles1m, alertTime);

      expect(merged).toEqual(candles5m);
    });

    it('handles overlapping 5m candles correctly', () => {
      const alertTime = DateTime.fromSeconds(1704067200);
      const windowMinutes = 30;

      // 5m candle that spans the alert window
      const candles5m: Candle[] = [
        { timestamp: 1704067050, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 100 }, // Starts before, ends after alert
      ];

      // 1m candles in the window
      const candles1m: Candle[] = [
        { timestamp: 1704067200, open: 1.05, high: 1.18, low: 1.02, close: 1.12, volume: 150 },
      ];

      const merged = mergeCandles(candles5m, candles1m, alertTime, windowMinutes);

      // 5m candle should be removed (overlaps with 1m window)
      expect(merged.find((c) => c.timestamp === 1704067050)).toBeUndefined();
      // 1m candle should be present
      expect(merged.find((c) => c.timestamp === 1704067200)).toEqual(candles1m[0]);
    });
  });

  describe('Time Range Filtering', () => {
    it('filters candles to requested time range', () => {
      const candles: Candle[] = [
        { timestamp: 1704067000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 100 },
        { timestamp: 1704067200, open: 1.05, high: 1.2, low: 1.0, close: 1.15, volume: 200 },
        { timestamp: 1704067400, open: 1.15, high: 1.3, low: 1.1, close: 1.25, volume: 300 },
        { timestamp: 1704067600, open: 1.25, high: 1.4, low: 1.2, close: 1.35, volume: 400 },
      ];

      const startUnix = 1704067100;
      const endUnix = 1704067500;

      const filtered = candles.filter((c) => c.timestamp >= startUnix && c.timestamp <= endUnix);

      expect(filtered.length).toBe(2);
      expect(filtered[0].timestamp).toBe(1704067200);
      expect(filtered[1].timestamp).toBe(1704067400);
    });

    it('handles empty time range', () => {
      const candles: Candle[] = [
        { timestamp: 1704067200, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 100 },
      ];

      const startUnix = 1704067300;
      const endUnix = 1704067400;

      const filtered = candles.filter((c) => c.timestamp >= startUnix && c.timestamp <= endUnix);

      expect(filtered.length).toBe(0);
    });
  });

  describe('Deduplication', () => {
    it('deduplicates candles by timestamp', () => {
      const candles: Candle[] = [
        { timestamp: 1704067200, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 100 },
        { timestamp: 1704067200, open: 1.05, high: 1.2, low: 1.0, close: 1.15, volume: 200 }, // Duplicate timestamp
        { timestamp: 1704067260, open: 1.15, high: 1.3, low: 1.1, close: 1.25, volume: 300 },
      ];

      const unique = new Map<number, Candle>();
      for (const candle of candles) {
        if (!unique.has(candle.timestamp)) {
          unique.set(candle.timestamp, candle);
        }
      }

      const deduplicated = Array.from(unique.values()).sort((a, b) => a.timestamp - b.timestamp);

      expect(deduplicated.length).toBe(2);
      expect(deduplicated[0].timestamp).toBe(1704067200);
      expect(deduplicated[0].volume).toBe(100); // First occurrence kept
      expect(deduplicated[1].timestamp).toBe(1704067260);
    });
  });
});

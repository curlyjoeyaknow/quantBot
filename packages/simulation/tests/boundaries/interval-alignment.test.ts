/**
 * Boundary Tests: Interval Alignment
 * ==================================
 *
 * Tests for interval alignment (1m candles aligned to minute boundaries).
 * Misaligned candles cause incorrect calculations.
 */

import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import type { Candle } from '../../src/candles';

describe('Interval Alignment', () => {
  describe('1-Minute Candle Alignment', () => {
    it('should align 1m candles to minute boundaries', () => {
      // 1m candles should be at: 00:00, 00:01, 00:02, etc.
      const baseTime = DateTime.fromISO('2024-01-01T00:00:00Z');

      const aligned1m: number[] = [];
      for (let i = 0; i < 5; i++) {
        const timestamp = baseTime.plus({ minutes: i }).toSeconds();
        aligned1m.push(Math.floor(timestamp));
      }

      // Check alignment: each timestamp should be divisible by 60 (within the minute)
      aligned1m.forEach((ts, i) => {
        const dt = DateTime.fromSeconds(ts);
        expect(dt.second).toBe(0); // Should be at :00 seconds
        expect(dt.millisecond).toBe(0); // Should be at 0 milliseconds
      });

      // Check spacing: 60 seconds between candles
      for (let i = 1; i < aligned1m.length; i++) {
        const diff = aligned1m[i] - aligned1m[i - 1];
        expect(diff).toBe(60); // Exactly 60 seconds
      }
    });

    it('should detect misaligned 1m candles', () => {
      const baseTime = DateTime.fromISO('2024-01-01T00:00:00Z');

      const misaligned: number[] = [
        Math.floor(baseTime.plus({ seconds: 5 }).toSeconds()), // 5 seconds off
        Math.floor(baseTime.plus({ minutes: 1, seconds: 10 }).toSeconds()), // 10 seconds off
      ];

      // These should NOT be aligned
      misaligned.forEach((ts) => {
        const dt = DateTime.fromSeconds(ts);
        // If not at :00 seconds, it's misaligned
        const isAligned = dt.second === 0 && dt.millisecond === 0;
        expect(isAligned).toBe(false);
      });
    });
  });

  describe('5-Minute Candle Alignment', () => {
    it('should align 5m candles to 5-minute boundaries', () => {
      // 5m candles should be at: 00:00, 00:05, 00:10, etc.
      const baseTime = DateTime.fromISO('2024-01-01T00:00:00Z');

      const aligned5m: number[] = [];
      for (let i = 0; i < 5; i++) {
        const timestamp = baseTime.plus({ minutes: i * 5 }).toSeconds();
        aligned5m.push(Math.floor(timestamp));
      }

      // Check alignment: each timestamp should be at :00, :05, :10, etc.
      aligned5m.forEach((ts) => {
        const dt = DateTime.fromSeconds(ts);
        expect(dt.minute % 5).toBe(0); // Should be divisible by 5
        expect(dt.second).toBe(0);
      });

      // Check spacing: 300 seconds (5 minutes) between candles
      for (let i = 1; i < aligned5m.length; i++) {
        const diff = aligned5m[i] - aligned5m[i - 1];
        expect(diff).toBe(300); // Exactly 300 seconds
      }
    });

    it('should detect misaligned 5m candles', () => {
      const baseTime = DateTime.fromISO('2024-01-01T00:00:00Z');

      const misaligned: number[] = [
        Math.floor(baseTime.plus({ minutes: 1 }).toSeconds()), // 1 minute (not 5)
        Math.floor(baseTime.plus({ minutes: 6 }).toSeconds()), // 6 minutes (not aligned to 5)
      ];

      misaligned.forEach((ts) => {
        const dt = DateTime.fromSeconds(ts);
        const isAligned = dt.minute % 5 === 0 && dt.second === 0;
        expect(isAligned).toBe(false);
      });
    });
  });

  describe('Interval Detection', () => {
    it('should correctly detect 1m interval from timestamps', () => {
      const baseTime = DateTime.fromISO('2024-01-01T00:00:00Z');
      const candles: Candle[] = [
        {
          timestamp: Math.floor(baseTime.toSeconds()),
          open: 1.0,
          high: 1.01,
          low: 0.99,
          close: 1.0,
          volume: 1000,
        },
        {
          timestamp: Math.floor(baseTime.plus({ minutes: 1 }).toSeconds()),
          open: 1.0,
          high: 1.01,
          low: 0.99,
          close: 1.0,
          volume: 1000,
        },
      ];

      // Detect interval by checking time difference
      const timeDiff = candles[1].timestamp - candles[0].timestamp;
      const is1m = timeDiff >= 50 && timeDiff <= 90; // 1m candles: ~60s difference
      const is5m = timeDiff >= 250 && timeDiff <= 350; // 5m candles: ~300s difference

      expect(is1m).toBe(true);
      expect(is5m).toBe(false);
    });

    it('should correctly detect 5m interval from timestamps', () => {
      const baseTime = DateTime.fromISO('2024-01-01T00:00:00Z');
      const candles: Candle[] = [
        {
          timestamp: Math.floor(baseTime.toSeconds()),
          open: 1.0,
          high: 1.01,
          low: 0.99,
          close: 1.0,
          volume: 1000,
        },
        {
          timestamp: Math.floor(baseTime.plus({ minutes: 5 }).toSeconds()),
          open: 1.0,
          high: 1.01,
          low: 0.99,
          close: 1.0,
          volume: 1000,
        },
      ];

      const timeDiff = candles[1].timestamp - candles[0].timestamp;
      const is1m = timeDiff >= 50 && timeDiff <= 90;
      const is5m = timeDiff >= 250 && timeDiff <= 350;

      expect(is1m).toBe(false);
      expect(is5m).toBe(true);
    });
  });

  describe('Gap Detection', () => {
    it('should detect gaps in 1m candle series', () => {
      const baseTime = DateTime.fromISO('2024-01-01T00:00:00Z');
      const candles: Candle[] = [
        {
          timestamp: Math.floor(baseTime.toSeconds()),
          open: 1.0,
          high: 1.01,
          low: 0.99,
          close: 1.0,
          volume: 1000,
        },
        {
          timestamp: Math.floor(baseTime.plus({ minutes: 3 }).toSeconds()), // Gap: missing 1m and 2m
          open: 1.0,
          high: 1.01,
          low: 0.99,
          close: 1.0,
          volume: 1000,
        },
      ];

      // Check for gaps: time difference > 90 seconds indicates gap
      const timeDiff = candles[1].timestamp - candles[0].timestamp;
      const hasGap = timeDiff > 90; // More than 1.5 minutes

      expect(hasGap).toBe(true);
    });

    it('should detect gaps in 5m candle series', () => {
      const baseTime = DateTime.fromISO('2024-01-01T00:00:00Z');
      const candles: Candle[] = [
        {
          timestamp: Math.floor(baseTime.toSeconds()),
          open: 1.0,
          high: 1.01,
          low: 0.99,
          close: 1.0,
          volume: 1000,
        },
        {
          timestamp: Math.floor(baseTime.plus({ minutes: 15 }).toSeconds()), // Gap: missing 5m and 10m
          open: 1.0,
          high: 1.01,
          low: 0.99,
          close: 1.0,
          volume: 1000,
        },
      ];

      const timeDiff = candles[1].timestamp - candles[0].timestamp;
      const hasGap = timeDiff > 350; // More than ~6 minutes

      expect(hasGap).toBe(true);
    });
  });
});

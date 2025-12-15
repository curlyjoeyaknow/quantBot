/**
 * Boundary Tests: Timestamp Windows
 * ==================================
 *
 * Tests for timestamp window inclusivity/exclusivity (off-by-one bugs).
 * These are the ugliest bugs - they silently produce wrong results.
 */

import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import type { Candle } from '../../src/candles';

describe('Timestamp Window Boundaries', () => {
  const createCandle = (timestamp: number, price: number): Candle => ({
    timestamp,
    open: price,
    high: price * 1.01,
    low: price * 0.99,
    close: price,
    volume: 1000,
  });

  describe('Inclusive vs Exclusive Boundaries', () => {
    it('should include boundary candles when using >= and <=', () => {
      const candles: Candle[] = [
        createCandle(1000, 1.0), // Start boundary
        createCandle(2000, 1.1),
        createCandle(3000, 1.2),
        createCandle(4000, 1.3), // End boundary
      ];

      const startTimestamp = 1000;
      const endTimestamp = 4000;

      // Inclusive boundaries: >= start AND <= end
      const inclusive = candles.filter(
        (c) => c.timestamp >= startTimestamp && c.timestamp <= endTimestamp
      );

      expect(inclusive.length).toBe(4); // All candles included
      expect(inclusive[0].timestamp).toBe(1000);
      expect(inclusive[inclusive.length - 1].timestamp).toBe(4000);
    });

    it('should exclude boundary candles when using > and <', () => {
      const candles: Candle[] = [
        createCandle(1000, 1.0), // Start boundary (excluded)
        createCandle(2000, 1.1),
        createCandle(3000, 1.2),
        createCandle(4000, 1.3), // End boundary (excluded)
      ];

      const startTimestamp = 1000;
      const endTimestamp = 4000;

      // Exclusive boundaries: > start AND < end
      const exclusive = candles.filter(
        (c) => c.timestamp > startTimestamp && c.timestamp < endTimestamp
      );

      expect(exclusive.length).toBe(2); // Only middle candles
      expect(exclusive[0].timestamp).toBe(2000);
      expect(exclusive[exclusive.length - 1].timestamp).toBe(3000);
    });

    it('should handle edge case: start === end with inclusive', () => {
      const candles: Candle[] = [createCandle(1000, 1.0), createCandle(2000, 1.1)];

      const startTimestamp = 1000;
      const endTimestamp = 1000; // Same as start

      const inclusive = candles.filter(
        (c) => c.timestamp >= startTimestamp && c.timestamp <= endTimestamp
      );

      expect(inclusive.length).toBe(1); // Only the boundary candle
      expect(inclusive[0].timestamp).toBe(1000);
    });

    it('should handle edge case: start === end with exclusive', () => {
      const candles: Candle[] = [createCandle(1000, 1.0), createCandle(2000, 1.1)];

      const startTimestamp = 1000;
      const endTimestamp = 1000; // Same as start

      const exclusive = candles.filter(
        (c) => c.timestamp > startTimestamp && c.timestamp < endTimestamp
      );

      expect(exclusive.length).toBe(0); // No candles (impossible condition)
    });
  });

  describe('Off-by-One Errors', () => {
    it('should catch off-by-one in window start (>= vs >)', () => {
      const candles: Candle[] = [
        createCandle(1000, 1.0),
        createCandle(2000, 1.1),
        createCandle(3000, 1.2),
      ];

      const startTimestamp = 1000;

      // Correct: >= (includes boundary)
      const correct = candles.filter((c) => c.timestamp >= startTimestamp);
      expect(correct.length).toBe(3);

      // Bug: > (excludes boundary)
      const buggy = candles.filter((c) => c.timestamp > startTimestamp);
      expect(buggy.length).toBe(2); // Missing first candle!
    });

    it('should catch off-by-one in window end (<= vs <)', () => {
      const candles: Candle[] = [
        createCandle(1000, 1.0),
        createCandle(2000, 1.1),
        createCandle(3000, 1.2),
      ];

      const endTimestamp = 3000;

      // Correct: <= (includes boundary)
      const correct = candles.filter((c) => c.timestamp <= endTimestamp);
      expect(correct.length).toBe(3);

      // Bug: < (excludes boundary)
      const buggy = candles.filter((c) => c.timestamp < endTimestamp);
      expect(buggy.length).toBe(2); // Missing last candle!
    });
  });

  describe('Candle Window Slicing', () => {
    it('should correctly slice candles for period metrics', () => {
      const candles: Candle[] = [
        createCandle(1000, 1.0), // Entry
        createCandle(2000, 1.1),
        createCandle(3000, 1.2),
        createCandle(4000, 1.3),
        createCandle(5000, 1.4), // 7 days later (7 * 86400 = 604800)
      ];

      const entryTimestamp = 1000;
      const periodDays = 7;
      const periodSeconds = periodDays * 86400;
      const endTimestamp = entryTimestamp + periodSeconds; // 1000 + 604800 = 605800

      // Get candles within period (inclusive)
      const periodCandles = candles.filter(
        (c) => c.timestamp >= entryTimestamp && c.timestamp <= endTimestamp
      );

      // Should include all candles up to endTimestamp
      expect(periodCandles.length).toBeGreaterThan(0);
      expect(periodCandles.every((c) => c.timestamp >= entryTimestamp)).toBe(true);
      expect(periodCandles.every((c) => c.timestamp <= endTimestamp)).toBe(true);
    });

    it('should handle empty window gracefully', () => {
      const candles: Candle[] = [createCandle(1000, 1.0), createCandle(2000, 1.1)];

      const startTimestamp = 5000; // After all candles
      const endTimestamp = 6000;

      const windowCandles = candles.filter(
        (c) => c.timestamp >= startTimestamp && c.timestamp <= endTimestamp
      );

      expect(windowCandles.length).toBe(0);
    });
  });
});

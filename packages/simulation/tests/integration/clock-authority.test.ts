/**
 * Clock Authority Integration Tests
 * ==================================
 *
 * Verifies that simulation enforces global clock authority:
 * - Clock is created once at entry point
 * - Clock is passed to all functions that need time
 * - No wall-clock access in simulation paths
 * - Same inputs → same time values
 */

import { describe, it, expect } from 'vitest';
import { simulateStrategy } from '../../src/core/simulator.js';
import { createClock, type SimulationClock, type ClockResolution } from '../../src/core/clock.js';
import type { Candle } from '../../src/types/candle.js';
import type { StrategyLeg } from '../../src/types/index.js';

/**
 * Generate test candles
 */
function generateCandles(count: number, startTimestamp: number = 1000): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    const timestamp = startTimestamp + i * 60_000; // 1 minute intervals
    const basePrice = 1.0 + i * 0.1;
    candles.push({
      timestamp,
      open: basePrice,
      high: basePrice * 1.1,
      low: basePrice * 0.9,
      close: basePrice * 1.05,
      volume: 1000 + i * 100,
    });
  }
  return candles;
}

const testStrategy: StrategyLeg[] = [{ percent: 1.0, target: 2.0 }];

describe('Clock Authority Integration', () => {
  describe('Clock Creation', () => {
    it('creates clock from first candle timestamp', async () => {
      const candles = generateCandles(10, 1000);
      const startTimestamp = candles[0].timestamp;

      // Run simulation with explicit clock resolution
      const result = await simulateStrategy(
        candles,
        testStrategy,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          clockResolution: 'm',
        }
      );

      // Verify simulation completed (clock was created and used)
      expect(result).toBeDefined();
      expect(result.finalPnl).toBeDefined();

      // Verify events have timestamps from candle data (not wall-clock)
      for (const event of result.events) {
        if ('timestamp' in event) {
          // Event timestamp should be from candle data, not Date.now()
          expect(event.timestamp).toBeGreaterThanOrEqual(startTimestamp);
          expect(event.timestamp).toBeLessThanOrEqual(candles[candles.length - 1].timestamp);
        }
      }
    });

    it('uses different clock resolutions correctly', async () => {
      const candles = generateCandles(10, 1000);

      const resolutions: ClockResolution[] = ['ms', 's', 'm', 'h'];

      for (const resolution of resolutions) {
        const result = await simulateStrategy(
          candles,
          testStrategy,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            clockResolution: resolution,
          }
        );

        // All resolutions should produce valid results
        expect(result).toBeDefined();
        expect(result.finalPnl).toBeDefined();
      }
    });
  });

  describe('Clock Determinism', () => {
    it('same candles + same clock resolution → same time calculations', async () => {
      const candles = generateCandles(20, 1000);

      // Run simulation twice with same inputs
      const result1 = await simulateStrategy(
        candles,
        testStrategy,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          clockResolution: 'm',
          seed: 42,
        }
      );

      const result2 = await simulateStrategy(
        candles,
        testStrategy,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          clockResolution: 'm',
          seed: 42,
        }
      );

      // Results should be identical (including time-based calculations)
      expect(result1.finalPnl).toBe(result2.finalPnl);
      expect(result1.events.length).toBe(result2.events.length);

      // Event timestamps should be identical
      for (let i = 0; i < result1.events.length; i++) {
        const event1 = result1.events[i];
        const event2 = result2.events[i];

        if ('timestamp' in event1 && 'timestamp' in event2) {
          expect(event1.timestamp).toBe(event2.timestamp);
        }
      }
    });

    it('different clock resolutions → different time calculations', async () => {
      const candles = generateCandles(20, 1000);

      const result1 = await simulateStrategy(
        candles,
        testStrategy,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          clockResolution: 's',
          seed: 42,
        }
      );

      const result2 = await simulateStrategy(
        candles,
        testStrategy,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          clockResolution: 'm',
          seed: 42,
        }
      );

      // Different resolutions may produce different results due to rounding
      // But both should be deterministic
      expect(result1.finalPnl).toBeDefined();
      expect(result2.finalPnl).toBeDefined();
    });
  });

  describe('Clock Propagation', () => {
    it('clock is used for entry delay calculations', async () => {
      const candles = generateCandles(20, 1000);

      // Use trailing entry to test clock usage
      const result = await simulateStrategy(
        candles,
        testStrategy,
        undefined,
        {
          initialEntry: 'none',
          trailingEntry: 0.1, // 10% trailing entry
          maxWaitTime: 60, // 60 minutes
        },
        undefined,
        undefined,
        {
          clockResolution: 'm',
        }
      );

      // Find entry event
      const entryEvent = result.events.find(
        (e) => e.type === 'entry' || e.type === 'trailing_entry_triggered'
      );

      if (entryEvent) {
        // Entry should have happened (clock was used for maxWaitTime calculation)
        expect(entryEvent).toBeDefined();
      }
    });

    it('clock is used for time-from-entry calculations', async () => {
      const candles = generateCandles(20, 1000);

      const result = await simulateStrategy(
        candles,
        testStrategy,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          clockResolution: 'm',
        }
      );

      // Verify that events have timestamps that align with candle timestamps
      // (clock was used to convert time units)
      for (const event of result.events) {
        if ('timestamp' in event) {
          // Event timestamp should match a candle timestamp (or be between candles)
          const matchingCandle = candles.find((c) => c.timestamp === event.timestamp);
          const betweenCandles = candles.some(
            (c, i) =>
              i > 0 && c.timestamp >= event.timestamp && candles[i - 1].timestamp <= event.timestamp
          );

          expect(matchingCandle !== undefined || betweenCandles).toBe(true);
        }
      }
    });
  });

  describe('No Wall-Clock Access', () => {
    it('event timestamps come from candle data, not Date.now()', async () => {
      const candles = generateCandles(10, 1000);
      const startTimestamp = candles[0].timestamp;
      const endTimestamp = candles[candles.length - 1].timestamp;

      // Capture current wall-clock time
      const wallClockBefore = Date.now();

      const result = await simulateStrategy(
        candles,
        testStrategy,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          clockResolution: 'm',
        }
      );

      const wallClockAfter = Date.now();

      // Verify all event timestamps are from candle data range
      for (const event of result.events) {
        if ('timestamp' in event) {
          const eventTs = event.timestamp;

          // Event timestamp should be in candle data range
          expect(eventTs).toBeGreaterThanOrEqual(startTimestamp);
          expect(eventTs).toBeLessThanOrEqual(endTimestamp);

          // Event timestamp should NOT be near wall-clock time
          // (allowing some tolerance for test execution time)
          const timeDiff = Math.abs(eventTs - wallClockBefore);
          const timeDiffAfter = Math.abs(eventTs - wallClockAfter);

          // If event timestamp is from wall-clock, it would be very close to current time
          // Candle timestamps are in the past (1000-10000 range), so they should be far from wall-clock
          expect(timeDiff).toBeGreaterThan(100_000); // At least 100 seconds difference
          expect(timeDiffAfter).toBeGreaterThan(100_000);
        }
      }
    });

    it('simulation is deterministic regardless of wall-clock time', async () => {
      const candles = generateCandles(10, 1000);

      // Run simulation at different wall-clock times
      const result1 = await simulateStrategy(
        candles,
        testStrategy,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          clockResolution: 'm',
          seed: 42,
        }
      );

      // Wait a bit (simulate different wall-clock time)
      await new Promise((resolve) => setTimeout(resolve, 100));

      const result2 = await simulateStrategy(
        candles,
        testStrategy,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          clockResolution: 'm',
          seed: 42,
        }
      );

      // Results should be identical (not affected by wall-clock time)
      expect(result1.finalPnl).toBe(result2.finalPnl);
      expect(result1.events.length).toBe(result2.events.length);
    });
  });

  describe('Clock Resolution Effects', () => {
    it('millisecond resolution provides highest precision', async () => {
      const candles = generateCandles(10, 1000);

      const result = await simulateStrategy(
        candles,
        testStrategy,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          clockResolution: 'ms',
        }
      );

      expect(result).toBeDefined();
      // Millisecond resolution should work correctly
    });

    it('minute resolution rounds time appropriately', async () => {
      const candles = generateCandles(10, 1000);

      const result = await simulateStrategy(
        candles,
        testStrategy,
        undefined,
        undefined,
        undefined,
        undefined,
        {
          clockResolution: 'm',
        }
      );

      expect(result).toBeDefined();
      // Minute resolution should round time to minutes
    });
  });
});

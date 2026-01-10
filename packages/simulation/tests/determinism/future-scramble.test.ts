/**
 * Gate 3: Future-Scramble Test
 *
 * Modify candles after time T. Assert all decisions before T are byte-identical.
 *
 * This test proves that simulations are deterministic and causal - changes to future
 * candles do not affect past decisions.
 */

import { describe, it, expect } from 'vitest';
import type { Candle } from '../../src/types/candle.js';
import { simulateStrategy, simulateStrategyWithCausalAccessor } from '../../src/core/simulator.js';
import type {
  StrategyLeg,
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  CostConfig,
} from '../../src/types/index.js';
import {
  getCandleCloseTime,
  getCandleCloseTimeFromInterval,
  CausalCandleWrapper,
  type CandleInterval,
} from '../../src/types/causal-accessor.js';

/**
 * Scramble candles after a given time
 * Modifies prices, volumes, and other fields to ensure future data is different
 */
function scrambleCandlesAfterTime(
  candles: readonly Candle[],
  splitTime: number,
  intervalSeconds: number = 300
): Candle[] {
  return candles.map((candle) => {
    const closeTime = getCandleCloseTime(candle, intervalSeconds);

    // If candle closes after split time, scramble it
    if (closeTime > splitTime) {
      return {
        ...candle,
        open: candle.open * (0.5 + Math.random()), // Random multiplier 0.5-1.5
        high: candle.high * (0.5 + Math.random()),
        low: candle.low * (0.5 + Math.random()),
        close: candle.close * (0.5 + Math.random()),
        volume: candle.volume * (0.5 + Math.random()),
      };
    }

    // Return original candle if it closes before split time
    return candle;
  });
}

/**
 * Extract simulation decisions (events) before a given time
 */
function extractDecisionsBeforeTime(
  events: Array<{ timestamp: number; [key: string]: unknown }>,
  splitTime: number
): Array<{ timestamp: number; [key: string]: unknown }> {
  return events.filter((event) => event.timestamp <= splitTime);
}

/**
 * Extract simulation decisions (events) after a given time
 */
function extractDecisionsAfterTime(
  events: Array<{ timestamp: number; [key: string]: unknown }>,
  splitTime: number
): Array<{ timestamp: number; [key: string]: unknown }> {
  return events.filter((event) => event.timestamp > splitTime);
}

/**
 * Create test candles for future-scramble test
 */
function createTestCandles(
  count: number,
  startTimestamp: number,
  intervalSeconds: number = 300
): Candle[] {
  const candles: Candle[] = [];
  let price = 100;

  for (let i = 0; i < count; i++) {
    const timestamp = startTimestamp + i * intervalSeconds;
    const priceChange = (Math.random() - 0.5) * 2; // Random price change -1 to +1
    price = price + priceChange;

    candles.push({
      timestamp,
      open: price,
      high: price + Math.abs(priceChange) * 0.5,
      low: price - Math.abs(priceChange) * 0.5,
      close: price + priceChange * 0.1,
      volume: 1000 + Math.random() * 500,
    });
  }

  return candles;
}

describe('Gate 3: Future-Scramble Test', () => {
  const baseTimestamp = 1000000000; // Fixed start time for determinism
  const intervalSeconds = 300; // 5 minute candles
  const interval: CandleInterval = '5m';

  // Simple strategy: take profit at 1.1x, stop loss at -0.2
  const strategy: StrategyLeg[] = [
    { target: 1.1, percent: 0.5 },
    { target: 1.2, percent: 0.5 },
  ];

  const stopLoss: StopLossConfig = {
    initial: -0.2,
    trailing: 'none',
  };

  const entry: EntryConfig = {
    initialEntry: 'none', // Immediate entry
    trailingEntry: 'none',
  };

  const reEntry: ReEntryConfig = {
    trailingReEntry: 'none',
    maxReEntries: 0,
  };

  const costs: CostConfig = {
    entrySlippageBps: 0,
    exitSlippageBps: 0,
    takerFeeBps: 0,
  };

  it('decisions before time T are byte-identical when candles after T are modified', async () => {
    // 1. Create test candles (enough to have a clear split point)
    const originalCandles = createTestCandles(100, baseTimestamp, intervalSeconds);

    // 2. Find a split point (middle of the candle array)
    // Use the candle's timestamp (when it starts) as split time, not close time
    // This ensures we're testing causality at the right boundary
    const splitIndex = Math.floor(originalCandles.length / 2);
    const splitCandle = originalCandles[splitIndex]!;
    // Use timestamp (candle start) as split time to test causality properly
    const splitTime = splitCandle.timestamp;

    // 3. Run simulation with original candles using causal accessor (Gate 2)
    const originalAccessor = new CausalCandleWrapper(originalCandles, interval);
    const originalResult = await simulateStrategyWithCausalAccessor(
      originalAccessor,
      'test-mint',
      baseTimestamp,
      originalCandles[originalCandles.length - 1]!.timestamp + intervalSeconds * 2, // End after last candle closes
      strategy,
      stopLoss,
      entry,
      reEntry,
      costs,
      { interval }
    );

    // 4. Scramble candles after split time
    const scrambledCandles = scrambleCandlesAfterTime(originalCandles, splitTime, intervalSeconds);

    // Verify that scrambled candles are actually different
    const hasDifference = scrambledCandles.some((candle, i) => {
      const orig = originalCandles[i]!;
      return (
        candle.open !== orig.open ||
        candle.high !== orig.high ||
        candle.low !== orig.low ||
        candle.close !== orig.close ||
        candle.volume !== orig.volume
      );
    });
    expect(hasDifference).toBe(true); // Ensure we actually scrambled something

    // 5. Run simulation with scrambled candles using causal accessor (Gate 2)
    const scrambledAccessor = new CausalCandleWrapper(scrambledCandles, interval);
    const scrambledResult = await simulateStrategyWithCausalAccessor(
      scrambledAccessor,
      'test-mint',
      baseTimestamp,
      scrambledCandles[scrambledCandles.length - 1]!.timestamp + intervalSeconds * 2,
      strategy,
      stopLoss,
      entry,
      reEntry,
      costs,
      { interval }
    );

    // 6. Extract decisions before split time from both results
    // Use close time of split candle as the boundary (events can happen during the candle)
    const splitCloseTime = getCandleCloseTime(splitCandle, intervalSeconds);
    const originalDecisionsBeforeT = extractDecisionsBeforeTime(
      originalResult.events,
      splitCloseTime
    );
    const scrambledDecisionsBeforeT = extractDecisionsBeforeTime(
      scrambledResult.events,
      splitCloseTime
    );

    // 7. Assert byte-identical (exact match)
    expect(scrambledDecisionsBeforeT).toEqual(originalDecisionsBeforeT);

    // 8. Verify that decisions after T may differ (this is expected)
    const originalDecisionsAfterT = extractDecisionsAfterTime(
      originalResult.events,
      splitCloseTime
    );
    const scrambledDecisionsAfterT = extractDecisionsAfterTime(
      scrambledResult.events,
      splitCloseTime
    );

    // These may be different (we scrambled the future)
    // The important thing is that decisions BEFORE T are identical
    // Note: If simulation ends before split time, there may be no events after T, which is fine
    // The critical assertion is that decisions BEFORE T are byte-identical (already checked above)
  });

  it('works with different split points', async () => {
    const originalCandles = createTestCandles(100, baseTimestamp, intervalSeconds);

    // Test early split (first quarter)
    const earlySplitIndex = Math.floor(originalCandles.length / 4);
    const earlySplitCandle = originalCandles[earlySplitIndex]!;
    const earlySplitTime = earlySplitCandle.timestamp;
    const earlySplitCloseTime = getCandleCloseTime(earlySplitCandle, intervalSeconds);
    const endTime = originalCandles[originalCandles.length - 1]!.timestamp + intervalSeconds * 2;

    const originalAccessor = new CausalCandleWrapper(originalCandles, interval);
    const originalResult = await simulateStrategyWithCausalAccessor(
      originalAccessor,
      'test-mint',
      baseTimestamp,
      endTime,
      strategy,
      stopLoss,
      entry,
      reEntry,
      costs,
      { interval }
    );

    const scrambledCandles = scrambleCandlesAfterTime(
      originalCandles,
      earlySplitTime,
      intervalSeconds
    );
    const scrambledAccessor = new CausalCandleWrapper(scrambledCandles, interval);
    const scrambledResult = await simulateStrategyWithCausalAccessor(
      scrambledAccessor,
      'test-mint',
      baseTimestamp,
      endTime,
      strategy,
      stopLoss,
      entry,
      reEntry,
      costs,
      { interval }
    );

    const originalDecisionsBeforeT = extractDecisionsBeforeTime(
      originalResult.events,
      earlySplitCloseTime
    );
    const scrambledDecisionsBeforeT = extractDecisionsBeforeTime(
      scrambledResult.events,
      earlySplitCloseTime
    );

    expect(scrambledDecisionsBeforeT).toEqual(originalDecisionsBeforeT);
  });

  it('works with late split points', async () => {
    const originalCandles = createTestCandles(100, baseTimestamp, intervalSeconds);

    // Test late split (third quarter)
    const lateSplitIndex = Math.floor((originalCandles.length * 3) / 4);
    const lateSplitCandle = originalCandles[lateSplitIndex]!;
    const lateSplitTime = lateSplitCandle.timestamp;
    const lateSplitCloseTime = getCandleCloseTime(lateSplitCandle, intervalSeconds);
    const endTime = originalCandles[originalCandles.length - 1]!.timestamp + intervalSeconds * 2;

    const originalAccessor = new CausalCandleWrapper(originalCandles, interval);
    const originalResult = await simulateStrategyWithCausalAccessor(
      originalAccessor,
      'test-mint',
      baseTimestamp,
      endTime,
      strategy,
      stopLoss,
      entry,
      reEntry,
      costs,
      { interval }
    );

    const scrambledCandles = scrambleCandlesAfterTime(
      originalCandles,
      lateSplitTime,
      intervalSeconds
    );
    const scrambledAccessor = new CausalCandleWrapper(scrambledCandles, interval);
    const scrambledResult = await simulateStrategyWithCausalAccessor(
      scrambledAccessor,
      'test-mint',
      baseTimestamp,
      endTime,
      strategy,
      stopLoss,
      entry,
      reEntry,
      costs,
      { interval }
    );

    const originalDecisionsBeforeT = extractDecisionsBeforeTime(
      originalResult.events,
      lateSplitCloseTime
    );
    const scrambledDecisionsBeforeT = extractDecisionsBeforeTime(
      scrambledResult.events,
      lateSplitCloseTime
    );

    expect(scrambledDecisionsBeforeT).toEqual(originalDecisionsBeforeT);
  });

  it('handles missing candles after split time', async () => {
    const originalCandles = createTestCandles(100, baseTimestamp, intervalSeconds);

    const splitIndex = Math.floor(originalCandles.length / 2);
    const splitCandle = originalCandles[splitIndex]!;
    const splitTime = splitCandle.timestamp;
    const splitCloseTime = getCandleCloseTime(splitCandle, intervalSeconds);

    // Remove all candles after split time (instead of scrambling)
    const truncatedCandles = originalCandles.slice(0, splitIndex + 1);
    const endTime = originalCandles[originalCandles.length - 1]!.timestamp + intervalSeconds * 2;

    const originalAccessor = new CausalCandleWrapper(originalCandles, interval);
    const originalResult = await simulateStrategyWithCausalAccessor(
      originalAccessor,
      'test-mint',
      baseTimestamp,
      endTime,
      strategy,
      stopLoss,
      entry,
      reEntry,
      costs,
      { interval }
    );

    const truncatedAccessor = new CausalCandleWrapper(truncatedCandles, interval);
    const truncatedResult = await simulateStrategyWithCausalAccessor(
      truncatedAccessor,
      'test-mint',
      baseTimestamp,
      splitCandle.timestamp + intervalSeconds * 2, // End after split candle closes
      strategy,
      stopLoss,
      entry,
      reEntry,
      costs,
      { interval }
    );

    const originalDecisionsBeforeT = extractDecisionsBeforeTime(
      originalResult.events,
      splitCloseTime
    );
    const truncatedDecisionsBeforeT = extractDecisionsBeforeTime(
      truncatedResult.events,
      splitCloseTime
    );

    expect(truncatedDecisionsBeforeT).toEqual(originalDecisionsBeforeT);
  });
});

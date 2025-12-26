/**
 * Integration Test: Causal Accessor vs Upfront Fetching
 *
 * Verifies that simulations using causal accessor produce identical results
 * to upfront fetching (for the same time range and data).
 */

import { describe, it, expect } from 'vitest';
import type { Candle } from '../../src/types/candle.js';
import { simulateStrategy, simulateStrategyWithCausalAccessor } from '../../src/core/simulator.js';
import { CausalCandleWrapper } from '../../src/types/causal-accessor.js';
import type {
  StrategyLeg,
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  CostConfig,
} from '../../src/types/index.js';
import { getIntervalSeconds, type CandleInterval } from '../../src/types/candle.js';

/**
 * Create deterministic test candles
 */
function createDeterministicCandles(
  count: number,
  startTimestamp: number,
  intervalSeconds: number = 300
): Candle[] {
  const candles: Candle[] = [];
  let price = 100;

  // Use deterministic seed for price changes
  let seed = 12345;
  function deterministicRandom() {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  }

  for (let i = 0; i < count; i++) {
    const timestamp = startTimestamp + i * intervalSeconds;
    const priceChange = (deterministicRandom() - 0.5) * 2; // -1 to +1
    price = price + priceChange;

    candles.push({
      timestamp,
      open: price,
      high: price + Math.abs(priceChange) * 0.5,
      low: price - Math.abs(priceChange) * 0.5,
      close: price + priceChange * 0.1,
      volume: 1000 + deterministicRandom() * 500,
    });
  }

  return candles;
}

describe('Causal Accessor vs Upfront Fetching', () => {
  const baseTimestamp = 1000000000;
  const intervalSeconds = 300; // 5 minutes
  const interval: CandleInterval = '5m';

  const strategy: StrategyLeg[] = [
    { target: 1.1, percent: 0.5 },
    { target: 1.2, percent: 0.5 },
  ];

  const stopLoss: StopLossConfig = {
    initial: -0.2,
    trailing: 'none',
  };

  const entry: EntryConfig = {
    initialEntry: 'none',
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

  it('produces identical results for same candle data', async () => {
    const candles = createDeterministicCandles(50, baseTimestamp, intervalSeconds);
    const endTime = candles[candles.length - 1]!.timestamp + intervalSeconds * 2;

    // Run with upfront fetching (legacy)
    const upfrontResult = await simulateStrategy(
      candles,
      strategy,
      stopLoss,
      entry,
      reEntry,
      costs
    );

    // Run with causal accessor (new)
    const causalAccessor = new CausalCandleWrapper(candles, interval);
    const causalResult = await simulateStrategyWithCausalAccessor(
      causalAccessor,
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

    // Results should be identical
    expect(causalResult.finalPnl).toBeCloseTo(upfrontResult.finalPnl, 10);
    expect(causalResult.entryPrice).toBeCloseTo(upfrontResult.entryPrice, 10);
    expect(causalResult.finalPrice).toBeCloseTo(upfrontResult.finalPrice, 10);
    expect(causalResult.events.length).toBe(upfrontResult.events.length);

    // Events should match (allowing for small floating point differences)
    for (let i = 0; i < causalResult.events.length; i++) {
      const causalEvent = causalResult.events[i]!;
      const upfrontEvent = upfrontResult.events[i]!;

      expect(causalEvent.type).toBe(upfrontEvent.type);
      expect(causalEvent.timestamp).toBe(upfrontEvent.timestamp);
      expect(causalEvent.price).toBeCloseTo(upfrontEvent.price, 10);
      expect(causalEvent.remainingPosition).toBeCloseTo(upfrontEvent.remainingPosition, 10);
      expect(causalEvent.pnlSoFar).toBeCloseTo(upfrontEvent.pnlSoFar, 10);
    }
  });

  it('enforces causality - cannot access future candles', async () => {
    const candles = createDeterministicCandles(50, baseTimestamp, intervalSeconds);
    const endTime = candles[candles.length - 1]!.timestamp + intervalSeconds * 2;

    // Create causal accessor
    const causalAccessor = new CausalCandleWrapper(candles, interval);

    // At time before first candle closes, should get no candles
    const earlyTime = baseTimestamp + 100; // Before first candle closes (at baseTimestamp + 300)
    const earlyCandles = await causalAccessor.getCandlesAtTime(
      'test-mint',
      earlyTime,
      10000,
      interval
    );
    expect(earlyCandles.length).toBe(0);

    // At time after first candle closes, should get first candle
    const afterFirstClose = baseTimestamp + intervalSeconds + 1;
    const afterFirstCandles = await causalAccessor.getCandlesAtTime(
      'test-mint',
      afterFirstClose,
      10000,
      interval
    );
    expect(afterFirstCandles.length).toBe(1);
    expect(afterFirstCandles[0]!.timestamp).toBe(baseTimestamp);

    // At time after second candle closes, should get first two candles
    const afterSecondClose = baseTimestamp + intervalSeconds * 2 + 1;
    const afterSecondCandles = await causalAccessor.getCandlesAtTime(
      'test-mint',
      afterSecondClose,
      10000,
      interval
    );
    expect(afterSecondCandles.length).toBe(2);
    expect(afterSecondCandles[0]!.timestamp).toBe(baseTimestamp);
    expect(afterSecondCandles[1]!.timestamp).toBe(baseTimestamp + intervalSeconds);
  });
});

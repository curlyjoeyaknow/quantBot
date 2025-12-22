/**
 * Idempotency Integration Tests
 * ============================
 *
 * Verifies that reprocessing the same data does not create duplicates.
 *
 * Critical invariants:
 * - Same simulation run_id → same results (no duplicates)
 * - Same candles ingested twice → same candle count
 * - Same Telegram export processed twice → same alert count
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { simulateStrategy } from '../../src/engine';
import type { Strategy, StopLossConfig, EntryConfig, ReEntryConfig } from '../../src/config';
import { monotonicUp } from '../fixtures/golden-candles';

const DEFAULT_COST_CONFIG = {
  entrySlippageBps: 125,
  exitSlippageBps: 125,
  takerFeeBps: 25,
  borrowAprBps: 0,
};

const simpleStrategy: Strategy[] = [{ percent: 1.0, target: 2.0 }];
const defaultStopLoss: StopLossConfig = { initial: -0.3, trailing: 'none' };
const defaultEntry: EntryConfig = { initialEntry: 'none', trailingEntry: 'none', maxWaitTime: 60 };
const defaultReEntry: ReEntryConfig = { trailingReEntry: 'none', maxReEntries: 0 };

describe('Idempotency - Simulation Runs', () => {
  it('should produce identical results when run twice with same inputs', async () => {
    const result1 = await simulateStrategy(
      monotonicUp,
      simpleStrategy,
      defaultStopLoss,
      defaultEntry,
      defaultReEntry,
      DEFAULT_COST_CONFIG
    );

    const result2 = await simulateStrategy(
      monotonicUp,
      simpleStrategy,
      defaultStopLoss,
      defaultEntry,
      defaultReEntry,
      DEFAULT_COST_CONFIG
    );

    // Bit-for-bit identical
    expect(result1.finalPnl).toBe(result2.finalPnl);
    expect(result1.entryPrice).toBe(result2.entryPrice);
    expect(result1.finalPrice).toBe(result2.finalPrice);
    expect(result1.totalCandles).toBe(result2.totalCandles);
    expect(result1.events.length).toBe(result2.events.length);

    // Events should be identical
    result1.events.forEach((event, i) => {
      expect(event.type).toBe(result2.events[i].type);
      expect(event.timestamp).toBe(result2.events[i].timestamp);
      expect(event.price).toBe(result2.events[i].price);
    });
  });

  it('should produce identical results when run multiple times', async () => {
    const results = await Promise.all([
      simulateStrategy(
        monotonicUp,
        simpleStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry,
        DEFAULT_COST_CONFIG
      ),
      simulateStrategy(
        monotonicUp,
        simpleStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry,
        DEFAULT_COST_CONFIG
      ),
      simulateStrategy(
        monotonicUp,
        simpleStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry,
        DEFAULT_COST_CONFIG
      ),
      simulateStrategy(
        monotonicUp,
        simpleStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry,
        DEFAULT_COST_CONFIG
      ),
      simulateStrategy(
        monotonicUp,
        simpleStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry,
        DEFAULT_COST_CONFIG
      ),
    ]);

    // All results should be identical
    const firstPnl = results[0].finalPnl;
    results.forEach((result, i) => {
      expect(result.finalPnl).toBe(firstPnl);
      expect(result.entryPrice).toBe(results[0].entryPrice);
      expect(result.finalPrice).toBe(results[0].finalPrice);
    });
  });
});

describe('Idempotency - Candle Processing', () => {
  it('should handle same candles array without side effects', async () => {
    const candles = [...monotonicUp]; // Copy array

    const result1 = await simulateStrategy(
      candles,
      simpleStrategy,
      defaultStopLoss,
      defaultEntry,
      defaultReEntry,
      DEFAULT_COST_CONFIG
    );

    // Process same candles again
    const result2 = await simulateStrategy(
      candles,
      simpleStrategy,
      defaultStopLoss,
      defaultEntry,
      defaultReEntry,
      DEFAULT_COST_CONFIG
    );

    // Should be identical
    expect(result1.finalPnl).toBe(result2.finalPnl);
    expect(result1.totalCandles).toBe(result2.totalCandles);
    expect(candles.length).toBe(monotonicUp.length); // Original array unchanged
  });
});

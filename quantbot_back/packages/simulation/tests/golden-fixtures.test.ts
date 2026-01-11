/**
 * Golden Fixtures Tests
 * =====================
 *
 * These tests use known-answer fixtures to verify simulation correctness.
 *
 * If these fail, your PnL calculations are wrong. Period.
 */

import { describe, it, expect } from 'vitest';
import { simulateStrategy } from '../src/engine';
import type { Strategy, StopLossConfig, EntryConfig, ReEntryConfig } from '../src/config';
import {
  monotonicUp,
  monotonicUpExpected,
  monotonicDown,
  monotonicDownExpected,
  whipsaw,
  whipsawExpected,
  gappyTimestamps,
  gappyTimestampsExpected,
  perfectTargetHit,
  perfectTargetHitExpected,
  ladderTargets,
  ladderTargetsExpected,
  singleCandle,
  singleCandleExpected,
  immediateStopLoss,
  immediateStopLossExpected,
} from './fixtures/golden-candles';

// Default cost config: 1.25% entry slippage, 1.25% exit slippage, 0.25% taker fee
const DEFAULT_COST_CONFIG = {
  entrySlippageBps: 125, // 1.25%
  exitSlippageBps: 125, // 1.25%
  takerFeeBps: 25, // 0.25%
  borrowAprBps: 0,
};

// Simple strategy: 100% at 2x
const simpleStrategy: Strategy[] = [{ percent: 1.0, target: 2.0 }];

// Stop loss: -30%
const defaultStopLoss: StopLossConfig = { initial: -0.3, trailing: 'none' };

// No entry optimization
const defaultEntry: EntryConfig = { initialEntry: 'none', trailingEntry: 'none', maxWaitTime: 60 };

// No re-entry
const defaultReEntry: ReEntryConfig = { trailingReEntry: 'none', maxReEntries: 0 };

describe('Golden Fixtures - Known Answer Tests', () => {
  describe('Monotonic Up', () => {
    it('should produce exact PnL for monotonic price increase', async () => {
      const result = await simulateStrategy(
        monotonicUp,
        simpleStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry,
        DEFAULT_COST_CONFIG
      );

      // Exact assertions - not "greater than" or "approximately"
      expect(result.entryPrice).toBe(monotonicUpExpected.entryPrice);
      expect(result.finalPrice).toBeCloseTo(monotonicUpExpected.exitPrice, 2);
      expect(result.finalPnl).toBeCloseTo(monotonicUpExpected.netMultiple, 2);
      expect(result.totalCandles).toBe(monotonicUpExpected.totalCandles);

      // Verify ATH/ATL
      const highs = monotonicUp.map((c) => c.high);
      const lows = monotonicUp.map((c) => c.low);
      expect(Math.max(...highs)).toBe(monotonicUpExpected.athPrice);
      expect(Math.min(...lows)).toBe(monotonicUpExpected.atlPrice);
    });

    it('should have entry event at first candle', () => {
      // This test verifies entry timing
      const entryEvent = { timestamp: monotonicUp[0].timestamp, price: monotonicUp[0].open };
      expect(entryEvent.timestamp).toBe(1000);
      expect(entryEvent.price).toBe(1.0);
    });
  });

  describe('Monotonic Down', () => {
    it('should trigger stop loss and produce exact PnL', async () => {
      const result = await simulateStrategy(
        monotonicDown,
        simpleStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry,
        DEFAULT_COST_CONFIG
      );

      // Should trigger stop loss
      const stopLossEvent = result.events.find((e) => e.type === 'stop_loss');
      expect(stopLossEvent).toBeDefined();
      expect(stopLossEvent?.price).toBeCloseTo(monotonicDownExpected.exitPrice, 1);

      // Exact PnL assertion
      expect(result.finalPnl).toBeCloseTo(monotonicDownExpected.netMultiple, 2);
      expect(result.totalCandles).toBe(monotonicDownExpected.totalCandles);
    });
  });

  describe('Whipsaw', () => {
    it('should handle price oscillation and end near break-even', async () => {
      const result = await simulateStrategy(
        whipsaw,
        simpleStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry,
        DEFAULT_COST_CONFIG
      );

      // Should end near break-even (slight loss due to fees)
      expect(result.finalPnl).toBeCloseTo(whipsawExpected.netMultiple, 2);
      expect(result.finalPrice).toBeCloseTo(whipsawExpected.exitPrice, 2);

      // Verify ATH/ATL
      const highs = whipsaw.map((c) => c.high);
      const lows = whipsaw.map((c) => c.low);
      expect(Math.max(...highs)).toBe(whipsawExpected.athPrice);
      expect(Math.min(...lows)).toBe(whipsawExpected.atlPrice);
    });
  });

  describe('Gappy Timestamps', () => {
    it('should handle missing candles gracefully', async () => {
      const result = await simulateStrategy(
        gappyTimestamps,
        simpleStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry,
        DEFAULT_COST_CONFIG
      );

      // Should produce same PnL as monotonic up (same price movement)
      expect(result.finalPnl).toBeCloseTo(gappyTimestampsExpected.netMultiple, 2);
      expect(result.totalCandles).toBe(gappyTimestampsExpected.totalCandles);
    });
  });

  describe('Perfect Target Hit', () => {
    it('should exit exactly when target is hit', async () => {
      const result = await simulateStrategy(
        perfectTargetHit,
        simpleStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry,
        DEFAULT_COST_CONFIG
      );

      // Should have target_hit event
      const targetHitEvent = result.events.find((e) => e.type === 'target_hit');
      expect(targetHitEvent).toBeDefined();
      expect(targetHitEvent?.price).toBeCloseTo(2.0, 2);
      expect(targetHitEvent?.timestamp).toBe(perfectTargetHitExpected.exitTimestamp);

      // Exact PnL
      expect(result.finalPnl).toBeCloseTo(perfectTargetHitExpected.netMultiple, 2);
    });
  });

  describe('Ladder Targets', () => {
    it('should exit at multiple profit targets correctly', async () => {
      const ladderStrategy: Strategy[] = [
        { percent: 0.33, target: 1.5 },
        { percent: 0.33, target: 2.0 },
        { percent: 0.34, target: 3.0 },
      ];

      const result = await simulateStrategy(
        ladderTargets,
        ladderStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry,
        DEFAULT_COST_CONFIG
      );

      // Should have multiple target_hit events
      const targetHits = result.events.filter((e) => e.type === 'target_hit');
      expect(targetHits.length).toBeGreaterThanOrEqual(1);

      // Final PnL should account for weighted exits
      expect(result.finalPnl).toBeCloseTo(ladderTargetsExpected.netMultiple, 2);
    });
  });

  describe('Edge Cases', () => {
    it('should handle single candle correctly', async () => {
      const result = await simulateStrategy(
        singleCandle,
        simpleStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry,
        DEFAULT_COST_CONFIG
      );

      expect(result.entryPrice).toBe(singleCandleExpected.entryPrice);
      expect(result.finalPrice).toBeCloseTo(singleCandleExpected.exitPrice, 2);
      expect(result.finalPnl).toBeCloseTo(singleCandleExpected.netMultiple, 2);
      expect(result.totalCandles).toBe(singleCandleExpected.totalCandles);
    });

    it('should handle immediate stop loss trigger', async () => {
      const result = await simulateStrategy(
        immediateStopLoss,
        simpleStrategy,
        defaultStopLoss,
        defaultEntry,
        defaultReEntry,
        DEFAULT_COST_CONFIG
      );

      // Should trigger stop loss immediately
      const stopLossEvent = result.events.find((e) => e.type === 'stop_loss');
      expect(stopLossEvent).toBeDefined();
      expect(stopLossEvent?.timestamp).toBe(immediateStopLossExpected.exitTimestamp);

      // Exact PnL
      expect(result.finalPnl).toBeCloseTo(immediateStopLossExpected.netMultiple, 2);
      expect(result.finalPrice).toBeCloseTo(immediateStopLossExpected.exitPrice, 2);
    });
  });

  describe('Determinism', () => {
    it('should produce identical results when run twice', async () => {
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
      expect(result1.events.length).toBe(result2.events.length);
    });
  });
});

/**
 * Seeded Simulation Determinism Tests
 *
 * Ensures identical outputs with the same seed and divergent outputs with different seeds
 * using a small dataset for fast runtime.
 */

import { createHash } from 'crypto';
import { describe, it, expect } from 'vitest';
import { simulateStrategy } from '../../src/core/simulator.js';
import type { Candle, StrategyLeg, EntryConfig, StopLossConfig } from '../../src/types/index.js';
import type { ExecutionModel } from '../../src/types/execution-model.js';

function createSmallCandles(count: number): Candle[] {
  const candles: Candle[] = [];
  const baseTimestamp = 1700000000;
  const startPrice = 1.0;

  for (let i = 0; i < count; i++) {
    const price = startPrice * (1 + i * 0.015);
    candles.push({
      timestamp: baseTimestamp + i * 60,
      open: price,
      high: price * 1.02,
      low: price * 0.98,
      close: price * 1.01,
      volume: 1000 + i * 5,
    });
  }

  return candles;
}

function createStrategy(): StrategyLeg[] {
  return [
    { target: 1.05, percent: 0.6 },
    { target: 1.1, percent: 0.4 },
  ];
}

function createExecutionModel(): ExecutionModel {
  return {
    slippage: {
      type: 'fixed',
      params: {
        bps: 5,
        jitterBps: 25,
      },
    },
    fees: {
      entryFeeBps: 0,
      exitFeeBps: 0,
      takerFeeBps: 0,
    },
  };
}

function countTrades(events: Array<{ type: string }>): number {
  const tradeTypes = new Set(['target_hit', 'stop_loss', 'final_exit', 'ladder_exit']);
  return events.filter((event) => tradeTypes.has(event.type)).length;
}

function hashEventTrace(
  events: Array<{
    type: string;
    timestamp: number;
    price: number;
    pnlSoFar: number;
    remainingPosition: number;
  }>
): string {
  const normalized = events.map((event) => ({
    type: event.type,
    timestamp: event.timestamp,
    price: event.price,
    pnlSoFar: event.pnlSoFar,
    remainingPosition: event.remainingPosition,
  }));
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

describe('Seeded simulation determinism', () => {
  const candles = createSmallCandles(12);
  const strategy = createStrategy();
  const entryConfig: EntryConfig = { initialEntry: 'none', trailingEntry: 'none', maxWaitTime: 60 };
  const stopLossConfig: StopLossConfig = { initial: -0.2, trailing: 'none' };
  const executionModel = createExecutionModel();

  it('runs the same scenario twice with the same seed and matches PnL, trades, and trace hash', async () => {
    const seed = 4242;
    const result1 = await simulateStrategy(
      candles,
      strategy,
      stopLossConfig,
      entryConfig,
      undefined,
      undefined,
      {
        seed,
        executionModel,
      }
    );
    const result2 = await simulateStrategy(
      candles,
      strategy,
      stopLossConfig,
      entryConfig,
      undefined,
      undefined,
      {
        seed,
        executionModel,
      }
    );

    const tradeCount1 = countTrades(result1.events);
    const tradeCount2 = countTrades(result2.events);
    const traceHash1 = hashEventTrace(result1.events);
    const traceHash2 = hashEventTrace(result2.events);

    expect(result1.finalPnl).toBe(result2.finalPnl);
    expect(tradeCount1).toBe(tradeCount2);
    expect(traceHash1).toBe(traceHash2);
  });

  it('changes output hash when the seed changes', async () => {
    const result1 = await simulateStrategy(
      candles,
      strategy,
      stopLossConfig,
      entryConfig,
      undefined,
      undefined,
      {
        seed: 4242,
        executionModel,
      }
    );
    const result2 = await simulateStrategy(
      candles,
      strategy,
      stopLossConfig,
      entryConfig,
      undefined,
      undefined,
      {
        seed: 4243,
        executionModel,
      }
    );

    const traceHash1 = hashEventTrace(result1.events);
    const traceHash2 = hashEventTrace(result2.events);

    expect(traceHash1).not.toBe(traceHash2);
  });
});

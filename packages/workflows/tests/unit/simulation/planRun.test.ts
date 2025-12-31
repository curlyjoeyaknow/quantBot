/**
 * Unit tests for planRun service
 */

import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { planRun } from '../../../src/simulation/planRun.js';
import type { StrategyConfig } from '@quantbot/simulation/src/engine/index.js';
import type { CallRecord } from '../../../src/types.js';

describe('planRun', () => {
  const mockStrategy: StrategyConfig = {
    entry: { mode: 'immediate' },
    exits: { targets: [{ size_pct: 100, profit_pct: 10 }] },
    stops: { stop_loss_pct: 5 },
    execution: { fill_model: 'close', fee_bps: 10, slippage_bps: 30 },
  };

  const mockCalls: CallRecord[] = [
    {
      id: 'call1',
      caller: 'test',
      mint: 'token1',
      createdAt: DateTime.fromISO('2024-01-01T12:00:00Z'),
    },
    {
      id: 'call2',
      caller: 'test',
      mint: 'token2',
      createdAt: DateTime.fromISO('2024-01-01T13:00:00Z'),
    },
  ];

  it('should calculate requirements for immediate entry strategy', () => {
    const plan = planRun(mockStrategy, mockCalls, '5m', 0, 0);

    expect(plan.requiredWarmupCandles).toBe(0); // No indicators
    expect(plan.requiredLookback).toBe(0);
    expect(plan.interval).toBe('5m');
    expect(plan.tokenRequirements.length).toBe(2);
  });

  it('should calculate requirements for RSI strategy', () => {
    const rsiStrategy: StrategyConfig = {
      entry: {
        mode: 'signal',
        signal: { type: 'rsi_below', period: 14, value: 30 },
      },
      exits: { targets: [{ size_pct: 100, profit_pct: 10 }] },
      stops: { stop_loss_pct: 5 },
      execution: { fill_model: 'close', fee_bps: 10, slippage_bps: 30 },
    };

    const plan = planRun(rsiStrategy, mockCalls, '5m', 0, 0);

    expect(plan.requiredWarmupCandles).toBe(15); // RSI(14) needs 15 candles
    expect(plan.requiredLookback).toBe(15);
  });

  it('should calculate requirements for EMA cross strategy', () => {
    const emaStrategy: StrategyConfig = {
      entry: {
        mode: 'signal',
        signal: { type: 'ema_cross', fast: 12, slow: 26, direction: 'bull' },
      },
      exits: { targets: [{ size_pct: 100, profit_pct: 10 }] },
      stops: { stop_loss_pct: 5 },
      execution: { fill_model: 'close', fee_bps: 10, slippage_bps: 30 },
    };

    const plan = planRun(emaStrategy, mockCalls, '5m', 0, 0);

    expect(plan.requiredWarmupCandles).toBe(27); // EMA(26) needs 27 candles
    expect(plan.requiredLookback).toBe(27);
  });

  it('should account for delay in requirements', () => {
    const delayedStrategy: StrategyConfig = {
      entry: {
        mode: 'immediate',
        delay: { mode: 'candles', n: 5 },
      },
      exits: { targets: [{ size_pct: 100, profit_pct: 10 }] },
      stops: { stop_loss_pct: 5 },
      execution: { fill_model: 'close', fee_bps: 10, slippage_bps: 30 },
    };

    const plan = planRun(delayedStrategy, mockCalls, '5m', 0, 0);

    expect(plan.requiredDelay).toBe(5);
    expect(plan.requiredLookback).toBe(5);
  });

  it('should account for time exit in max holding', () => {
    const timeExitStrategy: StrategyConfig = {
      entry: { mode: 'immediate' },
      exits: {
        targets: [],
        time_exit: { enabled: true, max_candles_in_trade: 100 },
      },
      stops: { stop_loss_pct: 5 },
      execution: { fill_model: 'close', fee_bps: 10, slippage_bps: 30 },
    };

    const plan = planRun(timeExitStrategy, mockCalls, '5m', 0, 0);

    expect(plan.maxHoldingCandles).toBe(100);
  });

  it('should calculate time ranges per token', () => {
    const plan = planRun(mockStrategy, mockCalls, '5m', 60, 120);

    expect(plan.tokenRequirements.length).toBe(2);

    const token1Req = plan.tokenRequirements.find((r) => r.token === 'token1');
    expect(token1Req).toBeDefined();
    expect(token1Req?.requiredFromTs).toBeDefined();
    expect(token1Req?.requiredToTs).toBeDefined();
    expect(token1Req?.requiredCandleCount).toBeGreaterThan(0);
  });
});

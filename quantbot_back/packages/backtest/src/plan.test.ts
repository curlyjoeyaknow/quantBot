import { describe, it, expect } from 'vitest';
import { DateTime } from 'luxon';
import { planBacktest } from './plan';
import type { BacktestRequest } from './types';

describe('planBacktest', () => {
  it('defaults maxHold to 24h scaled by interval', () => {
    const req: BacktestRequest = {
      interval: '5m',
      from: DateTime.fromISO('2024-01-01T00:00:00Z'),
      to: DateTime.fromISO('2024-01-02T00:00:00Z'),
      strategy: {
        id: 's1',
        name: 'test',
        overlays: [],
        fees: { takerFeeBps: 30, slippageBps: 10 },
        position: { notionalUsd: 1000 },
        indicatorWarmup: 52,
        entryDelay: 0,
      },
      calls: [
        {
          id: 'c1',
          caller: 'alice',
          mint: 'So11111111111111111111111111111111111111112' as any,
          createdAt: DateTime.fromISO('2024-01-01T12:00:00Z'),
        },
      ],
    };

    const plan = planBacktest(req);
    expect(plan.intervalSeconds).toBe(300);
    expect(plan.maxHoldCandles).toBe(288); // 24h / 5m
    expect(plan.totalRequiredCandles).toBe(52 + 0 + 288);
  });

  it('derives maxHold from time_exit overlay and interval', () => {
    const req: BacktestRequest = {
      interval: '1m',
      from: DateTime.fromISO('2024-01-01T00:00:00Z'),
      to: DateTime.fromISO('2024-01-02T00:00:00Z'),
      strategy: {
        id: 's2',
        name: 'test-time-exit',
        overlays: [{ kind: 'time_exit', holdMs: 6 * 60 * 60 * 1000 }],
        fees: { takerFeeBps: 30, slippageBps: 10 },
        position: { notionalUsd: 1000 },
      },
      calls: [
        {
          id: 'c1',
          caller: 'bob',
          mint: 'So11111111111111111111111111111111111111112' as any,
          createdAt: DateTime.fromISO('2024-01-01T12:00:00Z'),
        },
      ],
    };

    const plan = planBacktest(req);
    expect(plan.intervalSeconds).toBe(60);
    expect(plan.maxHoldCandles).toBe(360); // 6h / 1m
  });
});

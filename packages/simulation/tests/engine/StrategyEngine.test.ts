/**
 * Unit tests for StrategyEngine
 */

import { describe, it, expect } from 'vitest';
import { simulateOnCalls, type SimulationRequest } from '../../src/engine/StrategyEngine';
import type { Candle } from '../../src/models';
import type { Call } from '@quantbot/core';
import { DateTime } from 'luxon';

describe('StrategyEngine', () => {
  it('should simulate strategy on calls with candles', () => {
    // Create mock candles
    const candles: Candle[] = [
      { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      { timestamp: 2000, open: 1.05, high: 1.2, low: 1.0, close: 1.15, volume: 1200 },
      { timestamp: 3000, open: 1.15, high: 1.3, low: 1.1, close: 1.25, volume: 1500 },
    ];

    // Create mock calls
    const calls: Call[] = [
      {
        id: 1,
        tokenId: 1,
        side: 'buy',
        signalType: 'entry',
        signalTimestamp: DateTime.fromSeconds(1000),
        createdAt: DateTime.now(),
      },
    ];

    // Create request
    const request: SimulationRequest = {
      strategy: {
        name: 'TestStrategy',
        profitTargets: [{ target: 2.0, percent: 1.0 }],
        stopLoss: { initial: -0.2, trailing: 'none' },
      },
      candlesByToken: new Map([['1', candles]]),
      calls,
    };

    const trace = simulateOnCalls(request);

    expect(trace).toBeDefined();
    expect(trace.trades).toBeDefined();
    expect(trace.events).toBeDefined();
    expect(trace.aggregates).toBeDefined();
  });

  it('should handle empty calls', () => {
    const request: SimulationRequest = {
      strategy: {
        name: 'TestStrategy',
        profitTargets: [{ target: 2.0, percent: 1.0 }],
      },
      candlesByToken: new Map(),
      calls: [],
    };

    const trace = simulateOnCalls(request);

    expect(trace.trades).toEqual([]);
    expect(trace.events).toEqual([]);
    expect(trace.aggregates.size).toBe(0);
  });

  it('should handle calls without candles', () => {
    const calls: Call[] = [
      {
        id: 1,
        tokenId: 1,
        side: 'buy',
        signalType: 'entry',
        signalTimestamp: DateTime.fromSeconds(1000),
        createdAt: DateTime.now(),
      },
    ];

    const request: SimulationRequest = {
      strategy: {
        name: 'TestStrategy',
        profitTargets: [{ target: 2.0, percent: 1.0 }],
      },
      candlesByToken: new Map(), // No candles
      calls,
    };

    const trace = simulateOnCalls(request);

    // Should skip tokens without candles
    expect(trace.trades.length).toBe(0);
  });
});


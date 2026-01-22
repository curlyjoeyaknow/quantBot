/**
 * Performance Benchmarks
 *
 * Baseline benchmarks for critical paths. CI fails if performance regresses > 20%.
 */

import { describe, it, expect } from 'vitest';
import { executePolicy } from '../../src/policies/policy-executor.js';
import type {
  FixedStopPolicy,
  TrailingStopPolicy,
  LadderPolicy,
} from '../../src/policies/risk-policy.js';
import type { Candle } from '@quantbot/core';

// Generate test candles
function generateCandles(
  count: number,
  startTs: number = 1000000000,
  intervalSeconds: number = 300
): Candle[] {
  const candles: Candle[] = [];
  let price = 100;

  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.5) * 0.02; // ±1% per candle
    price = price * (1 + change);
    candles.push({
      timestamp: startTs + i * intervalSeconds,
      open: price * 0.99,
      high: price * 1.01,
      low: price * 0.98,
      close: price,
      volume: 1000 + Math.random() * 500,
    });
  }

  return candles;
}

describe('Performance Benchmarks', () => {
  const baselineTimes: Record<string, number> = {
    fixedStop_1000_candles: 5, // milliseconds
    trailingStop_1000_candles: 8,
    ladder_1000_candles: 12,
    fixedStop_10000_candles: 45,
    trailingStop_10000_candles: 75,
    ladder_10000_candles: 120,
  };

  const performanceThreshold = 1.2; // 20% regression allowed

  it('fixed stop - 1000 candles', () => {
    const candles = generateCandles(1000);
    const policy: FixedStopPolicy = {
      kind: 'fixed_stop',
      stopPct: 0.2,
      takeProfitPct: 1.0,
    };

    const start = performance.now();
    executePolicy(candles, candles[0]!.timestamp * 1000, policy);
    const elapsed = performance.now() - start;

    const baseline = baselineTimes.fixedStop_1000_candles;
    const maxTime = baseline * performanceThreshold;

    expect(elapsed).toBeLessThan(maxTime);
    console.log(
      `Fixed stop (1000 candles): ${elapsed.toFixed(2)}ms (baseline: ${baseline}ms, max: ${maxTime.toFixed(2)}ms)`
    );
  });

  it('trailing stop - 1000 candles', () => {
    const candles = generateCandles(1000);
    const policy: TrailingStopPolicy = {
      kind: 'trailing_stop',
      activationPct: 0.2,
      trailPct: 0.1,
      hardStopPct: 0.15,
    };

    const start = performance.now();
    executePolicy(candles, candles[0]!.timestamp * 1000, policy);
    const elapsed = performance.now() - start;

    const baseline = baselineTimes.trailingStop_1000_candles;
    const maxTime = baseline * performanceThreshold;

    expect(elapsed).toBeLessThan(maxTime);
    console.log(
      `Trailing stop (1000 candles): ${elapsed.toFixed(2)}ms (baseline: ${baseline}ms, max: ${maxTime.toFixed(2)}ms)`
    );
  });

  it('ladder - 1000 candles', () => {
    const candles = generateCandles(1000);
    const policy: LadderPolicy = {
      kind: 'ladder',
      levels: [
        { multiple: 2.0, fraction: 0.5 },
        { multiple: 3.0, fraction: 0.3 },
        { multiple: 4.0, fraction: 0.2 },
      ],
      stopPct: 0.2,
    };

    const start = performance.now();
    executePolicy(candles, candles[0]!.timestamp * 1000, policy);
    const elapsed = performance.now() - start;

    const baseline = baselineTimes.ladder_1000_candles;
    const maxTime = baseline * performanceThreshold;

    expect(elapsed).toBeLessThan(maxTime);
    console.log(
      `Ladder (1000 candles): ${elapsed.toFixed(2)}ms (baseline: ${baseline}ms, max: ${maxTime.toFixed(2)}ms)`
    );
  });

  it('fixed stop - 10000 candles', () => {
    const candles = generateCandles(10000);
    const policy: FixedStopPolicy = {
      kind: 'fixed_stop',
      stopPct: 0.2,
      takeProfitPct: 1.0,
    };

    const start = performance.now();
    executePolicy(candles, candles[0]!.timestamp * 1000, policy);
    const elapsed = performance.now() - start;

    const baseline = baselineTimes.fixedStop_10000_candles;
    const maxTime = baseline * performanceThreshold;

    expect(elapsed).toBeLessThan(maxTime);
    console.log(
      `Fixed stop (10000 candles): ${elapsed.toFixed(2)}ms (baseline: ${baseline}ms, max: ${maxTime.toFixed(2)}ms)`
    );
  });

  it('trailing stop - 10000 candles', () => {
    const candles = generateCandles(10000);
    const policy: TrailingStopPolicy = {
      kind: 'trailing_stop',
      activationPct: 0.2,
      trailPct: 0.1,
      hardStopPct: 0.15,
    };

    const start = performance.now();
    executePolicy(candles, candles[0]!.timestamp * 1000, policy);
    const elapsed = performance.now() - start;

    const baseline = baselineTimes.trailingStop_10000_candles;
    const maxTime = baseline * performanceThreshold;

    expect(elapsed).toBeLessThan(maxTime);
    console.log(
      `Trailing stop (10000 candles): ${elapsed.toFixed(2)}ms (baseline: ${baseline}ms, max: ${maxTime.toFixed(2)}ms)`
    );
  });

  it('ladder - 10000 candles', () => {
    const candles = generateCandles(10000);
    const policy: LadderPolicy = {
      kind: 'ladder',
      levels: [
        { multiple: 2.0, fraction: 0.5 },
        { multiple: 3.0, fraction: 0.3 },
        { multiple: 4.0, fraction: 0.2 },
      ],
      stopPct: 0.2,
    };

    const start = performance.now();
    executePolicy(candles, candles[0]!.timestamp * 1000, policy);
    const elapsed = performance.now() - start;

    const baseline = baselineTimes.ladder_10000_candles;
    const maxTime = baseline * performanceThreshold;

    expect(elapsed).toBeLessThan(maxTime);
    console.log(
      `Ladder (10000 candles): ${elapsed.toFixed(2)}ms (baseline: ${baseline}ms, max: ${maxTime.toFixed(2)}ms)`
    );
  });
});

/**
 * Performance Benchmarks
 *
 * Ensures simulations meet performance thresholds.
 */

import { describe, it, expect } from 'vitest';
import { simulateFromInput } from '../../src/core/contract-adapter';
import type { SimInput } from '../../src/types/contracts';

/**
 * Generate test candles
 */
function generateCandles(count: number): SimInput['candles'] {
  const candles: SimInput['candles'] = [];
  let price = 1.0;
  for (let i = 0; i < count; i++) {
    price += (Math.random() - 0.5) * 0.1;
    candles.push({
      timestamp: 1704110400 + i * 60,
      open: price,
      high: price * 1.05,
      low: price * 0.95,
      close: price,
      volume: 1000 + Math.random() * 500,
    });
  }
  return candles;
}

describe('Simulation Performance Benchmarks', () => {
  it('should complete simulation in < 100ms for 100 candles', async () => {
    const input: SimInput = {
      run_id: 'perf_test_001',
      strategy_id: 'PT2_SL25',
      mint: 'So11111111111111111111111111111111111111112',
      alert_timestamp: '2024-01-01T12:00:00Z',
      candles: generateCandles(100),
      entry_config: {
        initialEntry: 'none',
        trailingEntry: 'none',
        maxWaitTime: 60,
      },
      exit_config: {
        profit_targets: [{ target: 2.0, percent: 1.0 }],
        stop_loss: { initial: -0.25 },
      },
    };

    const start = performance.now();
    await simulateFromInput(input);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(100); // 100ms threshold
  });

  it('should complete simulation in < 500ms for 1000 candles', async () => {
    const input: SimInput = {
      run_id: 'perf_test_002',
      strategy_id: 'PT2_SL25',
      mint: 'So11111111111111111111111111111111111111112',
      alert_timestamp: '2024-01-01T12:00:00Z',
      candles: generateCandles(1000),
      entry_config: {
        initialEntry: 'none',
        trailingEntry: 'none',
        maxWaitTime: 60,
      },
      exit_config: {
        profit_targets: [{ target: 2.0, percent: 1.0 }],
        stop_loss: { initial: -0.25 },
      },
    };

    const start = performance.now();
    await simulateFromInput(input);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(500); // 500ms threshold
  });

  it('should complete simulation in < 2000ms for 10000 candles', async () => {
    const input: SimInput = {
      run_id: 'perf_test_003',
      strategy_id: 'PT2_SL25',
      mint: 'So11111111111111111111111111111111111111112',
      alert_timestamp: '2024-01-01T12:00:00Z',
      candles: generateCandles(10000),
      entry_config: {
        initialEntry: 'none',
        trailingEntry: 'none',
        maxWaitTime: 60,
      },
      exit_config: {
        profit_targets: [{ target: 2.0, percent: 1.0 }],
        stop_loss: { initial: -0.25 },
      },
    };

    const start = performance.now();
    await simulateFromInput(input);
    const duration = performance.now() - start;

    expect(duration).toBeLessThan(2000); // 2000ms threshold
  });
});

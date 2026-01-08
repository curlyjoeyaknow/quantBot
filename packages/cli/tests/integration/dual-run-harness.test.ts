/**
 * Dual-Run Harness Integration Tests
 *
 * Tests the dual-run harness to ensure it correctly compares
 * TypeScript and Python simulation results.
 */

import { describe, it, expect } from 'vitest';
import { runDualSimulation } from '../../src/core/dual-run-harness.js';
import type { SimInput } from '@quantbot/backtest';
import { SimInputSchema } from '@quantbot/backtest';

describe('Dual-Run Harness', () => {
  const testInput: SimInput = {
    run_id: 'test_dual_001',
    strategy_id: 'PT2_SL25',
    mint: 'So11111111111111111111111111111111111111112',
    alert_timestamp: '2024-01-01T12:00:00Z',
    candles: [
      { timestamp: 1704110400, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      { timestamp: 1704110460, open: 1.05, high: 1.2, low: 1.0, close: 1.15, volume: 1200 },
      { timestamp: 1704110520, open: 1.15, high: 2.1, low: 1.1, close: 2.0, volume: 2000 },
    ],
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

  it('should run both TS and Python sims', async () => {
    const validatedInput = SimInputSchema.parse(testInput);
    const result = await runDualSimulation(validatedInput);

    expect(result.tsResult).toBeDefined();
    expect(result.tsResult.run_id).toBe(validatedInput.run_id);
    expect(result.pythonResult).toBeDefined();
    expect(result.pythonResult.run_id).toBe(validatedInput.run_id);
    expect(result.parity).toBeDefined();
  });

  it('should calculate parity statistics', async () => {
    const validatedInput = SimInputSchema.parse(testInput);
    const result = await runDualSimulation(validatedInput);

    expect(result.parity.pnlDiff).toBeGreaterThanOrEqual(0);
    expect(result.parity.pnlDiffPercent).toBeGreaterThanOrEqual(0);
    expect(result.parity.eventCountDiff).toBeGreaterThanOrEqual(0);
    expect(result.parity.parityScore).toBeGreaterThanOrEqual(0);
    expect(result.parity.parityScore).toBeLessThanOrEqual(1);
  });

  it('should handle Python simulation failures gracefully', async () => {
    // Use invalid input that might cause Python to fail
    const invalidInput: SimInput = {
      run_id: 'test_dual_fail_001',
      strategy_id: 'INVALID',
      mint: 'invalid_mint',
      alert_timestamp: 'invalid-timestamp',
      candles: [],
      entry_config: {
        initialEntry: 'none',
        trailingEntry: 'none',
        maxWaitTime: 60,
      },
      exit_config: {
        profit_targets: [],
        stop_loss: { initial: -0.25 },
      },
    };

    const validatedInput = SimInputSchema.parse(invalidInput);
    const result = await runDualSimulation(validatedInput);

    // Should still return TS result
    expect(result.tsResult).toBeDefined();
    // Python result should be error/empty
    expect(result.pythonResult).toBeDefined();
    // Parity should reflect failure
    expect(result.parity.parityScore).toBeLessThan(1);
  });
});

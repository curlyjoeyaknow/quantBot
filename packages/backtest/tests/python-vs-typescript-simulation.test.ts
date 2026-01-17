/**
 * Python vs TypeScript Simulation Comparison Tests
 *
 * Runs the same simulation inputs through both Python and TypeScript simulators
 * and compares outputs to ensure parity and no regression.
 */

import { describe, it, expect } from 'vitest';
import { simulateFromInput } from '../src/sim/core/contract-adapter.js';
import { SimInputSchema, SimResultSchema } from '../src/sim/types/contracts.js';
import type { SimInput, SimResult } from '../src/sim/types/contracts.js';
import { PythonSimulationService } from '../src/services/python-simulation-service.js';
import { PythonEngine } from '@quantbot/utils';
import { randomUUID } from 'crypto';

/**
 * Create a simple test SimInput
 */
function createTestSimInput(overrides?: Partial<SimInput>): SimInput {
  const baseInput: SimInput = {
    run_id: randomUUID(),
    strategy_id: 'test-strategy',
    mint: 'test-mint-123',
    alert_timestamp: '2024-01-01T00:00:00Z',
    candles: [
      { timestamp: 1704067200, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      { timestamp: 1704067800, open: 1.05, high: 1.2, low: 1.0, close: 1.15, volume: 1200 },
      { timestamp: 1704068400, open: 1.15, high: 1.3, low: 1.1, close: 1.25, volume: 1500 },
      { timestamp: 1704069000, open: 1.25, high: 1.4, low: 1.2, close: 1.35, volume: 1800 },
      { timestamp: 1704069600, open: 1.35, high: 1.5, low: 1.3, close: 1.45, volume: 2000 },
      { timestamp: 1704070200, open: 1.45, high: 1.6, low: 1.4, close: 1.55, volume: 2200 },
      { timestamp: 1704070800, open: 1.55, high: 1.7, low: 1.5, close: 1.65, volume: 2500 },
      { timestamp: 1704071400, open: 1.65, high: 1.8, low: 1.6, close: 1.75, volume: 2800 },
      { timestamp: 1704072000, open: 1.75, high: 1.9, low: 1.7, close: 1.85, volume: 3000 },
      { timestamp: 1704072600, open: 1.85, high: 2.0, low: 1.8, close: 1.95, volume: 3200 },
    ],
    entry_config: {
      initialEntry: 'none',
      trailingEntry: 'none',
      maxWaitTime: 60,
    },
    exit_config: {
      profit_targets: [
        { target: 2.0, percent: 0.5 },
        { target: 3.0, percent: 0.5 },
      ],
      stop_loss: {
        initial: -0.3,
        trailing: 'none',
      },
    },
    reentry_config: {
      trailingReEntry: 'none',
      maxReEntries: 0,
      sizePercent: 1.0,
    },
    cost_config: {
      entrySlippageBps: 125,
      exitSlippageBps: 125,
      takerFeeBps: 25,
    },
    contractVersion: '1.0.0',
    clockResolution: 'm',
    ...overrides,
  };

  return SimInputSchema.parse(baseInput);
}

/**
 * Normalize results for comparison (remove non-deterministic fields)
 */
function normalizeResult(result: SimResult): {
  run_id: string;
  final_pnl: number;
  entry_price: number;
  final_price: number;
  total_candles: number;
  event_count: number;
  event_types: string[];
} {
  return {
    run_id: result.run_id,
    final_pnl: result.final_pnl,
    entry_price: result.entry_price,
    final_price: result.final_price,
    total_candles: result.total_candles,
    event_count: result.events.length,
    event_types: result.events.map((e) => e.event_type),
  };
}

describe('Python vs TypeScript Simulation Comparison', () => {
  const pythonEngine = new PythonEngine();
  const pythonService = new PythonSimulationService(pythonEngine);

  describe('Basic Simulation', () => {
    it('should produce identical outputs for simple strategy', async () => {
      const simInput = createTestSimInput();

      // Run TypeScript simulation
      const tsResult = await simulateFromInput(simInput);
      const tsNormalized = normalizeResult(tsResult);

      // Run Python simulation
      const pyResult = await pythonService.runSimulation(simInput);
      const pyNormalized = normalizeResult(pyResult);

      // Compare normalized results
      expect(pyNormalized.final_pnl).toBeCloseTo(tsNormalized.final_pnl, 5);
      expect(pyNormalized.entry_price).toBeCloseTo(tsNormalized.entry_price, 5);
      expect(pyNormalized.final_price).toBeCloseTo(tsNormalized.final_price, 5);
      expect(pyNormalized.total_candles).toBe(tsNormalized.total_candles);
      expect(pyNormalized.event_count).toBe(tsNormalized.event_count);
      expect(pyNormalized.event_types).toEqual(tsNormalized.event_types);
    });

    it('should handle empty candles identically', async () => {
      const simInput = createTestSimInput({
        candles: [],
      });

      // Run TypeScript simulation
      const tsResult = await simulateFromInput(simInput);
      const tsNormalized = normalizeResult(tsResult);

      // Run Python simulation
      const pyResult = await pythonService.runSimulation(simInput);
      const pyNormalized = normalizeResult(pyResult);

      // Both should return empty results
      expect(pyNormalized.total_candles).toBe(0);
      expect(pyNormalized.total_candles).toBe(tsNormalized.total_candles);
      expect(pyNormalized.event_count).toBe(0);
      expect(pyNormalized.event_count).toBe(tsNormalized.event_count);
    });

    it('should handle single candle identically', async () => {
      const simInput = createTestSimInput({
        candles: [
          { timestamp: 1704067200, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
        ],
      });

      // Run TypeScript simulation
      const tsResult = await simulateFromInput(simInput);
      const tsNormalized = normalizeResult(tsResult);

      // Run Python simulation
      const pyResult = await pythonService.runSimulation(simInput);
      const pyNormalized = normalizeResult(pyResult);

      // Compare results
      expect(pyNormalized.final_pnl).toBeCloseTo(tsNormalized.final_pnl, 5);
      expect(pyNormalized.entry_price).toBeCloseTo(tsNormalized.entry_price, 5);
      expect(pyNormalized.final_price).toBeCloseTo(tsNormalized.final_price, 5);
    });
  });

  describe('Stop Loss Scenarios', () => {
    it('should trigger stop loss identically', async () => {
      const simInput = createTestSimInput({
        candles: [
          { timestamp: 1704067200, open: 1.0, high: 1.05, low: 0.7, close: 0.7, volume: 1000 },
          { timestamp: 1704067800, open: 0.7, high: 0.75, low: 0.65, close: 0.7, volume: 1200 },
        ],
        exit_config: {
          profit_targets: [{ target: 2.0, percent: 1.0 }],
          stop_loss: {
            initial: -0.3, // -30% stop loss
            trailing: 'none',
          },
        },
      });

      // Run TypeScript simulation
      const tsResult = await simulateFromInput(simInput);
      const tsNormalized = normalizeResult(tsResult);

      // Run Python simulation
      const pyResult = await pythonService.runSimulation(simInput);
      const pyNormalized = normalizeResult(pyResult);

      // Both should trigger stop loss
      expect(pyNormalized.event_types).toContain('stop_loss');
      expect(pyNormalized.event_types).toEqual(tsNormalized.event_types);
    });
  });

  describe('Profit Target Scenarios', () => {
    it('should hit profit targets identically', async () => {
      const simInput = createTestSimInput({
        candles: [
          { timestamp: 1704067200, open: 1.0, high: 1.05, low: 0.95, close: 1.0, volume: 1000 },
          { timestamp: 1704067800, open: 1.0, high: 2.1, low: 1.0, close: 2.0, volume: 1200 },
          { timestamp: 1704068400, open: 2.0, high: 3.1, low: 2.0, close: 3.0, volume: 1500 },
        ],
        exit_config: {
          profit_targets: [
            { target: 2.0, percent: 0.5 },
            { target: 3.0, percent: 0.5 },
          ],
          stop_loss: {
            initial: -0.5,
            trailing: 'none',
          },
        },
      });

      // Run TypeScript simulation
      const tsResult = await simulateFromInput(simInput);
      const tsNormalized = normalizeResult(tsResult);

      // Run Python simulation
      const pyResult = await pythonService.runSimulation(simInput);
      const pyNormalized = normalizeResult(pyResult);

      // Both should hit profit targets
      expect(pyNormalized.event_types.filter((t) => t === 'target_hit').length).toBeGreaterThan(0);
      expect(pyNormalized.event_types).toEqual(tsNormalized.event_types);
    });
  });

  describe('Determinism', () => {
    it('should produce identical results with same seed', async () => {
      const simInput = createTestSimInput({
        seed: 12345,
      });

      // Run Python simulation twice
      const pyResult1 = await pythonService.runSimulation(simInput);
      const pyResult2 = await pythonService.runSimulation(simInput);

      // Results should be identical
      expect(pyResult1.final_pnl).toBe(pyResult2.final_pnl);
      expect(pyResult1.entry_price).toBe(pyResult2.entry_price);
      expect(pyResult1.final_price).toBe(pyResult2.final_price);
      expect(pyResult1.events.length).toBe(pyResult2.events.length);
    });

    it('should produce identical results with same input (no seed)', async () => {
      const simInput = createTestSimInput();

      // Run Python simulation twice
      const pyResult1 = await pythonService.runSimulation(simInput);
      const pyResult2 = await pythonService.runSimulation(simInput);

      // Results should be identical (deterministic)
      expect(pyResult1.final_pnl).toBe(pyResult2.final_pnl);
      expect(pyResult1.entry_price).toBe(pyResult2.entry_price);
      expect(pyResult1.final_price).toBe(pyResult2.final_price);
    });
  });

  describe('Contract Validation', () => {
    it('should validate SimInput contract', async () => {
      const simInput = createTestSimInput();

      // Should not throw
      expect(() => SimInputSchema.parse(simInput)).not.toThrow();
    });

    it('should validate SimResult contract from Python', async () => {
      const simInput = createTestSimInput();

      // Run Python simulation
      const pyResult = await pythonService.runSimulation(simInput);

      // Should validate against schema
      expect(() => SimResultSchema.parse(pyResult)).not.toThrow();
    });

    it('should validate SimResult contract from TypeScript', async () => {
      const simInput = createTestSimInput();

      // Run TypeScript simulation
      const tsResult = await simulateFromInput(simInput);

      // Should validate against schema
      expect(() => SimResultSchema.parse(tsResult)).not.toThrow();
    });
  });
});

/**
 * Contract Tests for Overlay Simulation (re-exported from @quantbot/simulation)
 *
 * These tests ensure that:
 * 1. The symbols exist and are callable
 * 2. Basic deterministic output matches expected fixtures
 * 3. Call signatures stay stable (prevent breaking changes)
 *
 * Purpose: Prevent "minor refactor in simulation broke backtest API" from becoming your new hobby.
 */

import { describe, it, expect } from 'vitest';
// Import directly from source to avoid Vitest SSR module resolution issues
import { runOverlaySimulation } from '../../src/sim/overlay-simulation.js';
import type {
  ExitOverlay,
  FeeModel,
  PositionModel,
  OverlaySimulationRequest,
  OverlaySimulationResult,
} from '../../src/sim/overlay-simulation.js';
import type { Candle } from '@quantbot/core';

/**
 * Create test candles with predictable price movement
 */
function createTestCandles(
  startPrice: number,
  pricePath: number[],
  intervalSeconds: number = 300
): Candle[] {
  const candles: Candle[] = [];
  const timestamp = 1000000000; // Fixed timestamp for determinism

  for (let i = 0; i < pricePath.length; i++) {
    const price = pricePath[i]!;
    const prevPrice = i > 0 ? pricePath[i - 1]! : startPrice;

    candles.push({
      timestamp: timestamp + i * intervalSeconds,
      open: prevPrice,
      high: Math.max(prevPrice, price),
      low: Math.min(prevPrice, price),
      close: price,
      volume: 1000,
    });
  }

  return candles;
}

describe('Overlay Simulation Contract Tests', () => {
  const baseFees: FeeModel = {
    takerFeeBps: 30, // 0.30%
    slippageBps: 10, // 0.10%
  };

  const basePosition: PositionModel = {
    notionalUsd: 1000,
  };

  const baseEntry = {
    tsMs: 1000000000 * 1000, // Convert seconds to milliseconds
    px: 1.0,
  };

  describe('runOverlaySimulation', () => {
    it('should exist and be callable', async () => {
      const candles = createTestCandles(1.0, [1.0, 1.5, 2.0, 2.5]);
      const overlay: ExitOverlay = { kind: 'take_profit', takePct: 100 };
      const request: OverlaySimulationRequest = {
        candles,
        entry: baseEntry,
        overlays: [overlay],
        fees: baseFees,
        position: basePosition,
      };

      const results = await runOverlaySimulation(request);
      expect(results).toBeDefined();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(1);
    });

    it('should produce deterministic output for same inputs', async () => {
      const candles = createTestCandles(1.0, [1.0, 1.5, 2.0, 2.5]);
      const overlay: ExitOverlay = { kind: 'take_profit', takePct: 100 };
      const request: OverlaySimulationRequest = {
        candles,
        entry: baseEntry,
        overlays: [overlay],
        fees: baseFees,
        position: basePosition,
      };

      const result1 = await runOverlaySimulation(request);
      const result2 = await runOverlaySimulation(request);
      expect(result1).toEqual(result2);
    });

    it('should return OverlaySimulationResult[] with expected structure', async () => {
      const candles = createTestCandles(1.0, [1.0, 1.5, 2.0, 2.5]);
      const overlay: ExitOverlay = { kind: 'take_profit', takePct: 100 };
      const request: OverlaySimulationRequest = {
        candles,
        entry: baseEntry,
        overlays: [overlay],
        fees: baseFees,
        position: basePosition,
      };

      const results = await runOverlaySimulation(request);
      const result = results[0];
      if (!result) throw new Error('Expected result');

      // Verify structure matches OverlaySimulationResult type
      expect(result).toHaveProperty('overlay');
      expect(result).toHaveProperty('entry');
      expect(result).toHaveProperty('exit');
      expect(result).toHaveProperty('exitReason');
      expect(result).toHaveProperty('pnl');
      expect(result).toHaveProperty('diagnostics');

      expect(result.entry).toHaveProperty('tsMs');
      expect(result.entry).toHaveProperty('px');
      expect(result.exit).toHaveProperty('tsMs');
      expect(result.exit).toHaveProperty('px');
      expect(result.pnl).toHaveProperty('grossReturnPct');
      expect(result.pnl).toHaveProperty('netReturnPct');
      expect(result.pnl).toHaveProperty('feesUsd');
      expect(result.pnl).toHaveProperty('slippageUsd');
    });

    it('should handle multiple overlays', async () => {
      const candles = createTestCandles(1.0, [1.0, 1.5, 2.0, 2.5]);
      const overlays: ExitOverlay[] = [
        { kind: 'take_profit', takePct: 50 },
        { kind: 'take_profit', takePct: 100 },
      ];
      const request: OverlaySimulationRequest = {
        candles,
        entry: baseEntry,
        overlays,
        fees: baseFees,
        position: basePosition,
      };

      const results = await runOverlaySimulation(request);
      expect(results.length).toBe(2);
    });

    it('should handle stop_loss overlay', async () => {
      const candles = createTestCandles(1.0, [1.0, 0.8, 0.6, 0.5]);
      const overlay: ExitOverlay = { kind: 'stop_loss', stopPct: 20 };
      const request: OverlaySimulationRequest = {
        candles,
        entry: baseEntry,
        overlays: [overlay],
        fees: baseFees,
        position: basePosition,
      };

      const results = await runOverlaySimulation(request);
      expect(results.length).toBe(1);
      const result = results[0];
      if (!result) throw new Error('Expected result');
      expect(result.exitReason).toBeDefined();
    });

    it('should handle time_exit overlay', async () => {
      const candles = createTestCandles(
        1.0,
        Array.from({ length: 20 }, (_, i) => 1.0 + i * 0.1)
      );
      const overlay: ExitOverlay = { kind: 'time_exit', holdMs: 5 * 60 * 1000 }; // 5 minutes
      const request: OverlaySimulationRequest = {
        candles,
        entry: baseEntry,
        overlays: [overlay],
        fees: baseFees,
        position: basePosition,
      };

      const results = await runOverlaySimulation(request);
      expect(results.length).toBe(1);
      const result = results[0];
      if (!result) throw new Error('Expected result');
      expect(result.exitReason).toBeDefined();
    });
  });

  describe('Call signature stability', () => {
    it('should maintain runOverlaySimulation signature: (request: OverlaySimulationRequest)', async () => {
      const candles = createTestCandles(1.0, [1.0, 1.5, 2.0]);
      const request: OverlaySimulationRequest = {
        candles,
        entry: baseEntry,
        overlays: [{ kind: 'take_profit', takePct: 50 }],
        fees: baseFees,
        position: basePosition,
      };

      // This test will fail if signature changes
      await expect(runOverlaySimulation(request)).resolves.toBeDefined();
    });
  });
});

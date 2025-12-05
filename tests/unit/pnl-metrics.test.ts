import { describe, it, expect } from 'vitest';
import { calculatePnLMetrics, type PnLMetrics } from '../../src/analysis/metrics/pnl-metrics';
import type { SimulationResult } from '../../src/simulation/engine';

describe('pnl-metrics', () => {
  const createMockResult = (overrides: Partial<SimulationResult>): SimulationResult => ({
    mint: 'test-mint',
    chain: 'solana',
    entryPrice: 1.0,
    exitPrice: 1.0,
    finalPnl: 1.0,
    entryTime: 1000,
    exitTime: 2000,
    events: [],
    trades: [],
    ...overrides,
  });

  describe('calculatePnLMetrics', () => {
    it('should return zero metrics for empty results', () => {
      const metrics = calculatePnLMetrics([]);

      expect(metrics).toEqual({
        totalPnl: 0,
        totalPnlPercent: 0,
        averagePnl: 0,
        averagePnlPercent: 0,
        medianPnl: 0,
        bestTrade: 0,
        worstTrade: 0,
        profitableTrades: 0,
        losingTrades: 0,
        breakEvenTrades: 0,
      });
    });

    it('should calculate total PnL correctly', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0 }), // +1.0
        createMockResult({ finalPnl: 1.5 }), // +0.5
        createMockResult({ finalPnl: 0.5 }), // -0.5
      ];

      const metrics = calculatePnLMetrics(results);

      // Total PnL: (2.0 - 1) + (1.5 - 1) + (0.5 - 1) = 1.0 + 0.5 - 0.5 = 1.0
      expect(metrics.totalPnl).toBeCloseTo(1.0, 2);
    });

    it('should calculate total PnL percent correctly', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0 }), // +100%
        createMockResult({ finalPnl: 1.5 }), // +50%
        createMockResult({ finalPnl: 0.5 }), // -50%
      ];

      const metrics = calculatePnLMetrics(results);

      // Total PnL %: ((100 + 50 - 50) / 3) = 33.33%
      expect(metrics.totalPnlPercent).toBeCloseTo(33.33, 1);
    });

    it('should calculate average PnL correctly', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0 }),
        createMockResult({ finalPnl: 1.5 }),
        createMockResult({ finalPnl: 0.5 }),
      ];

      const metrics = calculatePnLMetrics(results);

      // Average: (2.0 + 1.5 + 0.5) / 3 = 1.33
      expect(metrics.averagePnl).toBeCloseTo(1.33, 2);
    });

    it('should calculate average PnL percent correctly', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0 }), // +100%
        createMockResult({ finalPnl: 1.5 }), // +50%
        createMockResult({ finalPnl: 0.5 }), // -50%
      ];

      const metrics = calculatePnLMetrics(results);

      // Average %: (100 + 50 - 50) / 3 = 33.33%
      expect(metrics.averagePnlPercent).toBeCloseTo(33.33, 1);
    });

    it('should calculate median PnL correctly for odd number of trades', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 0.5 }),
        createMockResult({ finalPnl: 1.0 }),
        createMockResult({ finalPnl: 2.0 }),
      ];

      const metrics = calculatePnLMetrics(results);

      // Sorted: [0.5, 1.0, 2.0], Median: 1.0
      expect(metrics.medianPnl).toBe(1.0);
    });

    it('should calculate median PnL correctly for even number of trades', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 0.5 }),
        createMockResult({ finalPnl: 1.0 }),
        createMockResult({ finalPnl: 1.5 }),
        createMockResult({ finalPnl: 2.0 }),
      ];

      const metrics = calculatePnLMetrics(results);

      // Sorted: [0.5, 1.0, 1.5, 2.0], Median: (1.0 + 1.5) / 2 = 1.25
      expect(metrics.medianPnl).toBe(1.25);
    });

    it('should identify best trade correctly', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 1.5 }),
        createMockResult({ finalPnl: 3.0 }), // Best
        createMockResult({ finalPnl: 0.8 }),
      ];

      const metrics = calculatePnLMetrics(results);

      expect(metrics.bestTrade).toBe(3.0);
    });

    it('should identify worst trade correctly', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 1.5 }),
        createMockResult({ finalPnl: 0.2 }), // Worst
        createMockResult({ finalPnl: 0.8 }),
      ];

      const metrics = calculatePnLMetrics(results);

      expect(metrics.worstTrade).toBe(0.2);
    });

    it('should count profitable trades correctly', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0 }), // Profitable
        createMockResult({ finalPnl: 1.5 }), // Profitable
        createMockResult({ finalPnl: 0.5 }), // Losing
        createMockResult({ finalPnl: 1.0 }), // Break even
      ];

      const metrics = calculatePnLMetrics(results);

      expect(metrics.profitableTrades).toBe(2);
    });

    it('should count losing trades correctly', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0 }), // Profitable
        createMockResult({ finalPnl: 0.5 }), // Losing
        createMockResult({ finalPnl: 0.8 }), // Losing
        createMockResult({ finalPnl: 1.0 }), // Break even
      ];

      const metrics = calculatePnLMetrics(results);

      expect(metrics.losingTrades).toBe(2);
    });

    it('should count break even trades correctly', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0 }), // Profitable
        createMockResult({ finalPnl: 0.5 }), // Losing
        createMockResult({ finalPnl: 1.0 }), // Break even
        createMockResult({ finalPnl: 1.0 }), // Break even
      ];

      const metrics = calculatePnLMetrics(results);

      expect(metrics.breakEvenTrades).toBe(2);
    });

    it('should handle all profitable trades', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 1.5 }),
        createMockResult({ finalPnl: 2.0 }),
        createMockResult({ finalPnl: 1.2 }),
      ];

      const metrics = calculatePnLMetrics(results);

      expect(metrics.profitableTrades).toBe(3);
      expect(metrics.losingTrades).toBe(0);
      expect(metrics.breakEvenTrades).toBe(0);
    });

    it('should handle all losing trades', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 0.5 }),
        createMockResult({ finalPnl: 0.8 }),
        createMockResult({ finalPnl: 0.2 }),
      ];

      const metrics = calculatePnLMetrics(results);

      expect(metrics.profitableTrades).toBe(0);
      expect(metrics.losingTrades).toBe(3);
      expect(metrics.breakEvenTrades).toBe(0);
    });

    it('should handle all break even trades', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 1.0 }),
        createMockResult({ finalPnl: 1.0 }),
        createMockResult({ finalPnl: 1.0 }),
      ];

      const metrics = calculatePnLMetrics(results);

      expect(metrics.profitableTrades).toBe(0);
      expect(metrics.losingTrades).toBe(0);
      expect(metrics.breakEvenTrades).toBe(3);
      expect(metrics.totalPnl).toBe(0);
    });

    it('should handle large number of trades', () => {
      const results: SimulationResult[] = Array.from({ length: 1000 }, (_, i) =>
        createMockResult({ finalPnl: 1.0 + (i % 10) * 0.1 })
      );

      const metrics = calculatePnLMetrics(results);

      expect(results.length).toBe(1000);
      expect(metrics.averagePnl).toBeGreaterThan(1.0);
      expect(metrics.bestTrade).toBeGreaterThan(metrics.worstTrade);
    });

    it('should handle negative total PnL', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 0.5 }), // -0.5
        createMockResult({ finalPnl: 0.8 }), // -0.2
      ];

      const metrics = calculatePnLMetrics(results);

      // Total PnL: (0.5 - 1) + (0.8 - 1) = -0.5 - 0.2 = -0.7
      expect(metrics.totalPnl).toBeCloseTo(-0.7, 2);
      expect(metrics.totalPnlPercent).toBeLessThan(0);
    });
  });
});


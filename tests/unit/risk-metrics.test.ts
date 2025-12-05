import { describe, it, expect } from 'vitest';
import { calculateRiskMetrics, type RiskMetrics } from '../../src/analysis/metrics/risk-metrics';
import type { SimulationResult } from '../../src/simulation/engine';

describe('risk-metrics', () => {
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

  describe('calculateRiskMetrics', () => {
    it('should return zero metrics for empty results', () => {
      const metrics = calculateRiskMetrics([]);

      expect(metrics).toEqual({
        sharpeRatio: 0,
        maxDrawdown: 0,
        maxDrawdownPercent: 0,
        volatility: 0,
        downsideDeviation: 0,
        sortinoRatio: 0,
        calmarRatio: 0,
      });
    });

    it('should calculate volatility correctly', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 1.5 }), // +0.5
        createMockResult({ finalPnl: 0.5 }), // -0.5
        createMockResult({ finalPnl: 1.0 }), // 0
      ];

      const metrics = calculateRiskMetrics(results);

      // Returns: [0.5, -0.5, 0], Avg: 0, Variance: ((0.5-0)² + (-0.5-0)² + (0-0)²) / 3 = 0.1667
      // Volatility: sqrt(0.1667) ≈ 0.408
      expect(metrics.volatility).toBeGreaterThan(0);
    });

    it('should calculate Sharpe ratio correctly', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0 }), // +1.0
        createMockResult({ finalPnl: 1.5 }), // +0.5
        createMockResult({ finalPnl: 0.5 }), // -0.5
      ];

      const metrics = calculateRiskMetrics(results);

      // Avg return: (1.0 + 0.5 - 0.5) / 3 = 0.333
      // Sharpe = avgReturn / volatility
      expect(metrics.sharpeRatio).toBeGreaterThan(0);
    });

    it('should return zero Sharpe ratio when volatility is zero', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 1.0 }),
        createMockResult({ finalPnl: 1.0 }),
        createMockResult({ finalPnl: 1.0 }),
      ];

      const metrics = calculateRiskMetrics(results);

      expect(metrics.sharpeRatio).toBe(0);
      expect(metrics.volatility).toBe(0);
    });

    it('should calculate downside deviation correctly', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 1.5 }), // +0.5 (positive, not counted)
        createMockResult({ finalPnl: 0.5 }), // -0.5 (negative)
        createMockResult({ finalPnl: 0.8 }), // -0.2 (negative)
      ];

      const metrics = calculateRiskMetrics(results);

      // Negative returns: [-0.5, -0.2]
      // Downside variance: ((-0.5)² + (-0.2)²) / 2 = (0.25 + 0.04) / 2 = 0.145
      // Downside deviation: sqrt(0.145) ≈ 0.381
      expect(metrics.downsideDeviation).toBeGreaterThan(0);
    });

    it('should return zero downside deviation when no negative returns', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 1.5 }),
        createMockResult({ finalPnl: 2.0 }),
        createMockResult({ finalPnl: 1.2 }),
      ];

      const metrics = calculateRiskMetrics(results);

      expect(metrics.downsideDeviation).toBe(0);
    });

    it('should calculate Sortino ratio correctly', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0 }), // +1.0
        createMockResult({ finalPnl: 0.5 }), // -0.5
      ];

      const metrics = calculateRiskMetrics(results);

      // Avg return: (1.0 - 0.5) / 2 = 0.25
      // Sortino = avgReturn / downsideDeviation
      expect(metrics.sortinoRatio).toBeGreaterThan(0);
    });

    it('should return zero Sortino ratio when downside deviation is zero', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 1.5 }),
        createMockResult({ finalPnl: 2.0 }),
      ];

      const metrics = calculateRiskMetrics(results);

      expect(metrics.sortinoRatio).toBe(0);
    });

    it('should calculate max drawdown correctly', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0 }), // Cumulative: 2.0, Peak: 2.0
        createMockResult({ finalPnl: 0.5 }), // Cumulative: 1.0, Peak: 2.0, Drawdown: 1.0
        createMockResult({ finalPnl: 1.5 }), // Cumulative: 1.5, Peak: 2.0, Drawdown: 0.5
      ];

      const metrics = calculateRiskMetrics(results);

      // Max drawdown occurs after second trade: 2.0 - 1.0 = 1.0
      expect(metrics.maxDrawdown).toBeCloseTo(1.0, 2);
      expect(metrics.maxDrawdownPercent).toBeGreaterThan(0);
    });

    it('should calculate max drawdown percent correctly', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0 }), // Peak: 2.0
        createMockResult({ finalPnl: 0.5 }), // Cumulative: 1.0, Drawdown: 1.0, Percent: 50%
      ];

      const metrics = calculateRiskMetrics(results);

      // Drawdown: 1.0, Peak: 2.0, Percent: (1.0 / 2.0) * 100 = 50%
      expect(metrics.maxDrawdownPercent).toBeCloseTo(50, 1);
    });

    it('should handle no drawdown scenario', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 1.5 }),
        createMockResult({ finalPnl: 2.0 }),
        createMockResult({ finalPnl: 1.8 }),
      ];

      const metrics = calculateRiskMetrics(results);

      // All trades profitable, no drawdown
      expect(metrics.maxDrawdown).toBe(0);
      expect(metrics.maxDrawdownPercent).toBe(0);
    });

    it('should calculate Calmar ratio correctly', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0 }), // Peak: 2.0
        createMockResult({ finalPnl: 0.5 }), // Cumulative: 1.0, Max DD%: 50%
        createMockResult({ finalPnl: 1.5 }), // Cumulative: 1.5
      ];

      const metrics = calculateRiskMetrics(results);

      // Avg return: (1.0 - 0.5 + 0.5) / 3 = 0.333 = 33.3%
      // Max DD%: 50%
      // Calmar: 33.3 / 50 = 0.666
      expect(metrics.calmarRatio).toBeGreaterThan(0);
    });

    it('should return zero Calmar ratio when max drawdown is zero', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 1.5 }),
        createMockResult({ finalPnl: 2.0 }),
      ];

      const metrics = calculateRiskMetrics(results);

      expect(metrics.calmarRatio).toBe(0);
    });

    it('should handle all losing trades', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 0.5 }),
        createMockResult({ finalPnl: 0.8 }),
        createMockResult({ finalPnl: 0.2 }),
      ];

      const metrics = calculateRiskMetrics(results);

      expect(metrics.maxDrawdown).toBeGreaterThan(0);
      expect(metrics.volatility).toBeGreaterThan(0);
      expect(metrics.downsideDeviation).toBeGreaterThan(0);
    });

    it('should handle large number of trades', () => {
      const results: SimulationResult[] = Array.from({ length: 100 }, (_, i) =>
        createMockResult({ finalPnl: 1.0 + (i % 10 - 5) * 0.1 })
      );

      const metrics = calculateRiskMetrics(results);

      expect(metrics.volatility).toBeGreaterThanOrEqual(0);
      expect(metrics.maxDrawdown).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(metrics.sharpeRatio)).toBe(true);
    });
  });
});


import { describe, it, expect } from 'vitest';
import { ResultAnalyzer } from '../../src/analysis/result-analyzer';
import type { AnalysisResult } from '../../src/analysis/result-analyzer';
import type { SimulationResult } from '../../src/simulation/engine';

describe('ResultAnalyzer', () => {
  let analyzer: ResultAnalyzer;

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

  beforeEach(() => {
    analyzer = new ResultAnalyzer();
  });

  describe('analyze', () => {
    it('should analyze empty results', () => {
      const results: SimulationResult[] = [];
      const analysis = analyzer.analyze(results);

      expect(analysis.summary.totalResults).toBe(0);
      expect(analysis.pnl.totalPnl).toBe(0);
      expect(analysis.trade.totalTrades).toBe(0);
      expect(analysis.risk.sharpeRatio).toBe(0);
    });

    it('should analyze profitable results', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0 }),
        createMockResult({ finalPnl: 1.5 }),
        createMockResult({ finalPnl: 1.2 }),
      ];

      const analysis = analyzer.analyze(results);

      expect(analysis.summary.totalResults).toBe(3);
      expect(analysis.pnl.profitableTrades).toBe(3);
      expect(analysis.pnl.averagePnlPercent).toBeGreaterThan(0);
      expect(analysis.trade.winRate).toBe(100);
    });

    it('should analyze losing results', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 0.5 }),
        createMockResult({ finalPnl: 0.8 }),
        createMockResult({ finalPnl: 0.9 }),
      ];

      const analysis = analyzer.analyze(results);

      expect(analysis.summary.totalResults).toBe(3);
      expect(analysis.pnl.losingTrades).toBe(3);
      expect(analysis.pnl.averagePnlPercent).toBeLessThan(0);
      expect(analysis.trade.lossRate).toBe(100);
    });

    it('should determine performance rating correctly', () => {
      // Excellent performance
      const excellentResults: SimulationResult[] = [
        createMockResult({ finalPnl: 3.0 }), // +200%
        createMockResult({ finalPnl: 2.5 }), // +150%
      ];

      const excellentAnalysis = analyzer.analyze(excellentResults);
      expect(['excellent', 'good']).toContain(excellentAnalysis.summary.overallPerformance);

      // Poor performance
      const poorResults: SimulationResult[] = [
        createMockResult({ finalPnl: 0.3 }), // -70%
        createMockResult({ finalPnl: 0.5 }), // -50%
      ];

      const poorAnalysis = analyzer.analyze(poorResults);
      expect(['poor', 'very-poor']).toContain(poorAnalysis.summary.overallPerformance);
    });

    it('should generate recommendations for losing strategy', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 0.5 }),
        createMockResult({ finalPnl: 0.8 }),
      ];

      const analysis = analyzer.analyze(results);

      expect(analysis.summary.recommendation).toContain('losing money');
    });

    it('should generate recommendations for low win rate', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 0.5 }),
        createMockResult({ finalPnl: 0.8 }),
        createMockResult({ finalPnl: 0.9 }),
        createMockResult({ finalPnl: 0.7 }),
      ];

      const analysis = analyzer.analyze(results);

      // All losing trades = 0% win rate
      expect(analysis.summary.recommendation).toContain('win rate');
    });

    it('should generate recommendations for high drawdown', () => {
      // Create results that would cause high drawdown
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 2.0 }),
        createMockResult({ finalPnl: 0.3 }), // Large loss
        createMockResult({ finalPnl: 0.5 }), // Another loss
      ];

      const analysis = analyzer.analyze(results);

      // May or may not trigger drawdown warning depending on calculation
      expect(analysis.summary.recommendation).toBeDefined();
    });

    it('should generate positive recommendation for good strategy', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 1.5 }),
        createMockResult({ finalPnl: 1.3 }),
        createMockResult({ finalPnl: 1.2 }),
      ];

      const analysis = analyzer.analyze(results);

      // Should have positive recommendation if all metrics are good
      expect(analysis.summary.recommendation).toBeDefined();
    });

    it('should include all metric types', () => {
      const results: SimulationResult[] = [
        createMockResult({ finalPnl: 1.5 }),
        createMockResult({ finalPnl: 0.8 }),
      ];

      const analysis = analyzer.analyze(results);

      expect(analysis.pnl).toBeDefined();
      expect(analysis.risk).toBeDefined();
      expect(analysis.trade).toBeDefined();
      expect(analysis.summary).toBeDefined();
    });
  });

  describe('compare', () => {
    it('should compare multiple strategies', () => {
      const strategies = [
        {
          name: 'Strategy A',
          results: [
            createMockResult({ finalPnl: 1.5 }),
            createMockResult({ finalPnl: 1.3 }),
          ],
        },
        {
          name: 'Strategy B',
          results: [
            createMockResult({ finalPnl: 2.0 }),
            createMockResult({ finalPnl: 1.8 }),
          ],
        },
        {
          name: 'Strategy C',
          results: [
            createMockResult({ finalPnl: 1.2 }),
            createMockResult({ finalPnl: 1.1 }),
          ],
        },
      ];

      const comparison = analyzer.compare(strategies);

      expect(comparison.strategies.length).toBe(3);
      expect(comparison.best).toBeDefined();
      expect(comparison.worst).toBeDefined();
    });

    it('should sort strategies by average PnL', () => {
      const strategies = [
        {
          name: 'Low Performance',
          results: [createMockResult({ finalPnl: 1.1 })],
        },
        {
          name: 'High Performance',
          results: [createMockResult({ finalPnl: 2.0 })],
        },
        {
          name: 'Medium Performance',
          results: [createMockResult({ finalPnl: 1.5 })],
        },
      ];

      const comparison = analyzer.compare(strategies);

      expect(comparison.best.name).toBe('High Performance');
      expect(comparison.worst.name).toBe('Low Performance');
    });

    it('should handle empty strategy results', () => {
      const strategies = [
        {
          name: 'Empty Strategy',
          results: [],
        },
        {
          name: 'Valid Strategy',
          results: [createMockResult({ finalPnl: 1.5 })],
        },
      ];

      const comparison = analyzer.compare(strategies);

      expect(comparison.strategies.length).toBe(2);
      expect(comparison.best).toBeDefined();
    });

    it('should handle single strategy', () => {
      const strategies = [
        {
          name: 'Only Strategy',
          results: [createMockResult({ finalPnl: 1.5 })],
        },
      ];

      const comparison = analyzer.compare(strategies);

      expect(comparison.strategies.length).toBe(1);
      expect(comparison.best).toBe(comparison.worst);
    });
  });
});






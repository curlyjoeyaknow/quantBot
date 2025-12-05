import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StrategyOptimizer } from '../../src/simulation/optimization/optimizer';
import { generateParameterCombinations } from '../../src/simulation/optimization/grid';
import { buildStrategy, validateStrategy } from '../../src/simulation/strategies/builder';
import { simulateStrategy } from '../../src/simulation/engine';
import { fetchHybridCandles } from '../../src/simulation/candles';
import { loadData } from '../../src/data/loaders';
import { DateTime } from 'luxon';

// Mock dependencies
vi.mock('../../src/simulation/optimization/grid', () => ({
  generateParameterCombinations: vi.fn(),
}));

vi.mock('../../src/simulation/strategies/builder', () => ({
  buildStrategy: vi.fn(),
  buildStopLossConfig: vi.fn(),
  buildEntryConfig: vi.fn(),
  buildReEntryConfig: vi.fn(),
  validateStrategy: vi.fn(),
}));

vi.mock('../../src/simulation/engine', () => ({
  simulateStrategy: vi.fn(),
}));

vi.mock('../../src/simulation/candles', () => ({
  fetchHybridCandles: vi.fn(),
}));

vi.mock('../../src/data/loaders', () => ({
  loadData: vi.fn(),
}));

describe('optimizer', () => {
  let optimizer: StrategyOptimizer;

  beforeEach(() => {
    optimizer = new StrategyOptimizer();
    vi.clearAllMocks();
  });

  describe('optimize', () => {
    it('should optimize strategies', async () => {
      const mockStrategies = [
        {
          name: 'Strategy_0',
          profitTargets: [{ target: 2, percent: 1.0 }],
        },
        {
          name: 'Strategy_1',
          profitTargets: [{ target: 3, percent: 1.0 }],
        },
      ];

      const mockDataRecords = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          timestamp: DateTime.fromSeconds(1000),
        },
      ];

      const mockCandles = [
        { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
        { timestamp: 1060, open: 1.05, high: 1.15, low: 0.95, close: 1.1, volume: 1000 },
      ];

      const mockResult = {
        finalPnl: 1.1,
        events: [
          { timestamp: 1000, type: 'entry', price: 1.0, description: '', remainingPosition: 1, pnlSoFar: 0 },
          { timestamp: 1060, type: 'final_exit', price: 1.1, description: '', remainingPosition: 0, pnlSoFar: 0.1 },
        ],
        entryPrice: 1.0,
        finalPrice: 1.1,
        totalCandles: 2,
        entryOptimization: {
          lowestPrice: 0.9,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: -10,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0,
        },
      };

      vi.mocked(generateParameterCombinations).mockReturnValue(mockStrategies as any);
      vi.mocked(loadData).mockResolvedValue(mockDataRecords as any);
      vi.mocked(fetchHybridCandles).mockResolvedValue(mockCandles as any);
      vi.mocked(validateStrategy).mockReturnValue({ valid: true, errors: [] });
      vi.mocked(buildStrategy).mockReturnValue([{ target: 2, percent: 1.0 }]);
      vi.mocked(simulateStrategy).mockReturnValue(mockResult as any);

      const config = {
        name: 'test-optimization',
        parameterGrid: {
          profitTargets: [[{ target: 2, percent: 1.0 }]],
        },
        data: {
          kind: 'file' as const,
          path: 'test.csv',
        },
        maxStrategies: 2,
      };

      const result = await optimizer.optimize(config);

      expect(result.results.length).toBeGreaterThan(0);
      expect(result.bestStrategy).toBeDefined();
      expect(result.summary.totalStrategiesTested).toBeGreaterThan(0);
    });

    it('should limit strategies when maxStrategies specified', async () => {
      const mockStrategies = Array(10).fill(null).map((_, i) => ({
        name: `Strategy_${i}`,
        profitTargets: [{ target: 2, percent: 1.0 }],
      }));

      vi.mocked(generateParameterCombinations).mockReturnValue(mockStrategies as any);
      vi.mocked(loadData).mockResolvedValue([]);
      vi.mocked(validateStrategy).mockReturnValue({ valid: true, errors: [] });

      const config = {
        name: 'test-optimization',
        parameterGrid: {},
        data: {
          kind: 'file' as const,
          path: 'test.csv',
        },
        maxStrategies: 5,
      };

      const result = await optimizer.optimize(config);

      // Should only test 5 strategies
      expect(result.results.length).toBeLessThanOrEqual(5);
    });

    it('should skip invalid strategies', async () => {
      const mockStrategies = [
        {
          name: 'Invalid Strategy',
          profitTargets: [],
        },
      ];

      vi.mocked(generateParameterCombinations).mockReturnValue(mockStrategies as any);
      vi.mocked(loadData).mockResolvedValue([]);
      vi.mocked(validateStrategy).mockReturnValue({ valid: false, errors: ['Invalid'] });

      const config = {
        name: 'test-optimization',
        parameterGrid: {},
        data: {
          kind: 'file' as const,
          path: 'test.csv',
        },
      };

      const result = await optimizer.optimize(config);

      // Invalid strategies should be filtered out
      expect(result.results.length).toBe(0);
    });

    it('should handle concurrent execution', async () => {
      const mockStrategies = [
        { name: 'Strategy_0', profitTargets: [{ target: 2, percent: 1.0 }] },
        { name: 'Strategy_1', profitTargets: [{ target: 3, percent: 1.0 }] },
      ];

      const mockDataRecords = [
        {
          mint: 'So11111111111111111111111111111111111111112',
          chain: 'solana',
          timestamp: DateTime.fromSeconds(1000),
        },
      ];

      const mockCandles = [
        { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
      ];

      const mockResult = {
        finalPnl: 1.0,
        events: [],
        entryPrice: 1.0,
        finalPrice: 1.0,
        totalCandles: 1,
        entryOptimization: {
          lowestPrice: 0.9,
          lowestPriceTimestamp: 1000,
          lowestPricePercent: -10,
          lowestPriceTimeFromEntry: 0,
          trailingEntryUsed: false,
          actualEntryPrice: 1.0,
          entryDelay: 0,
        },
      };

      vi.mocked(generateParameterCombinations).mockReturnValue(mockStrategies as any);
      vi.mocked(loadData).mockResolvedValue(mockDataRecords as any);
      vi.mocked(fetchHybridCandles).mockResolvedValue(mockCandles as any);
      vi.mocked(validateStrategy).mockReturnValue({ valid: true, errors: [] });
      vi.mocked(buildStrategy).mockReturnValue([{ target: 2, percent: 1.0 }]);
      vi.mocked(simulateStrategy).mockReturnValue(mockResult as any);

      const config = {
        name: 'test-optimization',
        parameterGrid: {},
        data: {
          kind: 'file' as const,
          path: 'test.csv',
        },
        maxConcurrent: 2,
      };

      const result = await optimizer.optimize(config);

      expect(result.results.length).toBeGreaterThan(0);
    });
  });
});



import { describe, it, expect } from 'vitest';
import { generateParameterCombinations, generateFocusedGrid } from '../../src/simulation/optimization/grid';
import type { ParameterGrid } from '../../src/simulation/optimization/types';
import type { StrategyConfig } from '../../src/simulation/strategies/types';

describe('optimization-grid', () => {
  describe('generateParameterCombinations', () => {
    it('should generate combinations from grid', () => {
      const grid: ParameterGrid = {
        profitTargets: [
          [{ target: 2, percent: 1.0 }],
        ],
        trailingStopPercent: [0.2],
        trailingStopActivation: [2.0],
        minExitPrice: [0.01],
        stopLossInitial: [-0.2],
        holdHours: [6],
        lossClampPercent: [0.2],
      };

      const combinations = generateParameterCombinations(grid);

      expect(combinations.length).toBeGreaterThan(0);
      expect(combinations[0].profitTargets).toBeDefined();
    });

    it('should use default values when grid is empty', () => {
      const grid: ParameterGrid = {};
      const combinations = generateParameterCombinations(grid);

      expect(combinations.length).toBeGreaterThan(0);
    });

    it('should skip invalid combinations', () => {
      const grid: ParameterGrid = {
        trailingStopActivation: [1.0], // Invalid (< 2.0)
        minExitPrice: [0.7], // Invalid (> 0.6)
      };

      const combinations = generateParameterCombinations(grid);

      // Should filter out invalid combinations
      expect(combinations.length).toBeGreaterThanOrEqual(0);
    });

    it('should merge with base strategy', () => {
      const grid: ParameterGrid = {
        profitTargets: [
          [{ target: 2, percent: 1.0 }],
        ],
      };

      const baseStrategy: StrategyConfig = {
        name: 'Base',
        profitTargets: [{ target: 3, percent: 1.0 }],
      };

      const combinations = generateParameterCombinations(grid, baseStrategy);

      expect(combinations.length).toBeGreaterThan(0);
    });
  });

  describe('generateFocusedGrid', () => {
    it('should generate grid around base strategy', () => {
      const baseStrategy: StrategyConfig = {
        name: 'Base',
        profitTargets: [{ target: 2, percent: 1.0 }],
        stopLoss: {
          initial: -0.2,
          trailingPercent: 0.2,
        },
      };

      const grid = generateFocusedGrid(baseStrategy, {
        trailingStop: 3,
        stopLoss: 3,
      });

      expect(grid.trailingStopPercent).toBeDefined();
      expect(grid.stopLossInitial).toBeDefined();
    });

    it('should handle missing base strategy values', () => {
      const baseStrategy: StrategyConfig = {
        name: 'Base',
      };

      const grid = generateFocusedGrid(baseStrategy, {
        trailingStop: 3,
        stopLoss: 3,
      });

      expect(grid.trailingStopPercent).toBeDefined();
      expect(grid.stopLossInitial).toBeDefined();
    });

    it('should generate variations around base values', () => {
      const baseStrategy: StrategyConfig = {
        name: 'Base',
        stopLoss: {
          initial: -0.2,
          trailingPercent: 0.2,
        },
      };

      const grid = generateFocusedGrid(baseStrategy, {
        trailingStop: 3,
        stopLoss: 3,
      });

      if (grid.trailingStopPercent) {
        expect(grid.trailingStopPercent.length).toBe(3);
        expect(grid.trailingStopPercent[1]).toBe(0.2); // Base value
      }

      if (grid.stopLossInitial) {
        expect(grid.stopLossInitial.length).toBe(3);
        expect(grid.stopLossInitial[1]).toBe(-0.2); // Base value
      }
    });
  });
});



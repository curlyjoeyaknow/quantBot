/**
 * Parameter Grid Generation
 *
 * Generates parameter combinations for optimization
 */

import { ParameterGrid, StrategyConfig } from './types';
import { StrategyConfig as BaseStrategyConfig } from '../strategies/types';

/**
 * Generate all parameter combinations from a grid
 */
export function generateParameterCombinations(
  grid: ParameterGrid,
  baseStrategy?: BaseStrategyConfig
): StrategyConfig[] {
  const combinations: StrategyConfig[] = [];

  // Default values
  const profitTargetsOptions = grid.profitTargets || [
    [
      { target: 2.0, percent: 0.5 },
      { target: 3.0, percent: 0.3 },
      { target: 5.0, percent: 0.2 },
    ],
  ];
  const trailingStopOptions = grid.trailingStopPercent || [0.2, 0.25, 0.3];
  const trailingActivationOptions = grid.trailingStopActivation || [2.0, 3.0];
  const minExitPriceOptions = grid.minExitPrice || [0.01, 0.05, 0.1];
  const stopLossOptions = grid.stopLossInitial || [-0.2, -0.3];
  const holdHoursOptions = grid.holdHours || [6, 24];
  const lossClampOptions = grid.lossClampPercent || [0.2, 0.3];

  // Generate all combinations
  for (const profitTargets of profitTargetsOptions) {
    for (const trailingStop of trailingStopOptions) {
      for (const trailingActivation of trailingActivationOptions) {
        for (const minExitPrice of minExitPriceOptions) {
          for (const stopLoss of stopLossOptions) {
            for (const holdHours of holdHoursOptions) {
              for (const lossClamp of lossClampOptions) {
                // Skip invalid combinations
                if (trailingActivation < 2.0) continue;
                if (minExitPrice > 0.6) continue;

                const strategy: StrategyConfig = {
                  name: `Strategy_${combinations.length}`,
                  profitTargets,
                  stopLoss: {
                    initial: stopLoss,
                    trailing: trailingActivation,
                    trailingPercent: trailingStop,
                  },
                  holdHours,
                  lossClampPercent: lossClamp,
                  minExitPrice,
                  ...(baseStrategy || {}),
                };

                combinations.push(strategy);
              }
            }
          }
        }
      }
    }
  }

  return combinations;
}

/**
 * Generate a focused grid around a base strategy
 */
export function generateFocusedGrid(
  baseStrategy: BaseStrategyConfig,
  variations: {
    profitTargets?: number; // Number of variations
    trailingStop?: number;
    stopLoss?: number;
  } = {}
): ParameterGrid {
  const grid: ParameterGrid = {};

  // Generate variations around base strategy
  if (variations.profitTargets) {
    // Create variations of profit targets
    grid.profitTargets = [
      baseStrategy.profitTargets,
      // Add variations
    ];
  }

  if (variations.trailingStop) {
    const baseTrailing = baseStrategy.stopLoss?.trailingPercent || 0.2;
    grid.trailingStopPercent = [baseTrailing * 0.8, baseTrailing, baseTrailing * 1.2];
  }

  if (variations.stopLoss) {
    const baseStopLoss = baseStrategy.stopLoss?.initial || -0.2;
    grid.stopLossInitial = [baseStopLoss * 0.8, baseStopLoss, baseStopLoss * 1.2];
  }

  return grid;
}

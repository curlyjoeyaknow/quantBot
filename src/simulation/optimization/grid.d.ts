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
export declare function generateParameterCombinations(grid: ParameterGrid, baseStrategy?: BaseStrategyConfig): StrategyConfig[];
/**
 * Generate a focused grid around a base strategy
 */
export declare function generateFocusedGrid(baseStrategy: BaseStrategyConfig, variations?: {
    profitTargets?: number;
    trailingStop?: number;
    stopLoss?: number;
}): ParameterGrid;
//# sourceMappingURL=grid.d.ts.map
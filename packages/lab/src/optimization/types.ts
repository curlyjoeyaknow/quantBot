/**
 * Common optimization types
 */

export interface OptimizationResult {
  bestParams: Record<string, unknown>;
  bestScore: number;
  allParams: Array<Record<string, unknown>>;
  allScores: number[];
  iterations: number;
}

export interface OptimizerConfig {
  maxIterations?: number;
  convergenceThreshold?: number;
  randomSeed?: number;
  strategy?: OptimizationStrategy;
  maxConfigs?: number;
  earlyStopping?: {
    enabled?: boolean;
    minConfigs?: number;
    patience?: number;
  };
}

/**
 * Parameter space definition: maps parameter names to arrays of possible values
 */
export type ParameterSpaceDef = Record<string, number[] | string[]>;

/**
 * Parameter configuration: maps parameter names to their selected values
 */
export type ParameterConfig = Record<string, number | string>;

/**
 * Optimization configuration (alias for OptimizerConfig for backward compatibility)
 */
export type OptimizationConfig = OptimizerConfig;

/**
 * Optimization strategy type
 */
export type OptimizationStrategy = 'grid' | 'grid_search' | 'random' | 'random_search' | 'bayesian';

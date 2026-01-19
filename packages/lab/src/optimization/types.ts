/**
 * Common optimization types
 */

/**
 * Parameter space definition
 * Maps parameter names to arrays of possible values
 */
export type ParameterSpaceDef = Record<string, Array<number | string>>;

/**
 * Parameter configuration (single point in parameter space)
 */
export type ParameterConfig = Record<string, number | string>;

/**
 * Optimization strategy
 */
export type OptimizationStrategy = 'grid_search' | 'random_search' | 'bayesian' | 'pareto';

/**
 * Optimization configuration
 */
export interface OptimizationConfig {
  strategy: OptimizationStrategy;
  maxIterations?: number;
  convergenceThreshold?: number;
  randomSeed?: number;
  earlyStopping?: {
    enabled: boolean;
    minConfigs?: number;
    patience?: number;
  };
}

/**
 * Optimization result (from OptimizationEngine)
 */
export interface OptimizationResult {
  bestParams: Record<string, unknown>;
  bestScore: number;
  allParams: Array<Record<string, unknown>>;
  allScores: number[];
  iterations: number;
}

/**
 * Optimizer configuration
 */
export interface OptimizerConfig {
  maxIterations?: number;
  convergenceThreshold?: number;
  randomSeed?: number;
}

/**
 * Optimization Types
 *
 * Types for parameter space definition and optimization.
 */

/**
 * Parameter space definition from preset
 */
export interface ParameterSpaceDef {
  [paramName: string]: number[] | string[]; // Array of values to try
}

/**
 * Parameter configuration (one point in space)
 */
export interface ParameterConfig {
  [paramName: string]: number | string;
}

/**
 * Optimization strategy
 */
export type OptimizationStrategy = 'grid_search' | 'random_search' | 'bayesian';

/**
 * Optimization configuration
 */
export interface OptimizationConfig {
  strategy: OptimizationStrategy;
  maxConfigs?: number; // Limit for random/bayesian search
  earlyStopping?: {
    enabled: boolean;
    minConfigs?: number; // Don't stop before this many configs
    patience?: number; // Stop if no improvement after N configs
  };
}

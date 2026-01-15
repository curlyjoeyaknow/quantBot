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
}

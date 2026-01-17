/**
 * Bayesian Optimization (TypeScript orchestration)
 *
 * Orchestrates Python-based Bayesian optimization using Gaussian Processes.
 */

import { z } from 'zod';
import { PythonEngine } from '@quantbot/utils';
import type { OptimizationResult } from './types.js';

export const BayesianParameterSpaceSchema = z.object({
  name: z.string(),
  type: z.enum(['real', 'integer', 'categorical']),
  low: z.number().optional(),
  high: z.number().optional(),
  categories: z.array(z.unknown()).optional(),
});

export type BayesianParameterSpace = z.infer<typeof BayesianParameterSpaceSchema>;

export const BayesianOptimizerConfigSchema = z.object({
  parameterSpace: z.array(BayesianParameterSpaceSchema),
  nCalls: z.number().int().positive().default(50),
  nInitialPoints: z.number().int().positive().default(10),
  acqFunc: z.enum(['EI', 'LCB', 'PI']).default('EI'),
  randomState: z.number().int().optional(),
});

export type BayesianOptimizerConfig = z.infer<typeof BayesianOptimizerConfigSchema>;

export const BayesianResultSchema = z.object({
  success: z.boolean(),
  best_params: z.record(z.unknown()).optional(),
  best_score: z.number().optional(),
  all_params: z.array(z.record(z.unknown())).optional(),
  all_scores: z.array(z.number()).optional(),
  n_iterations: z.number().optional(),
  error: z.string().optional(),
});

export type BayesianResult = z.infer<typeof BayesianResultSchema>;

/**
 * Bayesian optimizer using Gaussian Processes
 */
export class BayesianOptimizer {
  constructor(private readonly pythonEngine: PythonEngine) {}

  /**
   * Run Bayesian optimization
   *
   * @param config - Optimization configuration
   * @param objectiveScores - Pre-computed objective scores for parameter combinations
   * @returns Optimization result
   */
  async optimize(
    config: BayesianOptimizerConfig,
    objectiveScores: Record<string, number>
  ): Promise<OptimizationResult> {
    const input = {
      parameter_space: config.parameterSpace.map((p) => ({
        name: p.name,
        type: p.type,
        low: p.low,
        high: p.high,
        categories: p.categories,
      })),
      n_calls: config.nCalls,
      n_initial_points: config.nInitialPoints,
      acq_func: config.acqFunc,
      random_state: config.randomState,
      objective_scores: objectiveScores,
    };

    const result = await this.pythonEngine.runScript<BayesianResult>(
      'tools/optimization/bayesian_optimizer.py',
      input,
      BayesianResultSchema
    );

    if (!result.success || !result.best_params) {
      throw new Error(`Bayesian optimization failed: ${result.error || 'Unknown error'}`);
    }

    return {
      bestParams: result.best_params,
      bestScore: result.best_score!,
      allParams: result.all_params || [],
      allScores: result.all_scores || [],
      iterations: result.n_iterations || 0,
    };
  }

  /**
   * Estimate number of iterations needed for convergence
   */
  estimateIterations(parameterSpace: BayesianParameterSpace[]): number {
    // Rule of thumb: 10-20x the number of parameters
    const nParams = parameterSpace.length;
    return Math.max(50, nParams * 15);
  }

  /**
   * Validate parameter space
   */
  validateParameterSpace(parameterSpace: BayesianParameterSpace[]): void {
    for (const param of parameterSpace) {
      if (param.type === 'real' || param.type === 'integer') {
        if (param.low === undefined || param.high === undefined) {
          throw new Error(
            `Parameter ${param.name} of type ${param.type} must have low and high bounds`
          );
        }
        if (param.low >= param.high) {
          throw new Error(
            `Parameter ${param.name} has invalid bounds: low (${param.low}) >= high (${param.high})`
          );
        }
      } else if (param.type === 'categorical') {
        if (!param.categories || param.categories.length === 0) {
          throw new Error(`Parameter ${param.name} of type categorical must have categories`);
        }
      }
    }
  }
}

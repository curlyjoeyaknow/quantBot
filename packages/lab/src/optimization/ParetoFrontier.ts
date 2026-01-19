/**
 * Multi-Objective Pareto Frontier (TypeScript orchestration)
 *
 * Orchestrates Python-based Pareto frontier computation for multi-objective optimization.
 */

import { z } from 'zod';
import { PythonEngine } from '@quantbot/infra/utils';

export const ParetoSolutionSchema = z.object({
  params: z.record(z.string(), z.unknown()),
  objectives: z.record(z.string(), z.number()),
});

export type ParetoSolution = z.infer<typeof ParetoSolutionSchema>;

export const ParetoConfigSchema = z.object({
  solutions: z.array(ParetoSolutionSchema),
  maximize: z.record(z.string(), z.boolean()).optional(),
  referencePoint: z.record(z.string(), z.number()).optional(),
  weights: z.record(z.string(), z.number()).optional(),
});

export type ParetoConfig = z.infer<typeof ParetoConfigSchema>;

export const RankedSolutionSchema = z.object({
  params: z.record(z.string(), z.unknown()),
  objectives: z.record(z.string(), z.number()),
  score: z.number(),
});

export type RankedSolution = z.infer<typeof RankedSolutionSchema>;

export const ParetoResultSchema = z.object({
  success: z.boolean(),
  pareto_front: z.array(ParetoSolutionSchema).optional(),
  pareto_count: z.number().optional(),
  total_count: z.number().optional(),
  hypervolume: z.number().optional(),
  ranked: z.array(RankedSolutionSchema).optional(),
  error: z.string().optional(),
});

export type ParetoResult = z.infer<typeof ParetoResultSchema>;

/**
 * Pareto frontier analyzer for multi-objective optimization
 */
export class ParetoFrontier {
  constructor(private readonly pythonEngine: PythonEngine) {}

  /**
   * Compute Pareto frontier from solutions
   *
   * @param config - Pareto configuration
   * @returns Pareto-optimal solutions
   */
  async compute(config: ParetoConfig): Promise<{
    paretoFront: ParetoSolution[];
    paretoCount: number;
    totalCount: number;
    hypervolume?: number;
    ranked?: RankedSolution[];
  }> {
    const input = {
      solutions: config.solutions.map((s) => ({
        params: s.params,
        objectives: s.objectives,
      })),
      maximize: config.maximize || {},
      reference_point: config.referencePoint || {},
      weights: config.weights || {},
    };

    const result = await this.pythonEngine.runScript<ParetoResult>(
      'tools/optimization/pareto_frontier.py',
      input,
      ParetoResultSchema
    );

    if (!result.success || !result.pareto_front) {
      throw new Error(`Pareto frontier computation failed: ${result.error || 'Unknown error'}`);
    }

    return {
      paretoFront: result.pareto_front,
      paretoCount: result.pareto_count!,
      totalCount: result.total_count!,
      hypervolume: result.hypervolume,
      ranked: result.ranked,
    };
  }

  /**
   * Find trade-offs between objectives
   *
   * Returns solutions that represent different trade-off points
   */
  async findTradeoffs(
    solutions: ParetoSolution[],
    objective1: string,
    objective2: string,
    maximize: Record<string, boolean> = {}
  ): Promise<ParetoSolution[]> {
    const config: ParetoConfig = {
      solutions,
      maximize,
    };

    const result = await this.compute(config);

    // Sort by first objective
    const sorted = [...result.paretoFront].sort((a, b) => {
      const aVal = a.objectives[objective1];
      const bVal = b.objectives[objective1];
      if (aVal === undefined || bVal === undefined) return 0;
      return maximize[objective1] ? bVal - aVal : aVal - bVal;
    });

    return sorted;
  }

  /**
   * Select best solution from Pareto front using weights
   */
  async selectBest(
    solutions: ParetoSolution[],
    weights: Record<string, number>,
    maximize: Record<string, boolean> = {}
  ): Promise<RankedSolution | null> {
    const config: ParetoConfig = {
      solutions,
      maximize,
      weights,
    };

    const result = await this.compute(config);

    if (!result.ranked || result.ranked.length === 0) {
      return null;
    }

    return result.ranked[0] ?? null; // Highest ranked
  }

  /**
   * Compute hypervolume indicator
   *
   * Measures quality of Pareto front
   */
  async computeHypervolume(
    solutions: ParetoSolution[],
    referencePoint: Record<string, number>,
    maximize: Record<string, boolean> = {}
  ): Promise<number> {
    const config: ParetoConfig = {
      solutions,
      maximize,
      referencePoint,
    };

    const result = await this.compute(config);

    return result.hypervolume || 0;
  }

  /**
   * Validate solutions have consistent objectives
   */
  validateSolutions(solutions: ParetoSolution[]): void {
    if (solutions.length === 0) {
      throw new Error('No solutions provided');
    }

    const firstSolution = solutions[0];
    if (!firstSolution) {
      throw new Error('First solution is undefined');
    }

    const firstObjectives = Object.keys(firstSolution.objectives).sort();

    for (let i = 1; i < solutions.length; i++) {
      const solution = solutions[i];
      if (!solution) continue;

      const objectives = Object.keys(solution.objectives).sort();
      if (JSON.stringify(objectives) !== JSON.stringify(firstObjectives)) {
        throw new Error(
          `Solution ${i} has different objectives: ${objectives.join(', ')} vs ${firstObjectives.join(', ')}`
        );
      }
    }
  }
}

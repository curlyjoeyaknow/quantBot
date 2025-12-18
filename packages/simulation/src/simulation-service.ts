/**
 * Simulation Service
 *
 * Service layer for DuckDB-based simulation operations.
 * Wraps PythonEngine calls and validates output with Zod schemas.
 */

import { z } from 'zod';
import type { PythonEngine } from '@quantbot/utils';
import { logger, AppError, TimeoutError } from '@quantbot/utils';
import { join } from 'path';

/**
 * Schema for simulation result
 */
export const SimulationResultSchema = z.object({
  run_id: z.string().optional(),
  final_capital: z.number().optional(),
  total_return_pct: z.number().optional(),
  total_trades: z.number().optional(),
  error: z.string().optional(),
  mint: z.string().optional(), // Included when error occurs (for queue tracking)
  alert_timestamp: z.string().optional(), // Included when error occurs (for queue tracking)
});

/**
 * Schema for simulation output
 */
export const SimulationOutputSchema = z.object({
  results: z.array(SimulationResultSchema),
  summary: z.object({
    total_runs: z.number(),
    successful: z.number(),
    failed: z.number(),
  }),
});

export type SimulationResult = z.infer<typeof SimulationResultSchema>;
export type SimulationOutput = z.infer<typeof SimulationOutputSchema>;

/**
 * Simulation configuration
 */
export interface SimulationConfig {
  duckdb_path: string;
  strategy: Record<string, unknown>;
  initial_capital?: number;
  lookback_minutes?: number;
  lookforward_minutes?: number;
  batch?: boolean;
  mint?: string;
  alert_timestamp?: string;
  mints?: string[];
  alert_timestamps?: string[];
}

/**
 * Simulation Service
 */
export class SimulationService {
  constructor(private readonly pythonEngine: PythonEngine) {}

  /**
   * Run a single simulation
   *
   * @param config - Simulation configuration
   * @returns Validated simulation results
   */
  async runSimulation(config: SimulationConfig): Promise<SimulationOutput> {
    const scriptPath = 'tools/simulation/run_simulation.py';

    try {
      const result = await this.pythonEngine.runScriptWithStdin(
        scriptPath,
        config as unknown as Record<string, unknown>,
        SimulationOutputSchema,
        {
          timeout: 300000, // 5 minute timeout
          cwd: join(process.cwd(), 'tools/simulation'),
          env: {
            PYTHONPATH: join(process.cwd(), 'tools/simulation'),
          },
        }
      );

      return result;
    } catch (error) {
      logger.error('Simulation failed', error as Error);

      // Re-throw AppErrors as-is
      if (error instanceof AppError || error instanceof TimeoutError) {
        throw error;
      }

      // Wrap other errors
      throw new AppError(
        `Simulation failed: ${error instanceof Error ? error.message : String(error)}`,
        'SIMULATION_FAILED',
        500,
        { config }
      );
    }
  }
}

/**
 * V1 Baseline Python Service
 *
 * Service layer for Python-based V1 baseline optimization.
 * Wraps PythonEngine calls and validates output with Zod schemas.
 *
 * Architecture: Python bears the brunt of data science workload, TypeScript orchestrates.
 */

import { z } from 'zod';
import type { PythonEngine } from '@quantbot/utils';
import { logger, AppError, TimeoutError, findWorkspaceRoot } from '@quantbot/utils';
import { join } from 'path';

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * V1 Baseline parameters schema
 */
export const V1BaselineParamsSchema = z.object({
  tp_mult: z.number(),
  sl_mult: z.number(),
  max_hold_hrs: z.number().optional(),
});

/**
 * Capital simulator config schema
 */
export const CapitalSimulatorConfigSchema = z.object({
  initial_capital: z.number().optional(),
  max_allocation_pct: z.number().optional(),
  max_risk_per_trade: z.number().optional(),
  max_concurrent_positions: z.number().optional(),
  max_trade_horizon_hrs: z.number().optional(),
  min_executable_size: z.number().optional(),
  taker_fee_bps: z.number().optional(),
  slippage_bps: z.number().optional(),
});

/**
 * Trade execution schema
 */
export const TradeExecutionSchema = z.object({
  call_id: z.string(),
  entry_ts_ms: z.number(),
  exit_ts_ms: z.number(),
  entry_px: z.number(),
  exit_px: z.number(),
  size: z.number(),
  pnl: z.number(),
  exit_reason: z.enum(['take_profit', 'stop_loss', 'time_exit', 'no_entry', 'insufficient_capital']),
  exit_mult: z.number(),
});

/**
 * Capital simulation result schema
 */
export const CapitalSimulationResultSchema = z.object({
  final_capital: z.number(),
  total_return: z.number(),
  trades_executed: z.number(),
  trades_skipped: z.number(),
  completed_trades: z.array(TradeExecutionSchema),
});

/**
 * V1 baseline optimization result schema
 */
export const V1BaselineOptimizationResultSchema = z.object({
  best_params: V1BaselineParamsSchema.nullable(),
  best_final_capital: z.number(),
  best_total_return: z.number(),
  params_evaluated: z.number(),
  all_results: z.array(z.object({
    params: V1BaselineParamsSchema,
    result: CapitalSimulationResultSchema,
  })).optional(),
});

/**
 * Per-caller result schema
 */
export const V1BaselinePerCallerResultSchema = z.object({
  caller: z.string(),
  best_params: V1BaselineParamsSchema.nullable(),
  best_final_capital: z.number(),
  best_total_return: z.number(),
  collapsed_capital: z.boolean(),
  requires_extreme_params: z.boolean(),
});

/**
 * Grouped evaluation result schema
 */
export const V1BaselineGroupedResultSchema = z.object({
  per_caller_results: z.record(z.string(), V1BaselinePerCallerResultSchema),
  selected_callers: z.array(z.string()),
  grouped_result: CapitalSimulationResultSchema.nullable(),
  grouped_params: V1BaselineParamsSchema.nullable(),
});

// =============================================================================
// TypeScript Types
// =============================================================================

export type V1BaselineParams = z.infer<typeof V1BaselineParamsSchema>;
export type CapitalSimulatorConfig = z.infer<typeof CapitalSimulatorConfigSchema>;
export type TradeExecution = z.infer<typeof TradeExecutionSchema>;
export type CapitalSimulationResult = z.infer<typeof CapitalSimulationResultSchema>;
export type V1BaselineOptimizationResult = z.infer<typeof V1BaselineOptimizationResultSchema>;
export type V1BaselinePerCallerResult = z.infer<typeof V1BaselinePerCallerResultSchema>;
export type V1BaselineGroupedResult = z.infer<typeof V1BaselineGroupedResultSchema>;

// =============================================================================
// Input Configurations
// =============================================================================

/**
 * Configuration for capital simulation
 */
export interface SimulateCapitalAwareConfig {
  /** Calls to simulate (as JSON) */
  calls: Array<{
    id: string;
    mint: string;
    caller: string;
    ts_ms: number;
  }>;
  /** Candles by call ID (as JSON) */
  candles_by_call_id: Record<string, Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>>;
  /** V1 baseline parameters */
  params: V1BaselineParams;
  /** Optional simulator config */
  config?: CapitalSimulatorConfig;
}

/**
 * Configuration for optimization
 */
export interface OptimizeV1BaselineConfig {
  /** Calls to optimize (as JSON) */
  calls: Array<{
    id: string;
    mint: string;
    caller: string;
    ts_ms: number;
  }>;
  /** Candles by call ID (as JSON) */
  candles_by_call_id: Record<string, Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>>;
  /** Optional parameter grid */
  param_grid?: {
    tp_mults?: number[];
    sl_mults?: number[];
    max_hold_hrs?: number[];
  };
  /** Optional simulator config */
  simulator_config?: CapitalSimulatorConfig;
  /** Optional caller groups to filter */
  caller_groups?: string[];
  /** Verbose output */
  verbose?: boolean;
}

/**
 * Configuration for per-caller optimization
 */
export interface OptimizeV1BaselinePerCallerConfig {
  /** Calls to optimize (as JSON) */
  calls: Array<{
    id: string;
    mint: string;
    caller: string;
    ts_ms: number;
  }>;
  /** Candles by call ID (as JSON) */
  candles_by_call_id: Record<string, Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>>;
  /** Optional parameter grid */
  param_grid?: {
    tp_mults?: number[];
    sl_mults?: number[];
    max_hold_hrs?: number[];
  };
  /** Optional simulator config */
  simulator_config?: CapitalSimulatorConfig;
  /** Verbose output */
  verbose?: boolean;
}

/**
 * Configuration for grouped evaluation
 */
export interface RunV1BaselineGroupedEvaluationConfig {
  /** Calls to evaluate (as JSON) */
  calls: Array<{
    id: string;
    mint: string;
    caller: string;
    ts_ms: number;
  }>;
  /** Candles by call ID (as JSON) */
  candles_by_call_id: Record<string, Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>>;
  /** Optional parameter grid */
  param_grid?: {
    tp_mults?: number[];
    sl_mults?: number[];
    max_hold_hrs?: number[];
  };
  /** Optional simulator config */
  simulator_config?: CapitalSimulatorConfig;
  /** Filter collapsed callers */
  filter_collapsed?: boolean;
  /** Filter extreme params */
  filter_extreme?: boolean;
  /** Verbose output */
  verbose?: boolean;
}

// =============================================================================
// V1 Baseline Python Service
// =============================================================================

/**
 * V1 Baseline Python Service
 *
 * Wraps Python implementation of V1 baseline optimizer.
 * Python handles computation, TypeScript handles orchestration.
 */
export class V1BaselinePythonService {
  constructor(private readonly pythonEngine: PythonEngine) {}

  /**
   * Run capital-aware simulation
   *
   * @param config - Simulation configuration
   * @returns Validated simulation result
   */
  async simulateCapitalAware(config: SimulateCapitalAwareConfig): Promise<CapitalSimulationResult> {
    const scriptPath = 'tools/backtest/lib/v1_baseline_simulator.py';
    const workspaceRoot = findWorkspaceRoot();

    try {
      // Call Python script with stdin (JSON input)
      const result = await this.pythonEngine.runScriptWithStdin(
        scriptPath,
        {
          operation: 'simulate',
          ...config,
        } as unknown as Record<string, unknown>,
        CapitalSimulationResultSchema,
        {
          timeout: 300000, // 5 minute timeout
          cwd: join(workspaceRoot, 'tools/backtest'),
          env: {
            PYTHONPATH: join(workspaceRoot, 'tools/backtest'),
          },
        }
      );

      return result;
    } catch (error) {
      logger.error('Capital simulation failed', error as Error);

      // Re-throw AppErrors as-is
      if (error instanceof AppError || error instanceof TimeoutError) {
        throw error;
      }

      // Wrap other errors
      throw new AppError(
        `Capital simulation failed: ${error instanceof Error ? error.message : String(error)}`,
        'CAPITAL_SIMULATION_FAILED',
        500,
        { config }
      );
    }
  }

  /**
   * Optimize V1 baseline parameters
   *
   * @param config - Optimization configuration
   * @returns Validated optimization result
   */
  async optimizeV1Baseline(config: OptimizeV1BaselineConfig): Promise<V1BaselineOptimizationResult> {
    const scriptPath = 'tools/backtest/lib/v1_baseline_optimizer.py';
    const workspaceRoot = findWorkspaceRoot();

    try {
      const result = await this.pythonEngine.runScriptWithStdin(
        scriptPath,
        {
          operation: 'optimize',
          ...config,
        } as unknown as Record<string, unknown>,
        V1BaselineOptimizationResultSchema,
        {
          timeout: 600000, // 10 minute timeout (grid search can be slow)
          cwd: join(workspaceRoot, 'tools/backtest'),
          env: {
            PYTHONPATH: join(workspaceRoot, 'tools/backtest'),
          },
        }
      );

      return result;
    } catch (error) {
      logger.error('V1 baseline optimization failed', error as Error);

      if (error instanceof AppError || error instanceof TimeoutError) {
        throw error;
      }

      throw new AppError(
        `V1 baseline optimization failed: ${error instanceof Error ? error.message : String(error)}`,
        'V1_BASELINE_OPTIMIZATION_FAILED',
        500,
        { config }
      );
    }
  }

  /**
   * Optimize V1 baseline per caller
   *
   * @param config - Per-caller optimization configuration
   * @returns Validated per-caller results
   */
  async optimizeV1BaselinePerCaller(
    config: OptimizeV1BaselinePerCallerConfig
  ): Promise<Record<string, V1BaselinePerCallerResult>> {
    const scriptPath = 'tools/backtest/lib/v1_baseline_optimizer.py';
    const workspaceRoot = findWorkspaceRoot();

    try {
      const result = await this.pythonEngine.runScriptWithStdin(
        scriptPath,
        {
          operation: 'optimize_per_caller',
          ...config,
        } as unknown as Record<string, unknown>,
        z.record(z.string(), V1BaselinePerCallerResultSchema),
        {
          timeout: 600000, // 10 minute timeout
          cwd: join(workspaceRoot, 'tools/backtest'),
          env: {
            PYTHONPATH: join(workspaceRoot, 'tools/backtest'),
          },
        }
      );

      return result as Record<string, V1BaselinePerCallerResult>;
    } catch (error) {
      logger.error('V1 baseline per-caller optimization failed', error as Error);

      if (error instanceof AppError || error instanceof TimeoutError) {
        throw error;
      }

      throw new AppError(
        `V1 baseline per-caller optimization failed: ${error instanceof Error ? error.message : String(error)}`,
        'V1_BASELINE_PER_CALLER_FAILED',
        500,
        { config }
      );
    }
  }

  /**
   * Run grouped evaluation
   *
   * @param config - Grouped evaluation configuration
   * @returns Validated grouped result
   */
  async runV1BaselineGroupedEvaluation(
    config: RunV1BaselineGroupedEvaluationConfig
  ): Promise<V1BaselineGroupedResult> {
    const scriptPath = 'tools/backtest/lib/v1_baseline_optimizer.py';
    const workspaceRoot = findWorkspaceRoot();

    try {
      const result = await this.pythonEngine.runScriptWithStdin(
        scriptPath,
        {
          operation: 'grouped_evaluation',
          ...config,
        } as unknown as Record<string, unknown>,
        V1BaselineGroupedResultSchema,
        {
          timeout: 600000, // 10 minute timeout
          cwd: join(workspaceRoot, 'tools/backtest'),
          env: {
            PYTHONPATH: join(workspaceRoot, 'tools/backtest'),
          },
        }
      );

      return result;
    } catch (error) {
      logger.error('V1 baseline grouped evaluation failed', error as Error);

      if (error instanceof AppError || error instanceof TimeoutError) {
        throw error;
      }

      throw new AppError(
        `V1 baseline grouped evaluation failed: ${error instanceof Error ? error.message : String(error)}`,
        'V1_BASELINE_GROUPED_EVALUATION_FAILED',
        500,
        { config }
      );
    }
  }
}



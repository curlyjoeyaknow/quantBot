/**
 * Caller Analysis Service
 *
 * Service layer for Python-based caller analysis and scoring.
 * Wraps run_caller_analysis.py script.
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
 * Caller analysis configuration schema
 */
export const CallerAnalysisConfigSchema = z.object({
  duckdb: z.string(),
  run_id: z.string().optional(),
  from: z.string().optional(), // YYYY-MM-DD
  to: z.string().optional(), // YYYY-MM-DD
  min_trades: z.number().int().positive().default(10),
  top: z.number().int().positive().default(50),
  format: z.enum(['json', 'table', 'csv']).default('json'),
});

/**
 * Caller stats schema
 */
export const CallerStatsSchema = z.object({
  rank: z.number(),
  caller: z.string(),
  n: z.number(),
  median_ath: z.number().nullable(),
  p25_ath: z.number().nullable(),
  p75_ath: z.number().nullable(),
  p95_ath: z.number().nullable(),
  hit2x_pct: z.number(),
  hit3x_pct: z.number(),
  hit4x_pct: z.number(),
  hit5x_pct: z.number(),
  hit10x_pct: z.number(),
  median_t_recovery_m: z.number().nullable(),
  median_t2x_m: z.number().nullable(),
  median_t3x_m: z.number().nullable(),
  median_t_ath_m: z.number().nullable(),
  median_t_dd_pre2x_m: z.number().nullable(),
  median_t2x_hrs: z.number().nullable(),
  median_dd_initial_pct: z.number().nullable(),
  median_dd_overall_pct: z.number().nullable(),
  median_dd_pre2x_pct: z.number().nullable(),
  median_dd_pre2x_or_horizon_pct: z.number().nullable(),
  median_dd_after_2x_pct: z.number().nullable(),
  median_dd_after_3x_pct: z.number().nullable(),
  median_dd_after_ath_pct: z.number().nullable(),
  worst_dd_pct: z.number().nullable(),
  median_peak_pnl_pct: z.number().nullable(),
  median_ret_end_pct: z.number().nullable(),
});

/**
 * Caller scoring schema (with v2 score)
 */
export const CallerScoringSchema = z.object({
  rank: z.number(),
  caller: z.string(),
  n: z.number(),
  median_ath: z.number().nullable(),
  p75_ath: z.number().nullable(),
  p95_ath: z.number().nullable(),
  hit2x_pct: z.number(),
  hit3x_pct: z.number(),
  hit4x_pct: z.number(),
  hit5x_pct: z.number(),
  median_t2x_hrs: z.number().nullable(),
  median_t2x_min: z.number().nullable(),
  median_dd_pre2x_pct: z.number().nullable(),
  median_dd_pre2x_or_horizon_pct: z.number().nullable(),
  risk_dd_pct: z.number().nullable(),
  risk_mag: z.number(),
  base_upside: z.number(),
  tail_bonus: z.number(),
  fast2x_signal: z.number(),
  discipline_bonus: z.number(),
  risk_penalty: z.number(),
  confidence: z.number(),
  score_v2: z.number(),
});

/**
 * Caller analysis result schema
 */
export const CallerAnalysisResultSchema = z.object({
  success: z.boolean(),
  run_id: z.string().optional(),
  callers: z.array(CallerStatsSchema),
  scored_callers: z.array(CallerScoringSchema).optional(),
  total_callers: z.number(),
});

// =============================================================================
// TypeScript Types
// =============================================================================

export type CallerAnalysisConfig = z.infer<typeof CallerAnalysisConfigSchema>;
export type CallerStats = z.infer<typeof CallerStatsSchema>;
export type CallerScoring = z.infer<typeof CallerScoringSchema>;
export type CallerAnalysisResult = z.infer<typeof CallerAnalysisResultSchema>;

// =============================================================================
// Caller Analysis Service
// =============================================================================

/**
 * Caller Analysis Service
 *
 * Wraps Python implementation of caller analysis and scoring.
 * Python handles computation, TypeScript handles orchestration.
 */
export class CallerAnalysisService {
  constructor(private readonly pythonEngine: PythonEngine) {}

  /**
   * Analyze callers from baseline backtest results
   *
   * @param config - Caller analysis configuration
   * @returns Validated caller analysis result
   */
  async analyzeCallers(config: CallerAnalysisConfig): Promise<CallerAnalysisResult> {
    const scriptPath = 'packages/backtest/python/scripts/run_caller_analysis.py';
    const workspaceRoot = findWorkspaceRoot();

    try {
      logger.info('[CallerAnalysisService] Starting caller analysis', {
        duckdb: config.duckdb,
        run_id: config.run_id,
      });

      // Build arguments for Python script
      const args: Record<string, unknown> = {
        duckdb: config.duckdb,
        'min-trades': config.min_trades,
        top: config.top,
        format: config.format,
      };

      if (config.run_id) {
        args['run-id'] = config.run_id;
      }

      if (config.from) {
        args.from = config.from;
      }

      if (config.to) {
        args.to = config.to;
      }

      const result = await this.pythonEngine.runScript(
        scriptPath,
        args,
        CallerAnalysisResultSchema,
        {
          timeout: 300000, // 5 minute timeout
          cwd: join(workspaceRoot, 'packages/backtest/python'),
          env: {
            PYTHONPATH: join(workspaceRoot, 'packages/backtest/python'),
          },
        }
      );

      logger.info('[CallerAnalysisService] Caller analysis completed', {
        total_callers: result.total_callers,
        top_caller: result.callers[0]?.caller,
        top_score: result.scored_callers?.[0]?.score_v2,
      });

      return result;
    } catch (error) {
      logger.error('[CallerAnalysisService] Caller analysis failed', error as Error);

      if (error instanceof AppError || error instanceof TimeoutError) {
        throw error;
      }

      throw new AppError(
        `Caller analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        'CALLER_ANALYSIS_FAILED',
        500,
        { config }
      );
    }
  }

  /**
   * Score callers using v2 scoring algorithm
   *
   * @param config - Caller analysis configuration
   * @returns Validated caller scoring result
   */
  async scoreCallers(config: CallerAnalysisConfig): Promise<CallerAnalysisResult> {
    const scriptPath = 'packages/backtest/python/scripts/run_caller_analysis.py';
    const workspaceRoot = findWorkspaceRoot();

    try {
      logger.info('[CallerAnalysisService] Starting caller scoring', {
        duckdb: config.duckdb,
        run_id: config.run_id,
      });

      // Build arguments for Python script (with scoring flag)
      const args: Record<string, unknown> = {
        duckdb: config.duckdb,
        'min-trades': config.min_trades,
        top: config.top,
        format: config.format,
        score: true, // Enable scoring
      };

      if (config.run_id) {
        args['run-id'] = config.run_id;
      }

      if (config.from) {
        args.from = config.from;
      }

      if (config.to) {
        args.to = config.to;
      }

      const result = await this.pythonEngine.runScript(
        scriptPath,
        args,
        CallerAnalysisResultSchema,
        {
          timeout: 300000, // 5 minute timeout
          cwd: join(workspaceRoot, 'packages/backtest/python'),
          env: {
            PYTHONPATH: join(workspaceRoot, 'packages/backtest/python'),
          },
        }
      );

      logger.info('[CallerAnalysisService] Caller scoring completed', {
        total_callers: result.total_callers,
        top_caller: result.scored_callers?.[0]?.caller,
        top_score: result.scored_callers?.[0]?.score_v2,
      });

      return result;
    } catch (error) {
      logger.error('[CallerAnalysisService] Caller scoring failed', error as Error);

      if (error instanceof AppError || error instanceof TimeoutError) {
        throw error;
      }

      throw new AppError(
        `Caller scoring failed: ${error instanceof Error ? error.message : String(error)}`,
        'CALLER_SCORING_FAILED',
        500,
        { config }
      );
    }
  }
}

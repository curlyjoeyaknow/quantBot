/**
 * Baseline Backtest Service
 *
 * Service layer for Python-based baseline backtesting.
 * Wraps run_baseline.py and run_fast_backtest.py scripts.
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
 * Baseline backtest configuration schema
 */
export const BaselineBacktestConfigSchema = z.object({
  duckdb: z.string(),
  from: z.string(), // YYYY-MM-DD
  to: z.string(), // YYYY-MM-DD
  chain: z.string().default('solana'),
  interval_seconds: z.number().int().positive().default(60),
  horizon_hours: z.number().int().positive().default(48),
  pre_window_minutes: z.number().int().positive().default(5),
  slice_dir: z.string().default('slices/per_token'),
  reuse_slice: z.boolean().default(false),
  threads: z.number().int().positive().default(16),
  min_trades: z.number().int().positive().default(10),
  store_duckdb: z.boolean().default(false),
  run_name: z.string().optional(),
  entry_mode: z.enum(['next_open', 'close', 'worst_high']).default('next_open'),
  slippage_bps: z.number().default(0),
});

/**
 * Token result schema
 */
export const TokenResultSchema = z.object({
  alert_id: z.number(),
  mint: z.string(),
  caller: z.string(),
  alert_ts_ms: z.number(),
  entry_ts_ms: z.number(),
  status: z.string(),
  candles: z.number(),
  entry_price: z.number().nullable(),
  ath_mult: z.number().nullable(),
  time_to_ath_s: z.number().nullable(),
  time_to_recovery_s: z.number().nullable(),
  time_to_2x_s: z.number().nullable(),
  time_to_3x_s: z.number().nullable(),
  time_to_4x_s: z.number().nullable(),
  time_to_5x_s: z.number().nullable(),
  time_to_10x_s: z.number().nullable(),
  time_to_dd_pre2x_s: z.number().nullable(),
  time_to_dd_after_2x_s: z.number().nullable(),
  time_to_dd_after_3x_s: z.number().nullable(),
  dd_initial: z.number().nullable(),
  dd_overall: z.number().nullable(),
  dd_pre2x: z.number().nullable(),
  dd_pre2x_or_horizon: z.number().nullable(),
  dd_after_2x: z.number().nullable(),
  dd_after_3x: z.number().nullable(),
  dd_after_4x: z.number().nullable(),
  dd_after_5x: z.number().nullable(),
  dd_after_10x: z.number().nullable(),
  dd_after_ath: z.number().nullable(),
  peak_pnl_pct: z.number().nullable(),
  ret_end_pct: z.number().nullable(),
});

/**
 * Baseline backtest result schema
 */
export const BaselineBacktestResultSchema = z.object({
  success: z.boolean(),
  run_id: z.string(),
  stored: z.boolean(),
  out_alerts: z.string(),
  out_callers: z.string(),
  summary: z.object({
    alerts_total: z.number(),
    alerts_ok: z.number(),
    alerts_missing: z.number(),
    median_ath_mult: z.number().nullable(),
    p25_ath_mult: z.number().nullable(),
    p75_ath_mult: z.number().nullable(),
    p95_ath_mult: z.number().nullable(),
    pct_hit_2x: z.number(),
    pct_hit_3x: z.number(),
    pct_hit_4x: z.number(),
    pct_hit_5x: z.number(),
    pct_hit_10x: z.number(),
    median_time_to_recovery_s: z.number().nullable(),
    median_time_to_2x_s: z.number().nullable(),
    median_time_to_3x_s: z.number().nullable(),
    median_time_to_ath_s: z.number().nullable(),
    median_time_to_dd_pre2x_s: z.number().nullable(),
    median_time_to_dd_after_2x_s: z.number().nullable(),
    median_dd_initial: z.number().nullable(),
    median_dd_overall: z.number().nullable(),
    median_dd_pre2x_or_horizon: z.number().nullable(),
    median_peak_pnl_pct: z.number().nullable(),
  }),
  callers_count: z.number(),
});

// =============================================================================
// TypeScript Types
// =============================================================================

export type BaselineBacktestConfig = z.infer<typeof BaselineBacktestConfigSchema>;
export type TokenResult = z.infer<typeof TokenResultSchema>;
export type BaselineBacktestResult = z.infer<typeof BaselineBacktestResultSchema>;

// =============================================================================
// Baseline Backtest Service
// =============================================================================

/**
 * Baseline Backtest Service
 *
 * Wraps Python implementation of baseline backtesting.
 * Python handles computation, TypeScript handles orchestration.
 */
export class BaselineBacktestService {
  constructor(private readonly pythonEngine: PythonEngine) {}

  /**
   * Run full baseline backtest
   *
   * @param config - Baseline backtest configuration
   * @returns Validated backtest result
   */
  async runFullBaseline(config: BaselineBacktestConfig): Promise<BaselineBacktestResult> {
    const scriptPath = 'packages/backtest/python/scripts/run_baseline.py';
    const workspaceRoot = findWorkspaceRoot();

    try {
      logger.info('[BaselineBacktestService] Starting full baseline backtest', {
        from: config.from,
        to: config.to,
        chain: config.chain,
      });

      // Build arguments for Python script
      const args: Record<string, unknown> = {
        from: config.from,
        to: config.to,
        duckdb: config.duckdb,
        chain: config.chain,
        'interval-seconds': config.interval_seconds,
        'horizon-hours': config.horizon_hours,
        'pre-window-minutes': config.pre_window_minutes,
        'slice-dir': config.slice_dir,
        threads: config.threads,
        'min-trades': config.min_trades,
        'output-format': 'json',
        'entry-mode': config.entry_mode,
        'slippage-bps': config.slippage_bps,
      };

      if (config.reuse_slice) {
        args['reuse-slice'] = true;
      }

      if (config.store_duckdb) {
        args['store-duckdb'] = true;
      }

      if (config.run_name) {
        args['run-name'] = config.run_name;
      }

      const result = await this.pythonEngine.runScript(
        scriptPath,
        args,
        BaselineBacktestResultSchema,
        {
          timeout: 1800000, // 30 minute timeout (can be slow for large date ranges)
          cwd: join(workspaceRoot, 'packages/backtest/python'),
          env: {
            PYTHONPATH: join(workspaceRoot, 'packages/backtest/python'),
          },
        }
      );

      logger.info('[BaselineBacktestService] Baseline backtest completed', {
        run_id: result.run_id,
        alerts_ok: result.summary.alerts_ok,
        callers_count: result.callers_count,
      });

      return result;
    } catch (error) {
      logger.error('[BaselineBacktestService] Baseline backtest failed', error as Error);

      if (error instanceof AppError || error instanceof TimeoutError) {
        throw error;
      }

      throw new AppError(
        `Baseline backtest failed: ${error instanceof Error ? error.message : String(error)}`,
        'BASELINE_BACKTEST_FAILED',
        500,
        { config }
      );
    }
  }

  /**
   * Run fast baseline backtest (path-only, no ClickHouse export)
   *
   * @param config - Baseline backtest configuration
   * @returns Validated backtest result
   */
  async runFastBacktest(config: BaselineBacktestConfig): Promise<BaselineBacktestResult> {
    const scriptPath = 'packages/backtest/python/scripts/run_fast_backtest.py';
    const workspaceRoot = findWorkspaceRoot();

    try {
      logger.info('[BaselineBacktestService] Starting fast baseline backtest', {
        from: config.from,
        to: config.to,
        chain: config.chain,
      });

      // Build arguments for Python script
      const args: Record<string, unknown> = {
        from: config.from,
        to: config.to,
        duckdb: config.duckdb,
        chain: config.chain,
        'interval-seconds': config.interval_seconds,
        'horizon-hours': config.horizon_hours,
        threads: config.threads,
        'min-trades': config.min_trades,
        'output-format': 'json',
      };

      if (config.store_duckdb) {
        args['store-duckdb'] = true;
      }

      if (config.run_name) {
        args['run-name'] = config.run_name;
      }

      const result = await this.pythonEngine.runScript(
        scriptPath,
        args,
        BaselineBacktestResultSchema,
        {
          timeout: 900000, // 15 minute timeout (faster than full baseline)
          cwd: join(workspaceRoot, 'packages/backtest/python'),
          env: {
            PYTHONPATH: join(workspaceRoot, 'packages/backtest/python'),
          },
        }
      );

      logger.info('[BaselineBacktestService] Fast baseline backtest completed', {
        run_id: result.run_id,
        alerts_ok: result.summary.alerts_ok,
        callers_count: result.callers_count,
      });

      return result;
    } catch (error) {
      logger.error('[BaselineBacktestService] Fast baseline backtest failed', error as Error);

      if (error instanceof AppError || error instanceof TimeoutError) {
        throw error;
      }

      throw new AppError(
        `Fast baseline backtest failed: ${error instanceof Error ? error.message : String(error)}`,
        'FAST_BACKTEST_FAILED',
        500,
        { config }
      );
    }
  }
}

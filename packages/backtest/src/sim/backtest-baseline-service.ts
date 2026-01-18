/**
 * Backtest Baseline Service
 *
 * Service layer for running baseline alert backtests.
 * Wraps the Python script (tools/backtest/alert_baseline_backtest.py) via PythonEngine.
 *
 * Computes per-alert metrics:
 * - ATH multiple after alert
 * - Max drawdown after alert
 * - Max drawdown before first 2x
 * - Time-to-2x
 * - Simple TP/SL exit policy returns
 */

import { z } from 'zod';
import { join } from 'path';
import type { PythonEngine } from '@quantbot/infra/utils';
import { logger, findWorkspaceRoot } from '@quantbot/infra/utils';

/**
 * Schema for backtest summary metrics
 */
export const BacktestSummarySchema = z.object({
  alerts_total: z.number(),
  alerts_ok: z.number(),
  alerts_missing: z.number(),
  median_ath_mult: z.number().nullable(),
  median_time_to_ath_hours: z.number().nullable(),
  median_time_to_2x_hours: z.number().nullable(),
  median_time_to_3x_hours: z.number().nullable(),
  median_dd_initial_pct: z.number().nullable().optional(), // Max dip before recovery
  median_dd_overall_pct: z.number().nullable(),
  median_dd_after_2x_pct: z.number().nullable().optional(),
  median_dd_after_3x_pct: z.number().nullable().optional(),
  median_peak_pnl_pct: z.number().nullable(),
  median_ret_end_pct: z.number().nullable(),
  pct_hit_2x: z.number(),
});

export type BacktestSummary = z.infer<typeof BacktestSummarySchema>;

/**
 * Schema for backtest config (echoed back)
 */
export const BacktestConfigSchema = z.object({
  date_from: z.string(),
  date_to: z.string(),
  interval_seconds: z.number(),
  horizon_hours: z.number(),
  chain: z.string(),
  tp_mult: z.number(),
  sl_mult: z.number(),
  fee_bps: z.number(),
  slippage_bps: z.number(),
});

export type BacktestConfig = z.infer<typeof BacktestConfigSchema>;

/**
 * Schema for full backtest result from Python script
 */
export const BacktestBaselineResultSchema = z.object({
  success: z.boolean(),
  error: z.string().nullable(),
  csv_path: z.string().nullable(),
  slice_path: z.string().optional(),
  log_path: z.string().optional(),
  worklist_path: z.string().nullable().optional(),
  summary: BacktestSummarySchema.nullable(),
  config: BacktestConfigSchema.optional(),
});

export type BacktestBaselineResult = z.infer<typeof BacktestBaselineResultSchema>;

/**
 * Input parameters for running a baseline backtest
 */
export interface BacktestBaselineParams {
  /** Path to DuckDB with alerts (caller_links_d or user_calls_d) */
  duckdbPath: string;
  /** Chain to filter (default: solana) */
  chain?: string;
  /** Start date (YYYY-MM-DD, inclusive). Defaults to 30 days ago */
  dateFrom?: string;
  /** End date (YYYY-MM-DD, inclusive). Defaults to today */
  dateTo?: string;
  /** Candle interval in seconds (60 or 300) */
  intervalSeconds?: number;
  /** Horizon in hours (default: 48) */
  horizonHours?: number;
  /** Output directory for results */
  outDir?: string;
  /** Explicit output CSV path (overrides outDir) */
  outCsv?: string;
  /** Number of threads for parallel processing (default: 16) */
  threads?: number;

  // Slice management
  /** Directory for Parquet slice files (default: slices) */
  sliceDir?: string;
  /** Reuse existing slice if available */
  reuseSlice?: boolean;
  /** Minimum coverage percentage required (0.0-1.0, default: 0.8) */
  minCoveragePct?: number;

  // ClickHouse configuration
  /** ClickHouse host (default: 127.0.0.1) */
  chHost?: string;
  /** ClickHouse native port (default: 19000) */
  chPort?: number;
  /** ClickHouse database (default: quantbot) */
  chDb?: string;
  /** ClickHouse table (default: ohlcv_candles) */
  chTable?: string;
  /** ClickHouse user (default: default) */
  chUser?: string;
  /** ClickHouse password */
  chPass?: string;
  /** ClickHouse connect timeout in seconds (default: 10) */
  chConnectTimeout?: number;
  /** ClickHouse query timeout in seconds (default: 300) */
  chTimeoutS?: number;

  // TP/SL policy parameters
  // (TP/SL policy removed - pure path metrics only)

  /** Enable live TUI dashboard (default: false) */
  tui?: boolean;
}

/**
 * Backtest Baseline Service
 *
 * Runs baseline alert backtests via Python script.
 */
export class BacktestBaselineService {
  constructor(private readonly pythonEngine: PythonEngine) {}

  /**
   * Run baseline alert backtest
   *
   * Reads alerts from DuckDB, fetches candles from ClickHouse,
   * and computes per-alert path metrics and TP/SL policy returns.
   *
   * @param params - Backtest parameters
   * @returns Backtest result with summary metrics
   */
  async runBaseline(params: BacktestBaselineParams): Promise<BacktestBaselineResult> {
    const workspaceRoot = findWorkspaceRoot();
    const scriptPath = join(workspaceRoot, 'tools/backtest/alert_baseline_backtest.py');

    // Resolve duckdb path to absolute
    const absoluteDuckdbPath = params.duckdbPath.startsWith('/')
      ? params.duckdbPath
      : join(workspaceRoot, params.duckdbPath);

    // Build args object for Python script
    const args: Record<string, unknown> = {
      duckdb: absoluteDuckdbPath,
      'output-format': 'json', // Always use JSON for service integration
    };

    // Core parameters
    if (params.chain) args.chain = params.chain;
    if (params.dateFrom) args.from = params.dateFrom;
    if (params.dateTo) args.to = params.dateTo;
    if (params.intervalSeconds) args['interval-seconds'] = params.intervalSeconds;
    if (params.horizonHours) args['horizon-hours'] = params.horizonHours;
    if (params.outDir) {
      const absoluteOutDir = params.outDir.startsWith('/')
        ? params.outDir
        : join(workspaceRoot, params.outDir);
      args['out-dir'] = absoluteOutDir;
    }
    if (params.outCsv) {
      const absoluteOutCsv = params.outCsv.startsWith('/')
        ? params.outCsv
        : join(workspaceRoot, params.outCsv);
      args['out-csv'] = absoluteOutCsv;
    }
    if (params.threads) args.threads = params.threads;

    // Slice management
    if (params.sliceDir) {
      const absoluteSliceDir = params.sliceDir.startsWith('/')
        ? params.sliceDir
        : join(workspaceRoot, params.sliceDir);
      args['slice-dir'] = absoluteSliceDir;
    }
    if (params.reuseSlice) args['reuse-slice'] = true;
    if (params.minCoveragePct !== undefined) args['min-coverage-pct'] = params.minCoveragePct;

    // ClickHouse parameters (native protocol)
    if (params.chHost) args['ch-host'] = params.chHost;
    if (params.chPort) args['ch-port'] = params.chPort;
    if (params.chDb) args['ch-db'] = params.chDb;
    if (params.chTable) args['ch-table'] = params.chTable;
    if (params.chUser) args['ch-user'] = params.chUser;
    if (params.chPass) args['ch-pass'] = params.chPass;
    if (params.chConnectTimeout) args['ch-connect-timeout'] = params.chConnectTimeout;
    if (params.chTimeoutS) args['ch-timeout-s'] = params.chTimeoutS;

    // (TP/SL policy removed - pure path metrics only)

    // TUI mode - only if NOT using JSON output (for CLI integration)
    if (params.tui) args['tui'] = true;

    try {
      const result = await this.pythonEngine.runScript(
        scriptPath,
        args,
        BacktestBaselineResultSchema,
        {
          timeout: 30 * 60 * 1000, // 30 minutes (backtests can be long)
          cwd: join(workspaceRoot, 'tools/backtest'),
          env: {
            PYTHONPATH: join(workspaceRoot, 'tools/backtest'),
          },
        }
      );

      return result;
    } catch (error) {
      logger.error('Failed to run baseline backtest', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        csv_path: null,
        summary: null,
      };
    }
  }
}

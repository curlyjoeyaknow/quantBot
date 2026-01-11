/**
 * Baseline Backtest Handler (Python)
 *
 * Handler for new Python-based baseline backtesting.
 * Wraps BaselineBacktestService (run_baseline.py, run_fast_backtest.py).
 *
 * Pure handler - no console.log, no process.exit, no try/catch.
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { z as zod } from 'zod';

// =============================================================================
// Zod Schema
// =============================================================================

export const baselinePythonSchema = zod.object({
  duckdb: zod.string(),
  from: zod.string(), // YYYY-MM-DD
  to: zod.string(), // YYYY-MM-DD
  chain: zod.string().default('solana'),
  intervalSeconds: zod.number().int().positive().default(60),
  horizonHours: zod.number().int().positive().default(48),
  preWindowMinutes: zod.number().int().positive().default(5),
  sliceDir: zod.string().default('slices/per_token'),
  reuseSlice: zod.boolean().default(false),
  threads: zod.number().int().positive().default(16),
  minTrades: zod.number().int().positive().default(10),
  storeDuckdb: zod.boolean().default(false),
  runName: zod.string().optional(),
  entryMode: zod.enum(['next_open', 'close', 'worst_high']).default('next_open'),
  slippageBps: zod.number().default(0),
  fast: zod.boolean().default(false), // Use fast backtest (path-only, no ClickHouse export)
});

export type BaselinePythonArgs = z.infer<typeof baselinePythonSchema>;

// =============================================================================
// Handler
// =============================================================================

/**
 * Run baseline backtest using Python
 *
 * @param args - Validated command arguments
 * @param ctx - Command context with services
 * @returns Backtest result with summary metrics
 */
export async function baselinePythonHandler(args: BaselinePythonArgs, ctx: CommandContext) {
  await ctx.ensureInitialized();

  const service = ctx.services.baselineBacktest();

  const config = {
    duckdb: args.duckdb,
    from: args.from,
    to: args.to,
    chain: args.chain,
    interval_seconds: args.intervalSeconds,
    horizon_hours: args.horizonHours,
    pre_window_minutes: args.preWindowMinutes,
    slice_dir: args.sliceDir,
    reuse_slice: args.reuseSlice,
    threads: args.threads,
    min_trades: args.minTrades,
    store_duckdb: args.storeDuckdb,
    run_name: args.runName,
    entry_mode: args.entryMode,
    slippage_bps: args.slippageBps,
  };

  // Choose fast or full baseline
  const result = args.fast
    ? await service.runFastBacktest(config)
    : await service.runFullBaseline(config);

  if (!result.success) {
    throw new Error('Baseline backtest failed');
  }

  // Format summary for display
  const summary = result.summary;

  return {
    success: true,
    run_id: result.run_id,
    stored: result.stored,
    out_alerts: result.out_alerts,
    out_callers: result.out_callers,
    summary: {
      alerts_total: summary.alerts_total,
      alerts_ok: summary.alerts_ok,
      alerts_missing: summary.alerts_missing,
      median_ath_mult: summary.median_ath_mult ? `${summary.median_ath_mult.toFixed(3)}x` : null,
      p25_ath_mult: summary.p25_ath_mult ? `${summary.p25_ath_mult.toFixed(3)}x` : null,
      p75_ath_mult: summary.p75_ath_mult ? `${summary.p75_ath_mult.toFixed(3)}x` : null,
      p95_ath_mult: summary.p95_ath_mult ? `${summary.p95_ath_mult.toFixed(3)}x` : null,
      pct_hit_2x: `${summary.pct_hit_2x.toFixed(2)}%`,
      pct_hit_3x: `${summary.pct_hit_3x.toFixed(2)}%`,
      pct_hit_4x: `${summary.pct_hit_4x.toFixed(2)}%`,
      pct_hit_5x: `${summary.pct_hit_5x.toFixed(2)}%`,
      pct_hit_10x: `${summary.pct_hit_10x.toFixed(2)}%`,
      median_time_to_recovery_s: summary.median_time_to_recovery_s,
      median_time_to_2x_s: summary.median_time_to_2x_s,
      median_time_to_3x_s: summary.median_time_to_3x_s,
      median_time_to_ath_s: summary.median_time_to_ath_s,
      median_time_to_dd_pre2x_s: summary.median_time_to_dd_pre2x_s,
      median_time_to_dd_after_2x_s: summary.median_time_to_dd_after_2x_s,
      median_dd_initial: summary.median_dd_initial
        ? `${summary.median_dd_initial.toFixed(2)}%`
        : null,
      median_dd_overall: summary.median_dd_overall
        ? `${summary.median_dd_overall.toFixed(2)}%`
        : null,
      median_dd_pre2x_or_horizon: summary.median_dd_pre2x_or_horizon
        ? `${summary.median_dd_pre2x_or_horizon.toFixed(2)}%`
        : null,
      median_peak_pnl_pct: summary.median_peak_pnl_pct
        ? `${summary.median_peak_pnl_pct.toFixed(2)}%`
        : null,
    },
    callers_count: result.callers_count,
  };
}


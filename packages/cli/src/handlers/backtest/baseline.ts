/**
 * Baseline Backtest Handler
 *
 * Runs baseline alert backtests computing per-alert metrics:
 * - ATH multiple after alert
 * - Max drawdown after alert
 * - Max drawdown before first 2x
 * - Time-to-2x
 * - Simple TP/SL exit policy returns
 *
 * Pure handler - no console.log, no process.exit, no try/catch.
 */

import { spawn } from 'child_process';
import { join } from 'path';
import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { backtestBaselineSchema } from '../../command-defs/backtest.js';
import { findWorkspaceRoot } from '@quantbot/utils';

export type BacktestBaselineArgs = z.infer<typeof backtestBaselineSchema>;

/**
 * Run baseline alert backtest in TUI mode (stdio passthrough)
 */
async function runTuiMode(
  args: BacktestBaselineArgs
): Promise<{ success: boolean; message: string }> {
  const workspaceRoot = findWorkspaceRoot();
  const scriptPath = join(workspaceRoot, 'tools/backtest/alert_baseline_backtest.py');

  // Build CLI args for Python script
  const cliArgs: string[] = [scriptPath, '--tui'];

  // Required args
  const duckdbPath = args.duckdb.startsWith('/') ? args.duckdb : join(workspaceRoot, args.duckdb);
  cliArgs.push('--duckdb', duckdbPath);
  cliArgs.push('--chain', args.chain);

  // Dates
  if (args.from) cliArgs.push('--from', args.from);
  if (args.to) cliArgs.push('--to', args.to);

  // Core params
  cliArgs.push('--interval-seconds', String(args.intervalSeconds));
  cliArgs.push('--horizon-hours', String(args.horizonHours));
  cliArgs.push('--threads', String(args.threads));

  // Output
  const outDir = args.outDir.startsWith('/') ? args.outDir : join(workspaceRoot, args.outDir);
  cliArgs.push('--out-dir', outDir);
  if (args.outCsv) cliArgs.push('--out-csv', args.outCsv);

  // Slice management
  const sliceDir = args.sliceDir.startsWith('/')
    ? args.sliceDir
    : join(workspaceRoot, args.sliceDir);
  cliArgs.push('--slice-dir', sliceDir);
  if (args.reuseSlice) cliArgs.push('--reuse-slice');
  cliArgs.push('--min-coverage-pct', String(args.minCoveragePct));

  // ClickHouse
  if (args.chHost) cliArgs.push('--ch-host', args.chHost);
  if (args.chPort) cliArgs.push('--ch-port', String(args.chPort));
  if (args.chDb) cliArgs.push('--ch-db', args.chDb);
  if (args.chTable) cliArgs.push('--ch-table', args.chTable);
  if (args.chUser) cliArgs.push('--ch-user', args.chUser);
  if (args.chPass) cliArgs.push('--ch-pass', args.chPass);
  if (args.chConnectTimeout) cliArgs.push('--ch-connect-timeout', String(args.chConnectTimeout));
  if (args.chTimeoutS) cliArgs.push('--ch-timeout-s', String(args.chTimeoutS));

  // (TP/SL policy removed - pure path metrics only)

  return new Promise((resolve, reject) => {
    const child = spawn('python3', cliArgs, {
      cwd: join(workspaceRoot, 'tools/backtest'),
      stdio: 'inherit', // Pass through to terminal
      env: { ...process.env },
    });

    child.on('error', (err) => {
      reject(new Error(`Failed to start Python script: ${err.message}`));
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, message: 'TUI backtest completed' });
      } else {
        reject(new Error(`Python script exited with code ${code}`));
      }
    });
  });
}

/**
 * Run baseline alert backtest
 *
 * @param args - Validated command arguments
 * @param ctx - Command context with services
 * @returns Backtest result with summary metrics
 */
export async function baselineBacktestHandler(args: BacktestBaselineArgs, ctx: CommandContext) {
  // TUI mode: run Python script with stdio passthrough
  if (args.tui) {
    return runTuiMode(args);
  }

  await ctx.ensureInitialized();

  const service = ctx.services.backtestBaseline();

  const result = await service.runBaseline({
    duckdbPath: args.duckdb,
    chain: args.chain,
    dateFrom: args.from,
    dateTo: args.to,
    intervalSeconds: args.intervalSeconds,
    horizonHours: args.horizonHours,
    outDir: args.outDir,
    outCsv: args.outCsv,
    threads: args.threads,

    // Slice management (offline backtest)
    sliceDir: args.sliceDir,
    reuseSlice: args.reuseSlice,
    minCoveragePct: args.minCoveragePct,

    // ClickHouse (native protocol)
    chHost: args.chHost,
    chPort: args.chPort,
    chDb: args.chDb,
    chTable: args.chTable,
    chUser: args.chUser,
    chPass: args.chPass,
    chConnectTimeout: args.chConnectTimeout,
    chTimeoutS: args.chTimeoutS,

    // (TP/SL policy removed - pure path metrics only)
  });

  if (!result.success) {
    throw new Error(result.error ?? 'Backtest failed');
  }

  // Format summary for display
  const summary = result.summary;
  if (!summary) {
    return {
      success: true,
      message: 'Backtest completed but no summary available',
      csvPath: result.csv_path,
    };
  }

  return {
    success: true,
    csvPath: result.csv_path,
    slicePath: result.slice_path,
    worklistPath: result.worklist_path,
    config: result.config,
    summary: {
      alertsTotal: summary.alerts_total,
      alertsOk: summary.alerts_ok,
      alertsMissing: summary.alerts_missing,
      medianAthMult: summary.median_ath_mult ? `${summary.median_ath_mult.toFixed(3)}x` : null,
      medianTimeToAthHours: summary.median_time_to_ath_hours
        ? `${summary.median_time_to_ath_hours.toFixed(2)}h`
        : null,
      medianTimeTo2xHours: summary.median_time_to_2x_hours
        ? `${summary.median_time_to_2x_hours.toFixed(2)}h`
        : null,
      medianTimeTo3xHours: summary.median_time_to_3x_hours
        ? `${summary.median_time_to_3x_hours.toFixed(2)}h`
        : null,
      medianDdOverallPct: summary.median_dd_overall_pct
        ? `${summary.median_dd_overall_pct.toFixed(2)}%`
        : null,
      medianDdAfter2xPct: summary.median_dd_after_2x_pct
        ? `${summary.median_dd_after_2x_pct.toFixed(2)}%`
        : null,
      medianDdAfter3xPct: summary.median_dd_after_3x_pct
        ? `${summary.median_dd_after_3x_pct.toFixed(2)}%`
        : null,
      medianPeakPnlPct: summary.median_peak_pnl_pct
        ? `${summary.median_peak_pnl_pct.toFixed(2)}%`
        : null,
      medianRetEndPct: summary.median_ret_end_pct
        ? `${summary.median_ret_end_pct.toFixed(2)}%`
        : null,
      pctHit2x: `${summary.pct_hit_2x.toFixed(2)}%`,
      medianTpSlRetPct: summary.median_tp_sl_ret_pct
        ? `${summary.median_tp_sl_ret_pct.toFixed(2)}%`
        : null,
    },
  };
}

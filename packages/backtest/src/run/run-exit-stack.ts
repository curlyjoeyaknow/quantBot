import type { Candle } from '@quantbot/core';
import type duckdb from 'duckdb';
import { resolveExitPlanFromDuckDb } from '../strategy/resolve-exit-plan.js';
import { backtestExitStack } from '../engine/backtest-exit-stack.js';
import { insertCallResults } from '../reporting/backtest-results-duckdb.js';
import { computePathMetrics } from '../metrics/path-metrics.js';

export type CallRecord = {
  callId: string;
  caller: string;
  mint: string;
  chain: string;
  callTsMs: number;
};

export type ExitStackRunArgs = {
  runId: string;
  strategyId: string;

  interval: string;
  entryDelayMs: number;

  positionUsd: number;
  takerFeeBps: number;
  slippageBps: number;

  // Data already prepared by your pipeline:
  calls: CallRecord[];
  candlesByCallId: Map<string, Candle[]>;
};

export async function runExitStack(db: duckdb.Database, args: ExitStackRunArgs) {
  const plan = await resolveExitPlanFromDuckDb(db, args.strategyId);

  const rows: any[] = [];

  for (const call of args.calls) {
    const candles = args.candlesByCallId.get(call.callId) ?? [];
    if (candles.length === 0) continue;

    const entryTsMs = call.callTsMs + args.entryDelayMs;

    const { trade } = backtestExitStack({
      callId: call.callId,
      caller: call.caller,
      tokenAddress: call.mint as any,
      chain: call.chain as any,
      candles,
      entryTsMs,
      entryDelayMs: args.entryDelayMs,
      plan,
      positionUsd: args.positionUsd,
      takerFeeBps: args.takerFeeBps,
      slippageBps: args.slippageBps,
    });

    if (!trade) continue;

    // Caller quality metrics anchored at ALERT time (call timestamp).
    // If you later want "actionable" entry-anchored metrics, compute a second set with entryTsMs.
    const path = computePathMetrics(candles, call.callTsMs, { activity_move_pct: 0.1 });

    const return_bps = trade.pnl.netReturnPct * 100; // pct -> bps
    const pnl_usd = (trade.pnl.netReturnPct / 100) * args.positionUsd;

    rows.push({
      run_id: args.runId,
      call_id: call.callId,
      caller_name: trade.caller,
      mint: String(trade.tokenAddress),
      interval: args.interval,

      entry_ts_ms: trade.entry.tsMs,
      exit_ts_ms: trade.exit.tsMs,
      entry_px: trade.entry.px,
      exit_px: trade.exit.px,

      return_bps,
      pnl_usd,

      hold_ms: trade.exit.tsMs - trade.entry.tsMs,
      exit_reason: trade.exit.reason ?? null,

      // path metrics
      t0_ms: path.t0_ms,
      p0: isFinite(path.p0) ? path.p0 : null,

      hit_2x: path.hit_2x,
      t_2x_ms: path.t_2x_ms,
      hit_3x: path.hit_3x,
      t_3x_ms: path.t_3x_ms,
      hit_4x: path.hit_4x,
      t_4x_ms: path.t_4x_ms,

      dd_bps: path.dd_bps,
      dd_to_2x_bps: path.dd_to_2x_bps,
      alert_to_activity_ms: path.alert_to_activity_ms,
      peak_multiple: path.peak_multiple,
    });
  }

  await insertCallResults(db as any, rows);
  return { inserted: rows.length };
}

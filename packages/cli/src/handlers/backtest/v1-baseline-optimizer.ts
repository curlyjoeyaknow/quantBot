/**
 * V1 Baseline Optimizer Handler
 *
 * Orchestrates Python-based capital-aware optimization.
 * TypeScript handles data loading and planning, Python handles computation.
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { backtestV1BaselineSchema } from '../../command-defs/backtest.js';
import { DateTime } from 'luxon';
import {
  planBacktest,
  checkCoverage,
  materialiseSlice,
  loadCandlesFromSlice,
} from '@quantbot/backtest';
import type { CallRecord } from '@quantbot/backtest';

export type V1BaselineOptimizerArgs = z.infer<typeof backtestV1BaselineSchema>;

/**
 * Helper function to convert interval to seconds
 */
function intervalToSeconds(interval: string): number {
  switch (interval) {
    case '1s': return 1;
    case '15s': return 15;
    case '1m': return 60;
    case '5m': return 300;
    case '15m': return 900;
    case '1h': return 3600;
    case '4h': return 14400;
    case '1d': return 86400;
    default: throw new Error(`Unsupported interval: ${interval}`);
  }
}

/**
 * V1 Baseline Optimizer Handler
 */
export async function v1BaselineOptimizerHandler(
  args: V1BaselineOptimizerArgs,
  ctx: CommandContext
): Promise<unknown> {
  // Parse dates
  const from = DateTime.fromISO(args.from);
  const to = DateTime.fromISO(args.to);

  if (!from.isValid) {
    throw new Error(`Invalid from date: ${args.from}`);
  }
  if (!to.isValid) {
    throw new Error(`Invalid to date: ${args.to}`);
  }

  // Load calls from DuckDB
  const { queryCallsDuckdb, createQueryCallsDuckdbContext } = await import('@quantbot/workflows');
  const { getDuckDBPath } = await import('@quantbot/utils');

  const duckdbPath = getDuckDBPath('data/alerts.duckdb');
  const queryCtx = await createQueryCallsDuckdbContext(duckdbPath);

  const callsResult = await queryCallsDuckdb(
    {
      duckdbPath,
      fromISO: args.from,
      toISO: args.to,
      limit: 1000,
    },
    queryCtx
  );

  if (callsResult.calls.length === 0) {
    // Try to get min/max dates from database for helpful error message
    let dateRangeHint = '';
    try {
      const { openDuckDb } = await import('@quantbot/storage');
      // Use read-only connection to avoid locks when querying for error diagnostics
      const conn = await openDuckDb(duckdbPath, { readOnly: true });
      const dateRange = await conn.all<{
        min_ts: number;
        max_ts: number;
        total_calls: number;
      }>(`
        SELECT 
          MIN(alert_ts_ms) as min_ts,
          MAX(alert_ts_ms) as max_ts,
          COUNT(*) as total_calls
        FROM canon.alerts_std
      `);

      if (dateRange.length > 0 && dateRange[0].min_ts && dateRange[0].max_ts) {
        const minDate = DateTime.fromMillis(dateRange[0].min_ts).toISO() || 'unknown';
        const maxDate = DateTime.fromMillis(dateRange[0].max_ts).toISO() || 'unknown';
        dateRangeHint = `\n\nAvailable date range in database: ${minDate} to ${maxDate} (${dateRange[0].total_calls} total calls)`;
      } else if (dateRange.length > 0 && dateRange[0].total_calls === 0) {
        dateRangeHint = '\n\nDatabase is empty - no calls found in canon.alerts_std table.';
      }
    } catch (error) {
      // If query fails, just provide generic hint
      dateRangeHint = '\n\nNote: Could not query available date range from database.';
    }

    throw new Error(
      `No calls found in the specified date range (${args.from} to ${args.to}).` +
        `\nDatabase path: ${duckdbPath}` +
        dateRangeHint +
        `\n\nTo check for calls, try:` +
        `\n  1. Check date range: quantbot calls list --from ${args.from} --to ${args.to}` +
        `\n  2. List all calls: quantbot calls list` +
        `\n  3. If database is empty, ingest data: quantbot ingestion telegram --file <telegram-export.json>`
    );
  }

  // Convert to CallRecord format
  const calls: CallRecord[] = callsResult.calls.map((call) => ({
    id: call.id,
    caller: call.caller,
    mint: call.mint as import('@quantbot/core').TokenAddress,
    createdAt: call.createdAt,
  }));

  // Filter by caller groups if specified
  let callsToUse = calls;
  if (args.callerGroups && args.callerGroups.length > 0) {
    callsToUse = calls.filter((call) => args.callerGroups!.includes(call.caller));
  }

  // Plan and coverage check
  const planReq = {
    strategy: {
      id: 'v1-baseline',
      name: 'v1-baseline',
      overlays: [],
      fees: { takerFeeBps: args.takerFeeBps, slippageBps: args.slippageBps },
      position: { notionalUsd: args.initialCapital },
      indicatorWarmup: 0,
      entryDelay: 0,
      maxHold: 2880, // 48 hours at 1m intervals
    },
    calls: callsToUse,
    interval: args.interval as import('@quantbot/backtest').Interval,
    from,
    to,
  };

  const plan = planBacktest(planReq);
  const coverage = await checkCoverage(plan);

  // Debug: Always log coverage statistics
  console.log('\n=== COVERAGE CHECK RESULTS ===');
  console.log(`Total calls queried: ${callsToUse.length}`);
  console.log(`Eligible calls (have sufficient data): ${coverage.eligible.length}`);
  console.log(`Excluded calls (missing data): ${coverage.excluded.length}`);
  
  // Group excluded calls by reason
  const excludedByReason = new Map<string, number>();
  for (const excluded of coverage.excluded) {
    const reason = excluded.reason || 'unknown';
    excludedByReason.set(reason, (excludedByReason.get(reason) || 0) + 1);
  }

  if (excludedByReason.size > 0) {
    console.log('\n=== EXCLUSION REASONS ===');
    for (const [reason, count] of Array.from(excludedByReason.entries()).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reason}: ${count} calls`);
    }
  }

  // Show sample of excluded calls for debugging
  if (coverage.excluded.length > 0) {
    console.log('\n=== SAMPLE EXCLUDED CALLS (first 5) ===');
    for (let i = 0; i < Math.min(5, coverage.excluded.length); i++) {
      const excluded = coverage.excluded[i];
      const call = callsToUse.find(c => c.id === excluded.callId);
      console.log(`  Call ${i + 1}:`);
      console.log(`    ID: ${excluded.callId}`);
      console.log(`    Mint: ${call?.mint.substring(0, 20)}...`);
      console.log(`    Caller: ${call?.caller || 'unknown'}`);
      console.log(`    Reason: ${excluded.reason}`);
      console.log(`    Token: ${excluded.tokenAddress}`);
      console.log(`    Chain: ${excluded.chain}`);
    }
  }

  // Show plan details
  console.log('\n=== BACKTEST PLAN DETAILS ===');
  console.log(`Interval: ${args.interval}`);
  console.log(`Indicator warmup: ${plan.indicatorWarmupCandles} candles`);
  console.log(`Entry delay: ${plan.entryDelayCandles} candles`);
  console.log(`Max hold: ${plan.maxHoldCandles} candles`);
  console.log(`Total required candles per call: ${plan.totalRequiredCandles}`);
  console.log(`Time window per call: ${plan.indicatorWarmupCandles * intervalToSeconds(args.interval as any) / 60} min before → ${plan.maxHoldCandles * intervalToSeconds(args.interval as any) / 60} min after`);
  console.log('==============================\n');

  if (coverage.eligible.length === 0) {
    const reasonSummary = Array.from(excludedByReason.entries())
      .map(([reason, count]) => `${reason}: ${count}`)
      .join(', ');

    throw new Error(
      `No eligible calls after coverage check. ${coverage.excluded.length} calls excluded (${reasonSummary}). ` +
        `This usually means candle data is missing in ClickHouse for the date range/interval. ` +
        `Try: 1) Check if candles exist for this range, 2) Use a different interval (e.g., 5m instead of 1m), ` +
        `3) Ensure OHLCV data has been ingested for this period.`
    );
  }

  // Materialize slice and load candles (with optional catalog reuse)
  const slice = await materialiseSlice(plan, coverage, {
    catalogPath: args.catalogPath,
    catalogResult: false, // Don't catalog the final result for now (can be enabled later)
  });
  const candlesByCallId = await loadCandlesFromSlice(slice.path);

  // Filter calls to only eligible ones
  let eligibleCalls = callsToUse.filter((call) =>
    coverage.eligible.some((e) => e.callId === call.id)
  );

  // Filter by minimum calls per caller if specified
  if (args.minCalls > 0) {
    // Count calls per caller
    const callsByCaller = new Map<string, number>();
    for (const call of eligibleCalls) {
      callsByCaller.set(call.caller, (callsByCaller.get(call.caller) || 0) + 1);
    }

    // Filter to only callers with >= minCalls
    const validCallers = new Set<string>();
    for (const [caller, count] of callsByCaller) {
      if (count >= args.minCalls) {
        validCallers.add(caller);
      }
    }

    eligibleCalls = eligibleCalls.filter((call) => validCallers.has(call.caller));

    if (eligibleCalls.length === 0) {
      throw new Error(`No callers found with at least ${args.minCalls} calls after filtering`);
    }
  }

  // Get Python service from context
  const pythonService = ctx.services.v1BaselinePython();

  // Prepare data for Python service
  const callsForPython = eligibleCalls.map((call) => ({
    id: call.id,
    mint: call.mint,
    caller: call.caller,
    ts_ms: call.createdAt instanceof Date ? call.createdAt.getTime() : call.createdAt.toMillis(),
  }));

  const candlesForPython: Record<
    string,
    Array<{
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>
  > = {};

  for (const [callId, candles] of Object.entries(candlesByCallId)) {
    candlesForPython[callId] = candles.map((c: import('@quantbot/backtest').Candle) => ({
      timestamp: c.timestamp / 1000, // Convert ms to seconds for Python
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    }));
  }

  // Build parameter grid
  const paramGrid = {
    tp_mults: args.tpMults,
    sl_mults: args.slMults,
    max_hold_hrs: args.maxHoldHrs,
  };

  // Build simulator config
  const simulatorConfig = {
    initial_capital: args.initialCapital,
    max_allocation_pct: args.maxAllocationPct,
    max_risk_per_trade: args.maxRiskPerTrade,
    max_concurrent_positions: args.maxConcurrentPositions,
    min_executable_size: args.minExecutableSize,
    taker_fee_bps: args.takerFeeBps,
    slippage_bps: args.slippageBps,
  };

  // Run optimization based on mode
  if (args.mode === 'per-caller') {
    const perCallerResults = await pythonService.optimizeV1BaselinePerCaller({
      calls: callsForPython,
      candles_by_call_id: candlesForPython,
      param_grid: paramGrid,
      simulator_config: simulatorConfig,
      verbose: false,
    });

    return {
      mode: 'per-caller',
      results: Object.entries(perCallerResults).map(([caller, result]) => ({
        caller,
        bestParams: result.best_params,
        bestFinalCapital: result.best_final_capital,
        bestTotalReturn: (result.best_total_return * 100).toFixed(2) + '%',
        collapsedCapital: result.collapsed_capital,
        requiresExtremeParams: result.requires_extreme_params,
      })),
    };
  } else if (args.mode === 'grouped') {
    const groupedResult = await pythonService.runV1BaselineGroupedEvaluation({
      calls: callsForPython,
      candles_by_call_id: candlesForPython,
      param_grid: paramGrid,
      simulator_config: simulatorConfig,
      filter_collapsed: args.filterCollapsed,
      filter_extreme: args.filterExtreme,
      verbose: false,
    });

    return {
      mode: 'grouped',
      perCallerResults: Object.entries(groupedResult.per_caller_results).map(
        ([caller, result]) => ({
          caller,
          bestParams: result.best_params,
          bestFinalCapital: result.best_final_capital,
          bestTotalReturn: (result.best_total_return * 100).toFixed(2) + '%',
          collapsedCapital: result.collapsed_capital,
          requiresExtremeParams: result.requires_extreme_params,
        })
      ),
      selectedCallers: groupedResult.selected_callers,
      groupedResult: groupedResult.grouped_result
        ? {
            finalCapital: groupedResult.grouped_result.final_capital,
            totalReturn: (groupedResult.grouped_result.total_return * 100).toFixed(2) + '%',
            tradesExecuted: groupedResult.grouped_result.trades_executed,
            tradesSkipped: groupedResult.grouped_result.trades_skipped,
          }
        : null,
      groupedParams: groupedResult.grouped_params,
    };
  } else {
    // Both mode: run per-caller and grouped
    const perCallerResults = await pythonService.optimizeV1BaselinePerCaller({
      calls: callsForPython,
      candles_by_call_id: candlesForPython,
      param_grid: paramGrid,
      simulator_config: simulatorConfig,
      verbose: false,
    });

    const groupedResult = await pythonService.runV1BaselineGroupedEvaluation({
      calls: callsForPython,
      candles_by_call_id: candlesForPython,
      param_grid: paramGrid,
      simulator_config: simulatorConfig,
      filter_collapsed: args.filterCollapsed,
      filter_extreme: args.filterExtreme,
      verbose: false,
    });

    return {
      mode: 'both',
      perCaller: Object.entries(perCallerResults).map(([caller, result]) => ({
        caller,
        bestParams: result.best_params,
        bestFinalCapital: result.best_final_capital,
        bestTotalReturn: (result.best_total_return * 100).toFixed(2) + '%',
        collapsedCapital: result.collapsed_capital,
        requiresExtremeParams: result.requires_extreme_params,
      })),
      grouped: {
        selectedCallers: groupedResult.selected_callers,
        groupedResult: groupedResult.grouped_result
          ? {
              finalCapital: groupedResult.grouped_result.final_capital,
              totalReturn: (groupedResult.grouped_result.total_return * 100).toFixed(2) + '%',
              tradesExecuted: groupedResult.grouped_result.trades_executed,
              tradesSkipped: groupedResult.grouped_result.trades_skipped,
            }
          : null,
        groupedParams: groupedResult.grouped_params,
      },
    };
  }
}

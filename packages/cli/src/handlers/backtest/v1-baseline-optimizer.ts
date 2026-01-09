/**
 * V1 Baseline Optimizer Handler
 *
 * Handles capital-aware optimization with finite capital and position constraints.
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { backtestV1BaselineSchema } from '../../command-defs/backtest.js';
import { DateTime } from 'luxon';
import {
  optimizeV1Baseline,
  optimizeV1BaselinePerCaller,
  runV1BaselineGroupedEvaluation,
  type V1BaselineParams,
} from '@quantbot/backtest';
import { planBacktest, checkCoverage, materialiseSlice, loadCandlesFromSlice } from '@quantbot/backtest';
import type { CallRecord } from '@quantbot/backtest';

export type V1BaselineOptimizerArgs = z.infer<typeof backtestV1BaselineSchema>;

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
    throw new Error('No calls found in the specified date range');
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

  if (coverage.eligible.length === 0) {
    throw new Error('No eligible calls after coverage check');
  }

  // Materialize slice and load candles
  const slice = await materialiseSlice(plan, coverage);
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
      throw new Error(
        `No callers found with at least ${args.minCalls} calls after filtering`
      );
    }
  }

  // Build parameter grid
  const paramGrid = {
    tp_mults: args.tpMults,
    sl_mults: args.slMults,
    max_hold_hrs: args.maxHoldHrs,
  };

  // Build simulator config
  const simulatorConfig = {
    initialCapital: args.initialCapital,
    maxAllocationPct: args.maxAllocationPct,
    maxRiskPerTrade: args.maxRiskPerTrade,
    maxConcurrentPositions: args.maxConcurrentPositions,
    minExecutableSize: args.minExecutableSize,
    fees: {
      takerFeeBps: args.takerFeeBps,
      slippageBps: args.slippageBps,
    },
  };

  // Run optimization based on mode
  if (args.mode === 'per-caller') {
    const perCallerResults = optimizeV1BaselinePerCaller(
      eligibleCalls,
      candlesByCallId,
      paramGrid,
      simulatorConfig
    );

    return {
      mode: 'per-caller',
      results: Array.from(perCallerResults.entries()).map(([caller, result]) => ({
        caller,
        bestParams: result.bestParams,
        bestFinalCapital: result.bestFinalCapital,
        bestTotalReturn: (result.bestTotalReturn * 100).toFixed(2) + '%',
        collapsedCapital: result.collapsedCapital,
        requiresExtremeParams: result.requiresExtremeParams,
      })),
    };
  } else if (args.mode === 'grouped') {
    const groupedResult = runV1BaselineGroupedEvaluation(eligibleCalls, candlesByCallId, {
      paramGrid,
      simulatorConfig,
      filterCollapsed: args.filterCollapsed,
      filterExtreme: args.filterExtreme,
    });

    return {
      mode: 'grouped',
      perCallerResults: Array.from(groupedResult.perCallerResults.entries()).map(([caller, result]) => ({
        caller,
        bestParams: result.bestParams,
        bestFinalCapital: result.bestFinalCapital,
        bestTotalReturn: (result.bestTotalReturn * 100).toFixed(2) + '%',
        collapsedCapital: result.collapsedCapital,
        requiresExtremeParams: result.requiresExtremeParams,
      })),
      selectedCallers: groupedResult.selectedCallers,
      groupedResult: groupedResult.groupedResult
        ? {
            finalCapital: groupedResult.groupedResult.finalCapital,
            totalReturn: (groupedResult.groupedResult.totalReturn * 100).toFixed(2) + '%',
            tradesExecuted: groupedResult.groupedResult.tradesExecuted,
            tradesSkipped: groupedResult.groupedResult.tradesSkipped,
          }
        : null,
      groupedParams: groupedResult.groupedParams,
    };
  } else {
    // Both mode: run per-caller and grouped
    const perCallerResults = optimizeV1BaselinePerCaller(
      eligibleCalls,
      candlesByCallId,
      paramGrid,
      simulatorConfig
    );

    const groupedResult = runV1BaselineGroupedEvaluation(eligibleCalls, candlesByCallId, {
      paramGrid,
      simulatorConfig,
      filterCollapsed: args.filterCollapsed,
      filterExtreme: args.filterExtreme,
    });

    return {
      mode: 'both',
      perCaller: Array.from(perCallerResults.entries()).map(([caller, result]) => ({
        caller,
        bestParams: result.bestParams,
        bestFinalCapital: result.bestFinalCapital,
        bestTotalReturn: (result.bestTotalReturn * 100).toFixed(2) + '%',
        collapsedCapital: result.collapsedCapital,
        requiresExtremeParams: result.requiresExtremeParams,
      })),
      grouped: {
        selectedCallers: groupedResult.selectedCallers,
        groupedResult: groupedResult.groupedResult
          ? {
              finalCapital: groupedResult.groupedResult.finalCapital,
              totalReturn: (groupedResult.groupedResult.totalReturn * 100).toFixed(2) + '%',
              tradesExecuted: groupedResult.groupedResult.tradesExecuted,
              tradesSkipped: groupedResult.groupedResult.tradesSkipped,
            }
          : null,
        groupedParams: groupedResult.groupedParams,
      },
    };
  }
}


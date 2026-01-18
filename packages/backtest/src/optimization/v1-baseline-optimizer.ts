/**
 * V1 Baseline Optimizer
 *
 * Optimization Method — V1 (Baseline, pre-B/E)
 *
 * Features:
 * - Capital-aware simulation with finite capital (C₀ = 10,000)
 * - Position constraints (max 4% allocation, max $200 risk, max 25 concurrent)
 * - Position sizing: min(size_risk, size_alloc, free_cash)
 * - Trade lifecycle: TP at tp_mult, SL at sl_mult, Time exit at 48h
 * - Objective: maximize final capital (C_final)
 * - Evaluation: per-caller then grouped
 */

import type { Candle } from '@quantbot/core';
import type { CallRecord } from '../types.js';
import {
  simulateCapitalAware,
  type V1BaselineParams,
  type CapitalSimulationResult,
  type CapitalSimulatorConfig,
} from './capital-simulator.js';
import { logger } from '@quantbot/infra/utils';

// =============================================================================
// Types
// =============================================================================

/**
 * V1 Baseline optimization result
 */
export interface V1BaselineOptimizationResult {
  /** Best parameters found */
  bestParams: V1BaselineParams | null;
  /** Best final capital */
  bestFinalCapital: number;
  /** Best total return */
  bestTotalReturn: number;
  /** All parameter combinations evaluated (sorted by final capital descending) */
  allResults: Array<{
    params: V1BaselineParams;
    result: CapitalSimulationResult;
  }>;
  /** Number of parameter combinations evaluated */
  paramsEvaluated: number;
}

/**
 * V1 Baseline optimization request
 */
export interface V1BaselineOptimizeRequest {
  /** Calls to optimize for */
  calls: CallRecord[];
  /** Candles by call ID */
  candlesByCallId: Map<string, Candle[]>;
  /** Parameter grid (if not provided, uses default grid) */
  paramGrid?: {
    tp_mults?: number[];
    sl_mults?: number[];
    max_hold_hrs?: number[];
  };
  /** Capital simulator configuration */
  simulatorConfig?: CapitalSimulatorConfig;
  /** Optional: filter to specific caller groups */
  callerGroups?: string[];
}

/**
 * Per-caller optimization result
 */
export interface V1BaselinePerCallerResult {
  /** Caller name */
  caller: string;
  /** Best parameters for this caller */
  bestParams: V1BaselineParams | null;
  /** Best final capital */
  bestFinalCapital: number;
  /** Best total return */
  bestTotalReturn: number;
  /** Whether caller collapsed capital (C_final < C₀) */
  collapsedCapital: boolean;
  /** Whether caller requires extreme parameters to survive */
  requiresExtremeParams: boolean;
}

// =============================================================================
// Default Parameter Grids
// =============================================================================

/**
 * Default take-profit multiples
 */
const DEFAULT_TP_MULTS = [1.5, 2.0, 2.5, 3.0, 4.0, 5.0];

/**
 * Default stop-loss multiples (e.g., 0.85 = -15%, 0.90 = -10%)
 */
const DEFAULT_SL_MULTS = [0.85, 0.88, 0.9, 0.92, 0.95];

/**
 * Default max hold hours (defaults to 48, but can test shorter)
 */
const DEFAULT_MAX_HOLD_HRS = [48]; // Only 48h for V1 baseline

// =============================================================================
// V1 Baseline Optimizer
// =============================================================================

/**
 * Optimize V1 baseline parameters for a set of calls
 *
 * Performs grid search over tp_mult and sl_mult to maximize final capital.
 */
export function optimizeV1Baseline(req: V1BaselineOptimizeRequest): V1BaselineOptimizationResult {
  // Filter calls by caller groups if specified
  let callsToOptimize = req.calls;
  if (req.callerGroups && req.callerGroups.length > 0) {
    callsToOptimize = req.calls.filter((call) => req.callerGroups!.includes(call.caller));
    logger.info('Filtering calls by caller groups', {
      callerGroups: req.callerGroups,
      originalCount: req.calls.length,
      filteredCount: callsToOptimize.length,
    });
  }

  // Generate parameter grid
  const tpMults = req.paramGrid?.tp_mults ?? DEFAULT_TP_MULTS;
  const slMults = req.paramGrid?.sl_mults ?? DEFAULT_SL_MULTS;
  const maxHoldHrs = req.paramGrid?.max_hold_hrs ?? DEFAULT_MAX_HOLD_HRS;

  logger.info('Starting V1 baseline optimization', {
    calls: callsToOptimize.length,
    tpMults: tpMults.length,
    slMults: slMults.length,
    maxHoldHrs: maxHoldHrs.length,
    totalCombinations: tpMults.length * slMults.length * maxHoldHrs.length,
  });

  // Evaluate each parameter combination
  const results: Array<{ params: V1BaselineParams; result: CapitalSimulationResult }> = [];

  for (const tpMult of tpMults) {
    for (const slMult of slMults) {
      for (const maxHoldHr of maxHoldHrs) {
        const params: V1BaselineParams = {
          tp_mult: tpMult,
          sl_mult: slMult,
          max_hold_hrs: maxHoldHr,
        };

        // Run capital simulation
        const result = simulateCapitalAware(
          callsToOptimize,
          req.candlesByCallId,
          params,
          req.simulatorConfig
        );

        results.push({ params, result });
      }
    }
  }

  // Sort by final capital (descending) - objective is to maximize C_final
  results.sort((a, b) => b.result.finalCapital - a.result.finalCapital);

  const best = results[0];
  const bestParams = best ? best.params : null;
  const bestFinalCapital = best ? best.result.finalCapital : 0;
  const bestTotalReturn = best ? best.result.totalReturn : 0;

  logger.info('V1 baseline optimization complete', {
    paramsEvaluated: results.length,
    bestFinalCapital,
    bestTotalReturn,
    bestParams,
  });

  return {
    bestParams,
    bestFinalCapital,
    bestTotalReturn,
    allResults: results,
    paramsEvaluated: results.length,
  };
}

/**
 * Optimize V1 baseline per caller
 *
 * Runs optimization for each caller separately and returns best parameters per caller.
 * Also identifies callers that collapse capital or require extreme parameters.
 */
export function optimizeV1BaselinePerCaller(
  calls: CallRecord[],
  candlesByCallId: Map<string, Candle[]>,
  paramGrid?: V1BaselineOptimizeRequest['paramGrid'],
  simulatorConfig?: CapitalSimulatorConfig
): Map<string, V1BaselinePerCallerResult> {
  // Group calls by caller
  const callsByCaller = new Map<string, CallRecord[]>();
  for (const call of calls) {
    const existing = callsByCaller.get(call.caller) || [];
    existing.push(call);
    callsByCaller.set(call.caller, existing);
  }

  const results = new Map<string, V1BaselinePerCallerResult>();

  for (const [caller, callerCalls] of callsByCaller) {
    logger.info('Optimizing V1 baseline for caller', { caller, calls: callerCalls.length });

    const optimizeResult = optimizeV1Baseline({
      calls: callerCalls,
      candlesByCallId,
      paramGrid,
      simulatorConfig,
    });

    // Check if caller collapsed capital
    const collapsedCapital =
      optimizeResult.bestFinalCapital < (simulatorConfig?.initialCapital ?? 10_000);

    // Check if requires extreme parameters (heuristic: very tight SL < 0.88 or very high TP > 4.0)
    const requiresExtremeParams =
      optimizeResult.bestParams !== null &&
      (optimizeResult.bestParams.sl_mult < 0.88 || optimizeResult.bestParams.tp_mult > 4.0);

    results.set(caller, {
      caller,
      bestParams: optimizeResult.bestParams,
      bestFinalCapital: optimizeResult.bestFinalCapital,
      bestTotalReturn: optimizeResult.bestTotalReturn,
      collapsedCapital,
      requiresExtremeParams,
    });
  }

  return results;
}

/**
 * Run grouped evaluation with per-caller optimized parameters
 *
 * First optimizes per caller, filters out collapsed/extreme callers,
 * then runs grouped simulation with selected callers.
 */
export function runV1BaselineGroupedEvaluation(
  calls: CallRecord[],
  candlesByCallId: Map<string, Candle[]>,
  options?: {
    paramGrid?: V1BaselineOptimizeRequest['paramGrid'];
    simulatorConfig?: CapitalSimulatorConfig;
    /** Filter out callers that collapsed capital alone */
    filterCollapsed?: boolean;
    /** Filter out callers requiring extreme parameters */
    filterExtreme?: boolean;
  }
): {
  perCallerResults: Map<string, V1BaselinePerCallerResult>;
  selectedCallers: string[];
  groupedResult: CapitalSimulationResult | null;
  groupedParams: V1BaselineParams | null;
} {
  // Optimize per caller
  const perCallerResults = optimizeV1BaselinePerCaller(
    calls,
    candlesByCallId,
    options?.paramGrid,
    options?.simulatorConfig
  );

  // Filter callers
  const selectedCallers: string[] = [];
  for (const [caller, result] of perCallerResults) {
    if (options?.filterCollapsed && result.collapsedCapital) {
      continue; // Skip collapsed callers
    }
    if (options?.filterExtreme && result.requiresExtremeParams) {
      continue; // Skip extreme parameter callers
    }
    selectedCallers.push(caller);
  }

  logger.info('Grouped evaluation filtering', {
    totalCallers: perCallerResults.size,
    selectedCallers: selectedCallers.length,
    filteredOut: perCallerResults.size - selectedCallers.length,
  });

  // For grouped evaluation, use average parameters from selected callers
  // (Alternatively, could use best-performing caller's params, or optimize on grouped set)
  let groupedParams: V1BaselineParams | null = null;
  let groupedResult: CapitalSimulationResult | null = null;

  if (selectedCallers.length > 0) {
    // Calculate average parameters from selected callers
    let avgTpMult = 0;
    let avgSlMult = 0;
    let count = 0;

    for (const caller of selectedCallers) {
      const result = perCallerResults.get(caller);
      if (result?.bestParams) {
        avgTpMult += result.bestParams.tp_mult;
        avgSlMult += result.bestParams.sl_mult;
        count++;
      }
    }

    if (count > 0) {
      groupedParams = {
        tp_mult: avgTpMult / count,
        sl_mult: avgSlMult / count,
        max_hold_hrs: 48, // Fixed for V1
      };

      // Filter calls to selected callers
      const selectedCalls = calls.filter((call) => selectedCallers.includes(call.caller));

      // Run grouped simulation
      groupedResult = simulateCapitalAware(
        selectedCalls,
        candlesByCallId,
        groupedParams,
        options?.simulatorConfig
      );

      logger.info('Grouped evaluation complete', {
        selectedCallers: selectedCallers.length,
        groupedFinalCapital: groupedResult.finalCapital,
        groupedTotalReturn: groupedResult.totalReturn,
        groupedParams,
      });
    }
  }

  return {
    perCallerResults,
    selectedCallers,
    groupedResult,
    groupedParams,
  };
}

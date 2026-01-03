/**
 * Policy Optimizer (Phase 5 - MVP 3)
 *
 * Grid search over policy parameters per caller to find optimal policies.
 * Scores policies using the hard contract (Guardrail 4).
 */

import type { Candle } from '@quantbot/core';
import type { RiskPolicy, PolicyExecutionResult } from '../policies/risk-policy.js';
import { executePolicy } from '../policies/policy-executor.js';
import {
  scorePolicy,
  comparePolicyScores,
  type OptimizationConstraints,
  type PolicyScore,
  DEFAULT_CONSTRAINTS,
} from './scoring.js';
import type { PolicyResultRow, CallRecord } from '../types.js';
import { POLICY_GRID } from '../policies/risk-policy.js';
import { logger } from '@quantbot/utils';

// =============================================================================
// Types
// =============================================================================

export interface OptimizeRequest {
  /** Calls to optimize for */
  calls: CallRecord[];
  /** Candles by call ID */
  candlesByCallId: Map<string, Candle[]>;
  /** Optimization constraints */
  constraints?: OptimizationConstraints;
  /** Fee structure */
  fees?: { takerFeeBps: number; slippageBps: number };
  /** Policy types to search */
  policyTypes?: Array<'fixed_stop' | 'time_stop' | 'trailing_stop' | 'ladder'>;
}

export interface OptimalPolicy {
  /** The optimal policy configuration */
  policy: RiskPolicy;
  /** Policy score */
  score: PolicyScore;
  /** Policy ID for storage */
  policyId: string;
}

export interface OptimizationResult {
  /** Best policy found */
  bestPolicy: OptimalPolicy | null;
  /** All policies evaluated (sorted by score descending) */
  allPolicies: Array<{ policy: RiskPolicy; score: PolicyScore }>;
  /** Number of policies evaluated */
  policiesEvaluated: number;
  /** Number of policies that satisfied constraints */
  feasiblePolicies: number;
}

// =============================================================================
// Grid Search Optimizer
// =============================================================================

/**
 * Optimize policy for a set of calls
 *
 * Performs grid search over policy parameters and scores each
 * using the hard contract scoring function.
 */
export function optimizePolicy(req: OptimizeRequest): OptimizationResult {
  const constraints = req.constraints || DEFAULT_CONSTRAINTS;
  const fees = req.fees || { takerFeeBps: 30, slippageBps: 10 };
  const policyTypes = req.policyTypes || ['fixed_stop', 'time_stop', 'trailing_stop', 'ladder'];

  // Generate policy grid
  const policies: RiskPolicy[] = [];

  if (policyTypes.includes('fixed_stop')) {
    policies.push(...generateFixedStopPolicies());
  }
  if (policyTypes.includes('time_stop')) {
    policies.push(...generateTimeStopPolicies());
  }
  if (policyTypes.includes('trailing_stop')) {
    policies.push(...generateTrailingStopPolicies());
  }
  if (policyTypes.includes('ladder')) {
    policies.push(...generateLadderPolicies());
  }

  logger.info('Starting policy optimization', {
    calls: req.calls.length,
    policies: policies.length,
    policyTypes,
  });

  // Evaluate each policy
  const evaluatedPolicies: Array<{ policy: RiskPolicy; score: PolicyScore }> = [];

  for (const policy of policies) {
    // Execute policy on all calls
    const results: PolicyResultRow[] = [];

    for (const call of req.calls) {
      const candles = req.candlesByCallId.get(call.id);
      if (!candles || candles.length === 0) continue;

      const alertTsMs = call.createdAt.toMillis();
      const result = executePolicy(candles, alertTsMs, policy, fees);

      if (result.exitReason !== 'no_entry') {
        results.push({
          run_id: 'optimizer',
          policy_id: policyToId(policy),
          call_id: call.id,
          realized_return_bps: result.realizedReturnBps,
          stop_out: result.stopOut,
          max_adverse_excursion_bps: result.maxAdverseExcursionBps,
          time_exposed_ms: result.timeExposedMs,
          tail_capture: result.tailCapture,
          entry_ts_ms: result.entryTsMs,
          exit_ts_ms: result.exitTsMs,
          entry_px: result.entryPx,
          exit_px: result.exitPx,
          exit_reason: result.exitReason,
        });
      }
    }

    // Score the policy
    const score = scorePolicy(results, constraints);
    evaluatedPolicies.push({ policy, score });
  }

  // Sort by score descending
  evaluatedPolicies.sort((a, b) => comparePolicyScores(b.score, a.score));

  const feasiblePolicies = evaluatedPolicies.filter((p) => p.score.constraintsSatisfied).length;

  // Get best policy
  const bestPolicyEntry = evaluatedPolicies.find((p) => p.score.constraintsSatisfied);
  const bestPolicy: OptimalPolicy | null = bestPolicyEntry
    ? {
        policy: bestPolicyEntry.policy,
        score: bestPolicyEntry.score,
        policyId: policyToId(bestPolicyEntry.policy),
      }
    : null;

  logger.info('Policy optimization complete', {
    policiesEvaluated: evaluatedPolicies.length,
    feasiblePolicies,
    bestPolicyId: bestPolicy?.policyId,
    bestScore: bestPolicy?.score.score,
  });

  return {
    bestPolicy,
    allPolicies: evaluatedPolicies,
    policiesEvaluated: evaluatedPolicies.length,
    feasiblePolicies,
  };
}

/**
 * Optimize policy per caller
 *
 * Runs optimization for each caller separately and returns best policy per caller.
 */
export function optimizePolicyPerCaller(
  calls: CallRecord[],
  candlesByCallId: Map<string, Candle[]>,
  constraints?: OptimizationConstraints,
  fees?: { takerFeeBps: number; slippageBps: number }
): Map<string, OptimalPolicy | null> {
  // Group calls by caller
  const callsByCaller = new Map<string, CallRecord[]>();
  for (const call of calls) {
    const existing = callsByCaller.get(call.caller) || [];
    existing.push(call);
    callsByCaller.set(call.caller, existing);
  }

  const results = new Map<string, OptimalPolicy | null>();

  for (const [caller, callerCalls] of callsByCaller) {
    logger.info('Optimizing for caller', { caller, calls: callerCalls.length });

    const result = optimizePolicy({
      calls: callerCalls,
      candlesByCallId,
      constraints,
      fees,
    });

    results.set(caller, result.bestPolicy);
  }

  return results;
}

// =============================================================================
// Policy Grid Generators
// =============================================================================

function generateFixedStopPolicies(): RiskPolicy[] {
  const policies: RiskPolicy[] = [];

  for (const stopPct of POLICY_GRID.fixedStop.stopPct) {
    for (const takeProfitPct of POLICY_GRID.fixedStop.takeProfitPct) {
      policies.push({
        kind: 'fixed_stop',
        stopPct,
        takeProfitPct,
      });
    }
  }

  return policies;
}

function generateTimeStopPolicies(): RiskPolicy[] {
  const policies: RiskPolicy[] = [];

  for (const maxHoldMs of POLICY_GRID.timeStop.maxHoldMs) {
    policies.push({
      kind: 'time_stop',
      maxHoldMs,
    });

    // Also add with common take profit levels
    for (const tp of [0.5, 1.0, 2.0]) {
      policies.push({
        kind: 'time_stop',
        maxHoldMs,
        takeProfitPct: tp,
      });
    }
  }

  return policies;
}

function generateTrailingStopPolicies(): RiskPolicy[] {
  const policies: RiskPolicy[] = [];

  for (const activationPct of POLICY_GRID.trailingStop.activationPct) {
    for (const trailPct of POLICY_GRID.trailingStop.trailPct) {
      // Without hard stop
      policies.push({
        kind: 'trailing_stop',
        activationPct,
        trailPct,
      });

      // With hard stops
      for (const hardStopPct of POLICY_GRID.trailingStop.hardStopPct) {
        policies.push({
          kind: 'trailing_stop',
          activationPct,
          trailPct,
          hardStopPct,
        });
      }
    }
  }

  return policies;
}

function generateLadderPolicies(): RiskPolicy[] {
  const policies: RiskPolicy[] = [];

  for (const levels of POLICY_GRID.ladder.configs) {
    // Without stop
    policies.push({
      kind: 'ladder',
      levels,
    });

    // With stops
    for (const stopPct of [0.1, 0.15, 0.2, 0.25]) {
      policies.push({
        kind: 'ladder',
        levels,
        stopPct,
      });
    }
  }

  return policies;
}

// =============================================================================
// Helpers
// =============================================================================

function policyToId(policy: RiskPolicy): string {
  switch (policy.kind) {
    case 'fixed_stop':
      return `fixed_stop_${policy.stopPct}_${policy.takeProfitPct ?? 'none'}`;
    case 'time_stop':
      return `time_stop_${policy.maxHoldMs}_${policy.takeProfitPct ?? 'none'}`;
    case 'trailing_stop':
      return `trailing_${policy.activationPct}_${policy.trailPct}_${policy.hardStopPct ?? 'none'}`;
    case 'ladder':
      const levelsStr = policy.levels.map((l) => `${l.multiple}x${l.fraction}`).join('_');
      return `ladder_${levelsStr}_${policy.stopPct ?? 'none'}`;
    case 'combo':
      return `combo_${policy.policies.map((p) => policyToId(p)).join('+')}`;
    default:
      return 'unknown';
  }
}

export { policyToId };

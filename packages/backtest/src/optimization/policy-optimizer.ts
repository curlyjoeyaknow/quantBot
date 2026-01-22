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
  analyzeCallerHighMultipleProfile,
  type OptimizationConstraints,
  type PolicyScore,
  DEFAULT_CONSTRAINTS,
} from './scoring.js';
import type { PolicyResultRow, CallRecord } from '../types.js';
import { POLICY_GRID } from '../policies/risk-policy.js';
import { logger } from '@quantbot/infra/utils';
import {
  splitCalls,
  type ValidationSplitConfig,
  type ValidationSplitResult,
} from './validation-split.js';
import {
  detectOverfitting,
  formatOverfittingMetrics,
  type OverfittingMetrics,
  type OverfittingDetectionConfig,
} from './overfitting-detection.js';

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
  /** Optional: filter to specific caller groups */
  callerGroups?: string[];
  /** Optional: path metrics for caller profile analysis */
  pathMetricsByCallId?: Map<string, { peak_multiple?: number | null }>;
  /** Optional: validation split configuration */
  validationSplit?: ValidationSplitConfig;
  /** Optional: overfitting detection configuration */
  overfittingConfig?: OverfittingDetectionConfig;
}

export interface OptimalPolicy {
  /** The optimal policy configuration */
  policy: RiskPolicy;
  /** Policy score (train set) */
  score: PolicyScore;
  /** Validation score (if validation split used) */
  validationScore?: PolicyScore;
  /** Overfitting metrics (if validation split used) */
  overfittingMetrics?: OverfittingMetrics;
  /** Policy ID for storage */
  policyId: string;
}

export interface OptimizationResult {
  /** Best policy found */
  bestPolicy: OptimalPolicy | null;
  /** All policies evaluated (sorted by score descending) */
  allPolicies: Array<{
    policy: RiskPolicy;
    score: PolicyScore;
    validationScore?: PolicyScore;
    overfittingMetrics?: OverfittingMetrics;
  }>;
  /** Number of policies evaluated */
  policiesEvaluated: number;
  /** Number of policies that satisfied constraints */
  feasiblePolicies: number;
  /** Validation split metadata (if validation split used) */
  validationSplit?: ValidationSplitResult['metadata'];
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
  // Default policy types - include combo for non-high-multiple callers
  const policyTypes = req.policyTypes || [
    'fixed_stop',
    'time_stop',
    'trailing_stop',
    'ladder',
    'combo',
  ];

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

  // Split calls into train/validation sets if validation split configured
  let trainCalls = callsToOptimize;
  let validationCalls: CallRecord[] = [];
  let validationSplitMetadata: ValidationSplitResult['metadata'] | undefined;

  if (req.validationSplit) {
    const splitResult = splitCalls(callsToOptimize, req.validationSplit);
    trainCalls = splitResult.trainCalls;
    validationCalls = splitResult.validationCalls;
    validationSplitMetadata = splitResult.metadata;

    logger.info('Validation split applied', {
      strategy: req.validationSplit.strategy,
      trainCount: trainCalls.length,
      validationCount: validationCalls.length,
      trainFraction: req.validationSplit.trainFraction,
    });
  }

  // Analyze caller profile to determine if they're high-multiple
  // This affects which policies we generate
  // Use train calls only for profile analysis (to avoid data leakage)
  let isHighMultipleCaller = false;
  if (req.pathMetricsByCallId && trainCalls.length > 0) {
    const pathMetrics: Array<{ peak_multiple?: number | null }> = [];
    for (const call of trainCalls) {
      const pm = req.pathMetricsByCallId.get(call.id);
      if (pm) pathMetrics.push(pm);
    }
    const profile = analyzeCallerHighMultipleProfile([], pathMetrics);
    isHighMultipleCaller = profile.isHighMultipleCaller;

    logger.info('Caller profile analysis', {
      isHighMultipleCaller,
      p95PeakMultiple: profile.p95PeakMultiple,
      p75PeakMultiple: profile.p75PeakMultiple,
      trainCallsUsed: trainCalls.length,
    });
  }

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

  // Generate combo policies optimized for non-high-multiple callers
  // These vigilantly protect 2x/3x while allowing trailing stops to ride pumps
  // For high-multiple callers, we rely on constraint relaxation instead
  if (
    !isHighMultipleCaller &&
    (policyTypes.includes('combo') ||
      policyTypes.includes('trailing_stop') ||
      policyTypes.includes('ladder'))
  ) {
    policies.push(...generateComboPoliciesForNonHighMultipleCallers());
    logger.info('Generated combo policies for non-high-multiple caller', {
      comboPoliciesCount: policies.filter((p) => p.kind === 'combo').length,
    });
  }

  logger.info('Starting policy optimization', {
    trainCalls: trainCalls.length,
    validationCalls: validationCalls.length,
    policies: policies.length,
    policyTypes,
    callerGroups: req.callerGroups,
    validationSplit: req.validationSplit ? req.validationSplit.strategy : 'none',
  });

  // Evaluate each policy
  const evaluatedPolicies: Array<{
    policy: RiskPolicy;
    score: PolicyScore;
    validationScore?: PolicyScore;
    overfittingMetrics?: OverfittingMetrics;
  }> = [];

  for (const policy of policies) {
    // Execute policy on train calls
    const trainResults: PolicyResultRow[] = [];
    const trainPathMetrics: Array<{ peak_multiple?: number | null }> = [];

    for (const call of trainCalls) {
      const candles = req.candlesByCallId.get(call.id);
      if (!candles || candles.length === 0) continue;

      const alertTsMs = call.createdAt.toMillis();
      const result = executePolicy(candles, alertTsMs, policy, fees);

      if (result.exitReason !== 'no_entry') {
        trainResults.push({
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

      // Collect path metrics for caller profile analysis
      if (req.pathMetricsByCallId) {
        const pathMetric = req.pathMetricsByCallId.get(call.id);
        if (pathMetric) {
          trainPathMetrics.push(pathMetric);
        }
      }
    }

    // Score the policy on train set
    const trainScore = scorePolicy(trainResults, constraints, undefined, trainPathMetrics);

    // Evaluate on validation set if validation split used
    let validationScore: PolicyScore | undefined;
    let overfittingMetrics: OverfittingMetrics | undefined;

    if (validationCalls.length > 0) {
      const validationResults: PolicyResultRow[] = [];
      const validationPathMetrics: Array<{ peak_multiple?: number | null }> = [];

      for (const call of validationCalls) {
        const candles = req.candlesByCallId.get(call.id);
        if (!candles || candles.length === 0) continue;

        const alertTsMs = call.createdAt.toMillis();
        const result = executePolicy(candles, alertTsMs, policy, fees);

        if (result.exitReason !== 'no_entry') {
          validationResults.push({
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

        // Collect path metrics for validation set
        if (req.pathMetricsByCallId) {
          const pathMetric = req.pathMetricsByCallId.get(call.id);
          if (pathMetric) {
            validationPathMetrics.push(pathMetric);
          }
        }
      }

      // Score the policy on validation set
      validationScore = scorePolicy(
        validationResults,
        constraints,
        undefined,
        validationPathMetrics
      );

      // Detect overfitting
      overfittingMetrics = detectOverfitting(trainScore, validationScore, req.overfittingConfig);

      // Log overfitting if detected
      if (overfittingMetrics.overfittingDetected) {
        logger.warn('Overfitting detected', {
          policyId: policyToId(policy),
          severity: overfittingMetrics.severity,
          scoreGap: overfittingMetrics.scoreGap,
          relativeGapPercent: overfittingMetrics.relativeGapPercent,
        });
        logger.debug(formatOverfittingMetrics(overfittingMetrics));
      }
    }

    evaluatedPolicies.push({
      policy,
      score: trainScore,
      validationScore,
      overfittingMetrics,
    });
  }

  // Sort by score descending (use validation score if available, otherwise train score)
  evaluatedPolicies.sort((a, b) => {
    const scoreA = a.validationScore?.score ?? a.score.score;
    const scoreB = b.validationScore?.score ?? b.score.score;
    return scoreB - scoreA;
  });

  const feasiblePolicies = evaluatedPolicies.filter((p) => p.score.constraintsSatisfied).length;

  // Get best policy (prefer policies without overfitting if validation split used)
  let bestPolicyEntry = evaluatedPolicies.find((p) => p.score.constraintsSatisfied);

  // If validation split used, prefer policies without overfitting
  if (validationCalls.length > 0 && bestPolicyEntry) {
    const nonOverfittingPolicies = evaluatedPolicies.filter(
      (p) =>
        p.score.constraintsSatisfied &&
        (!p.overfittingMetrics || !p.overfittingMetrics.overfittingDetected)
    );

    if (nonOverfittingPolicies.length > 0) {
      // Prefer non-overfitting policies, sorted by validation score
      nonOverfittingPolicies.sort((a, b) => {
        const scoreA = a.validationScore?.score ?? a.score.score;
        const scoreB = b.validationScore?.score ?? b.score.score;
        return scoreB - scoreA;
      });
      bestPolicyEntry = nonOverfittingPolicies[0];
    }
  }

  const bestPolicy: OptimalPolicy | null = bestPolicyEntry
    ? {
        policy: bestPolicyEntry.policy,
        score: bestPolicyEntry.score,
        validationScore: bestPolicyEntry.validationScore,
        overfittingMetrics: bestPolicyEntry.overfittingMetrics,
        policyId: policyToId(bestPolicyEntry.policy),
      }
    : null;

  logger.info('Policy optimization complete', {
    policiesEvaluated: evaluatedPolicies.length,
    feasiblePolicies,
    bestPolicyId: bestPolicy?.policyId,
    bestTrainScore: bestPolicy?.score.score,
    bestValidationScore: bestPolicy?.validationScore?.score,
    overfittingDetected: bestPolicy?.overfittingMetrics?.overfittingDetected,
    overfittingSeverity: bestPolicy?.overfittingMetrics?.severity,
  });

  return {
    bestPolicy,
    allPolicies: evaluatedPolicies,
    policiesEvaluated: evaluatedPolicies.length,
    feasiblePolicies,
    validationSplit: validationSplitMetadata,
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

/**
 * Generate combo policies optimized for non-high-multiple callers.
 *
 * Strategy: Vigilantly protect 2x/3x from drawdowns while allowing trailing stops
 * to ride pumps. Combines:
 * - Trailing stops (10-20%) to ride pumps after activation
 * - Ladder exits at 2x/3x to protect gains
 * - Hard stop losses for downside protection
 * - Optional time-based exits
 */
function generateComboPoliciesForNonHighMultipleCallers(): RiskPolicy[] {
  const policies: RiskPolicy[] = [];

  // Trailing stop configurations (10-20% trail to ride pumps)
  const trailPcts = [0.1, 0.15, 0.2];
  const activationPcts = [0.5, 1.0, 1.5, 2.0]; // Activate at 0.5x, 1x, 1.5x, or 2x gain

  // Hard stop losses for downside protection
  const hardStopPcts = [0.15, 0.2, 0.25];

  // Ladder configurations to protect 2x/3x gains
  const ladderConfigs = [
    // Protect 2x with 50% exit, let rest ride
    [{ multiple: 2.0, fraction: 0.5 }],
    // Protect 2x with 50%, 3x with 30%
    [
      { multiple: 2.0, fraction: 0.5 },
      { multiple: 3.0, fraction: 0.3 },
    ],
    // Protect 2x with 30%, 3x with 50%
    [
      { multiple: 2.0, fraction: 0.3 },
      { multiple: 3.0, fraction: 0.5 },
    ],
  ];

  // Time-based exits (optional, for risk management)
  const timeStops = [
    2 * 60 * 60 * 1000, // 2 hours
    4 * 60 * 60 * 1000, // 4 hours
    48 * 60 * 60 * 1000, // 48 hours (full horizon)
  ];

  // Generate combos: Trailing stop + Ladder + Hard stop
  for (const trailPct of trailPcts) {
    for (const activationPct of activationPcts) {
      for (const hardStopPct of hardStopPcts) {
        for (const ladderLevels of ladderConfigs) {
          // Combo 1: Trailing stop + Ladder + Hard stop
          policies.push({
            kind: 'combo',
            policies: [
              {
                kind: 'trailing_stop',
                activationPct,
                trailPct,
                hardStopPct,
              },
              {
                kind: 'ladder',
                levels: ladderLevels,
                stopPct: hardStopPct, // Same hard stop for remaining position
              },
            ],
          });

          // Combo 2: Trailing stop + Ladder + Hard stop + Time stop
          for (const maxHoldMs of timeStops) {
            policies.push({
              kind: 'combo',
              policies: [
                {
                  kind: 'trailing_stop',
                  activationPct,
                  trailPct,
                  hardStopPct,
                },
                {
                  kind: 'ladder',
                  levels: ladderLevels,
                  stopPct: hardStopPct,
                },
                {
                  kind: 'time_stop',
                  maxHoldMs,
                },
              ],
            });
          }
        }
      }
    }
  }

  // Also generate simpler combos: Just trailing stop + hard stop (no ladder)
  // These are for when we want to ride the wave but still protect downside
  for (const trailPct of trailPcts) {
    for (const activationPct of [0.5, 1.0, 1.5]) {
      for (const hardStopPct of hardStopPcts) {
        policies.push({
          kind: 'combo',
          policies: [
            {
              kind: 'trailing_stop',
              activationPct,
              trailPct,
              hardStopPct,
            },
            {
              kind: 'fixed_stop',
              stopPct: hardStopPct,
            },
          ],
        });
      }
    }
  }

  // Combo: Ladder at 2x/3x + Trailing stop (protect gains, then ride)
  for (const ladderLevels of ladderConfigs) {
    for (const trailPct of trailPcts) {
      for (const hardStopPct of hardStopPcts) {
        policies.push({
          kind: 'combo',
          policies: [
            {
              kind: 'ladder',
              levels: ladderLevels,
              stopPct: hardStopPct,
            },
            {
              kind: 'trailing_stop',
              activationPct: 1.5, // Activate trailing after 1.5x
              trailPct,
              hardStopPct,
            },
          ],
        });
      }
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

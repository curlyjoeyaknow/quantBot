/**
 * Caller Follow Plan Generator (Phase 5 - MVP 3)
 *
 * Generates "Caller Follow Plan v1" with recommended stop/exit settings per caller.
 * Based on optimization results and truth layer metrics.
 */

import type { RiskPolicy } from '../policies/risk-policy.js';
import type { PolicyScore } from './scoring.js';
import type { CallerTruthLeaderboardRow } from '../types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Caller follow plan with recommended policy
 */
export interface CallerFollowPlan {
  /** Caller name */
  callerName: string;
  /** Recommended policy */
  recommendedPolicy: RiskPolicy;
  /** Policy ID */
  policyId: string;
  /** Expected performance metrics */
  expectedMetrics: {
    /** Expected median return (bps) */
    expectedMedianReturnBps: number;
    /** Expected stop-out rate */
    expectedStopOutRate: number;
    /** Expected average time exposed (ms) */
    expectedAvgTimeExposedMs: number;
    /** Expected tail capture (0-1) */
    expectedTailCapture: number;
  };
  /** Truth layer metrics for context */
  truthMetrics: {
    /** Total calls analyzed */
    calls: number;
    /** 2x hit rate */
    hitRate2x: number;
    /** 3x hit rate */
    hitRate3x: number;
    /** Median peak multiple */
    medianPeakMultiple: number | null;
    /** Median drawdown (bps) */
    medianDrawdownBps: number | null;
  };
  /** Tradeoffs and notes */
  tradeoffs: string[];
  /** Confidence level */
  confidence: 'high' | 'medium' | 'low';
}

/**
 * Full follow plan report
 */
export interface CallerFollowPlanReport {
  /** Generated timestamp */
  generatedAt: Date;
  /** Constraints used for optimization */
  constraints: {
    maxStopOutRate: number;
    maxP95DrawdownBps: number;
    maxTimeExposedMs: number;
  };
  /** Per-caller plans */
  plans: CallerFollowPlan[];
  /** Summary statistics */
  summary: {
    totalCallers: number;
    callersWithPlan: number;
    callersWithoutPlan: number;
    avgExpectedReturn: number;
    avgStopOutRate: number;
  };
}

// =============================================================================
// Plan Generator
// =============================================================================

/**
 * Generate caller follow plan from optimization results
 */
export function generateCallerFollowPlan(
  callerName: string,
  optimalPolicy: {
    policy: RiskPolicy;
    score: PolicyScore;
    policyId: string;
  } | null,
  truthMetrics: CallerTruthLeaderboardRow
): CallerFollowPlan | null {
  if (!optimalPolicy || !optimalPolicy.score.constraintsSatisfied) {
    return null;
  }

  const { policy, score, policyId } = optimalPolicy;

  // Determine tradeoffs based on policy type
  const tradeoffs: string[] = [];

  switch (policy.kind) {
    case 'fixed_stop':
      if (policy.stopPct <= 0.1) {
        tradeoffs.push('Tight stop may trigger on normal volatility');
      }
      if (policy.takeProfitPct && policy.takeProfitPct > 1.5) {
        tradeoffs.push('High take-profit target may reduce exit frequency');
      }
      break;

    case 'time_stop':
      if (policy.maxHoldMs < 15 * 60 * 1000) {
        tradeoffs.push('Short hold time may exit before potential peaks');
      }
      if (policy.maxHoldMs > 2 * 60 * 60 * 1000) {
        tradeoffs.push('Long hold time increases exposure risk');
      }
      break;

    case 'trailing_stop':
      if (policy.trailPct < 0.05) {
        tradeoffs.push('Tight trail may trigger on small pullbacks');
      }
      if (!policy.hardStopPct) {
        tradeoffs.push('No hard stop - full drawdown possible before activation');
      }
      break;

    case 'ladder':
      if (policy.levels.length > 3) {
        tradeoffs.push('Many ladder levels may fragment exits');
      }
      if (!policy.stopPct) {
        tradeoffs.push('No stop loss on ladder - remaining position at risk');
      }
      break;
  }

  // Determine confidence based on sample size and score
  let confidence: CallerFollowPlan['confidence'];
  if (truthMetrics.calls >= 50 && score.metrics.count >= 30) {
    confidence = 'high';
  } else if (truthMetrics.calls >= 20 && score.metrics.count >= 10) {
    confidence = 'medium';
  } else {
    confidence = 'low';
    tradeoffs.push('Low sample size - results may not generalize');
  }

  return {
    callerName,
    recommendedPolicy: policy,
    policyId,
    expectedMetrics: {
      expectedMedianReturnBps: score.metrics.medianReturnBps,
      expectedStopOutRate: score.metrics.stopOutRate,
      expectedAvgTimeExposedMs: score.metrics.avgTimeExposedMs,
      expectedTailCapture: score.metrics.avgTailCapture,
    },
    truthMetrics: {
      calls: truthMetrics.calls,
      hitRate2x: truthMetrics.p_hit_2x,
      hitRate3x: truthMetrics.p_hit_3x,
      medianPeakMultiple: truthMetrics.median_peak_multiple,
      medianDrawdownBps: truthMetrics.median_dd_bps,
    },
    tradeoffs,
    confidence,
  };
}

/**
 * Generate full follow plan report for multiple callers
 */
export function generateCallerFollowPlanReport(
  callerPlans: Array<{
    callerName: string;
    optimalPolicy: {
      policy: RiskPolicy;
      score: PolicyScore;
      policyId: string;
    } | null;
    truthMetrics: CallerTruthLeaderboardRow;
  }>,
  constraints: {
    maxStopOutRate: number;
    maxP95DrawdownBps: number;
    maxTimeExposedMs: number;
  }
): CallerFollowPlanReport {
  const plans: CallerFollowPlan[] = [];
  let totalExpectedReturn = 0;
  let totalStopOutRate = 0;
  let callersWithPlan = 0;

  for (const { callerName, optimalPolicy, truthMetrics } of callerPlans) {
    const plan = generateCallerFollowPlan(callerName, optimalPolicy, truthMetrics);
    if (plan) {
      plans.push(plan);
      totalExpectedReturn += plan.expectedMetrics.expectedMedianReturnBps;
      totalStopOutRate += plan.expectedMetrics.expectedStopOutRate;
      callersWithPlan++;
    }
  }

  // Sort by expected return descending
  plans.sort(
    (a, b) => b.expectedMetrics.expectedMedianReturnBps - a.expectedMetrics.expectedMedianReturnBps
  );

  return {
    generatedAt: new Date(),
    constraints,
    plans,
    summary: {
      totalCallers: callerPlans.length,
      callersWithPlan,
      callersWithoutPlan: callerPlans.length - callersWithPlan,
      avgExpectedReturn: callersWithPlan > 0 ? totalExpectedReturn / callersWithPlan : 0,
      avgStopOutRate: callersWithPlan > 0 ? totalStopOutRate / callersWithPlan : 0,
    },
  };
}

/**
 * Format follow plan for display
 */
export function formatFollowPlanForDisplay(
  plan: CallerFollowPlan
): Record<string, string | number> {
  return {
    caller: plan.callerName,
    policy: plan.policyId,
    expectedReturn: `${plan.expectedMetrics.expectedMedianReturnBps.toFixed(0)} bps`,
    stopOutRate: `${(plan.expectedMetrics.expectedStopOutRate * 100).toFixed(1)}%`,
    tailCapture: `${(plan.expectedMetrics.expectedTailCapture * 100).toFixed(0)}%`,
    avgTimeMin: `${(plan.expectedMetrics.expectedAvgTimeExposedMs / 60000).toFixed(1)}`,
    calls: plan.truthMetrics.calls,
    hit2x: `${(plan.truthMetrics.hitRate2x * 100).toFixed(0)}%`,
    confidence: plan.confidence,
    tradeoffs: plan.tradeoffs.length,
  };
}

/**
 * Format full report for display
 */
export function formatReportForDisplay(report: CallerFollowPlanReport): {
  summary: Record<string, string | number>;
  plans: Array<Record<string, string | number>>;
} {
  return {
    summary: {
      generatedAt: report.generatedAt.toISOString(),
      totalCallers: report.summary.totalCallers,
      withPlan: report.summary.callersWithPlan,
      withoutPlan: report.summary.callersWithoutPlan,
      avgExpectedReturn: `${report.summary.avgExpectedReturn.toFixed(0)} bps`,
      avgStopOutRate: `${(report.summary.avgStopOutRate * 100).toFixed(1)}%`,
    },
    plans: report.plans.map(formatFollowPlanForDisplay),
  };
}

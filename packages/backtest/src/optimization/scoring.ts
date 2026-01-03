/**
 * Policy Scoring Function (Phase 5 - MVP 3)
 *
 * Guardrail 4: Hard Scoring Contract
 *
 * Primary Objective: Maximize median (or expected) net return
 * Subject To Constraints:
 * - Stop-out rate ≤ X%
 * - p95 drawdown ≤ Y bps
 * - Time-exposed ≤ Z ms
 *
 * Tie-Breakers (in order):
 * 1. Better tail capture (realized vs peak multiple)
 * 2. Faster time-to-2x
 * 3. Lower median drawdown
 */

import type { PolicyResultRow } from '../types.js';

// =============================================================================
// Constraint Types
// =============================================================================

/**
 * Optimization constraints
 */
export interface OptimizationConstraints {
  /** Maximum stop-out rate (e.g., 0.3 = 30%) */
  maxStopOutRate: number;
  /** Maximum p95 drawdown in bps (e.g., -2000 = -20%) */
  maxP95DrawdownBps: number;
  /** Maximum time exposed in ms (e.g., 3600000 = 1 hour) */
  maxTimeExposedMs: number;
}

/**
 * Default constraints
 */
export const DEFAULT_CONSTRAINTS: OptimizationConstraints = {
  maxStopOutRate: 0.3, // 30% max stop-out rate
  maxP95DrawdownBps: -3000, // -30% max p95 drawdown
  maxTimeExposedMs: 4 * 60 * 60 * 1000, // 4 hours max exposure
};

// =============================================================================
// Scoring Result
// =============================================================================

export interface PolicyScore {
  /** Overall score (higher = better, -Infinity if constraints violated) */
  score: number;
  /** Primary metric: median return bps */
  medianReturnBps: number;
  /** Whether all constraints are satisfied */
  constraintsSatisfied: boolean;
  /** Individual constraint violations */
  violations: {
    stopOutRate?: boolean;
    p95Drawdown?: boolean;
    timeExposed?: boolean;
  };
  /** Tie-breaker metrics */
  tieBreakers: {
    avgTailCapture: number;
    avgTimeToFirstMultipleBps: number;
    medianDrawdownBps: number;
  };
  /** Raw metrics for debugging */
  metrics: {
    count: number;
    avgReturnBps: number;
    medianReturnBps: number;
    stopOutRate: number;
    p95DrawdownBps: number;
    avgTimeExposedMs: number;
    avgTailCapture: number;
    avgMaxAdverseExcursionBps: number;
  };
}

// =============================================================================
// Scoring Function
// =============================================================================

/**
 * Score a set of policy results against constraints
 *
 * Returns score (higher = better) or -Infinity if constraints violated
 */
export function scorePolicy(
  results: PolicyResultRow[],
  constraints: OptimizationConstraints = DEFAULT_CONSTRAINTS
): PolicyScore {
  if (results.length === 0) {
    return createEmptyScore();
  }

  // Calculate metrics
  const returns = results.map((r) => r.realized_return_bps).sort((a, b) => a - b);
  const drawdowns = results.map((r) => r.max_adverse_excursion_bps).sort((a, b) => a - b);
  const timeExposed = results.map((r) => r.time_exposed_ms);
  const tailCaptures = results.filter((r) => r.tail_capture !== null).map((r) => r.tail_capture!);

  const count = results.length;
  const stopOutCount = results.filter((r) => r.stop_out).length;

  // Primary metrics
  const avgReturnBps = returns.reduce((a, b) => a + b, 0) / count;
  const medianReturnBps = returns[Math.floor(count / 2)];
  const stopOutRate = stopOutCount / count;

  // Drawdown metrics (p95 = 95th percentile, most negative)
  const p95Idx = Math.floor(count * 0.95);
  const p95DrawdownBps = drawdowns[p95Idx] ?? drawdowns[drawdowns.length - 1];
  const medianDrawdownBps = drawdowns[Math.floor(count / 2)];

  // Time metrics
  const avgTimeExposedMs = timeExposed.reduce((a, b) => a + b, 0) / count;

  // Tail capture (average)
  const avgTailCapture =
    tailCaptures.length > 0 ? tailCaptures.reduce((a, b) => a + b, 0) / tailCaptures.length : 0;

  // Average max adverse excursion
  const avgMaxAdverseExcursionBps = drawdowns.reduce((a, b) => a + b, 0) / count;

  // Check constraints
  const violations: PolicyScore['violations'] = {};
  let constraintsSatisfied = true;

  if (stopOutRate > constraints.maxStopOutRate) {
    violations.stopOutRate = true;
    constraintsSatisfied = false;
  }

  if (p95DrawdownBps < constraints.maxP95DrawdownBps) {
    // More negative = worse, so p95 < max means violation
    violations.p95Drawdown = true;
    constraintsSatisfied = false;
  }

  if (avgTimeExposedMs > constraints.maxTimeExposedMs) {
    violations.timeExposed = true;
    constraintsSatisfied = false;
  }

  // Calculate tie-breakers
  // Time to first multiple approximation (using return as proxy)
  const avgTimeToFirstMultipleBps = medianReturnBps > 0 ? medianReturnBps : 0;

  const tieBreakers = {
    avgTailCapture,
    avgTimeToFirstMultipleBps,
    medianDrawdownBps,
  };

  // Calculate score
  let score: number;
  if (!constraintsSatisfied) {
    score = -Infinity;
  } else {
    // Primary: median return (in bps)
    // Add tie-breakers as fractional components
    // Tail capture: 0-1, multiply by 100 to make it 0-100
    // Median drawdown: negative, closer to 0 is better, divide by 100
    score = medianReturnBps + avgTailCapture * 100 - medianDrawdownBps / 100;
  }

  return {
    score,
    medianReturnBps,
    constraintsSatisfied,
    violations,
    tieBreakers,
    metrics: {
      count,
      avgReturnBps,
      medianReturnBps,
      stopOutRate,
      p95DrawdownBps,
      avgTimeExposedMs,
      avgTailCapture,
      avgMaxAdverseExcursionBps,
    },
  };
}

/**
 * Compare two policy scores
 * Returns negative if a < b, positive if a > b, 0 if equal
 */
export function comparePolicyScores(a: PolicyScore, b: PolicyScore): number {
  // First compare by constraints satisfaction
  if (a.constraintsSatisfied && !b.constraintsSatisfied) return 1;
  if (!a.constraintsSatisfied && b.constraintsSatisfied) return -1;

  // If both violate constraints, compare by number of violations
  if (!a.constraintsSatisfied && !b.constraintsSatisfied) {
    const aViolations = Object.values(a.violations).filter(Boolean).length;
    const bViolations = Object.values(b.violations).filter(Boolean).length;
    if (aViolations !== bViolations) return bViolations - aViolations; // Fewer violations is better
  }

  // Compare by primary score
  if (a.score !== b.score) return a.score - b.score;

  // Tie-breakers
  // 1. Better tail capture
  if (a.tieBreakers.avgTailCapture !== b.tieBreakers.avgTailCapture) {
    return a.tieBreakers.avgTailCapture - b.tieBreakers.avgTailCapture;
  }

  // 2. Better return (proxy for faster time-to-2x)
  if (a.tieBreakers.avgTimeToFirstMultipleBps !== b.tieBreakers.avgTimeToFirstMultipleBps) {
    return a.tieBreakers.avgTimeToFirstMultipleBps - b.tieBreakers.avgTimeToFirstMultipleBps;
  }

  // 3. Lower median drawdown (closer to 0)
  return b.tieBreakers.medianDrawdownBps - a.tieBreakers.medianDrawdownBps;
}

function createEmptyScore(): PolicyScore {
  return {
    score: -Infinity,
    medianReturnBps: 0,
    constraintsSatisfied: false,
    violations: {},
    tieBreakers: {
      avgTailCapture: 0,
      avgTimeToFirstMultipleBps: 0,
      medianDrawdownBps: 0,
    },
    metrics: {
      count: 0,
      avgReturnBps: 0,
      medianReturnBps: 0,
      stopOutRate: 0,
      p95DrawdownBps: 0,
      avgTimeExposedMs: 0,
      avgTailCapture: 0,
      avgMaxAdverseExcursionBps: 0,
    },
  };
}

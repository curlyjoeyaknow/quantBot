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
 * Objective Function Shape (matches your intent):
 * - Base: log(median_ath)
 * - Speed boost: log(1 + (target_minutes / median_t2x_minutes)) - capped
 * - Consistency boost: strong weight on hit2x_pct > 50%
 * - Risk penalty: 0 up to 30% DD, exponential ramp to 60%, "untradeable" beyond
 *
 * Tie-Breakers (in order):
 * 1. Better tail capture (realized vs peak multiple)
 * 2. Faster time-to-2x
 * 3. Lower median drawdown
 */

import type { PolicyResultRow } from '../types.js';

// =============================================================================
// Objective Function Configuration
// =============================================================================

/**
 * Configuration for the objective function.
 *
 * Matches the Python ObjectiveConfig for consistency.
 */
export interface ObjectiveConfig {
  /** Primary metric: 'median_ath' | 'avg_r' | 'median_return' */
  primaryMetric: 'median_ath' | 'avg_r' | 'median_return';

  // === Drawdown penalty (the cliff) ===
  /** Start penalizing at this DD (e.g., 0.30 = 30%) */
  ddPenaltyThreshold: number;
  /** Steepness of exponential penalty */
  ddPenaltyK: number;
  /** "Abandon hope" level - brutal penalty multiplier kicks in */
  ddBrutalThreshold: number;
  /** Extra multiplier beyond brutal threshold */
  ddBrutalMultiplier: number;

  // === Timing boost ===
  /** Target time-to-2x in minutes for speed comparison */
  targetTimeMinutes: number;
  /** Maximum timing boost (cap) */
  timingBoostMax: number;

  // === Consistency boost ===
  /** Minimum hit2x rate to get consistency bonus */
  minHit2xPct: number;
  /** Weight for consistency (hit2x) bonus */
  consistencyWeight: number;

  // === Tail bonus ===
  /** Weight for fat tail bonus (p95/p75 spread) */
  tailBonusWeight: number;
}

/**
 * Default objective config matching your instincts:
 * - Hard penalty on DD_pre2x > 30%
 * - Brutal penalty beyond 60%
 * - Strong boost for fast time_to_2x
 * - Bonus for fat right tail
 */
export const DEFAULT_OBJECTIVE_CONFIG: ObjectiveConfig = {
  primaryMetric: 'median_ath',
  ddPenaltyThreshold: 0.3,
  ddPenaltyK: 5.0,
  ddBrutalThreshold: 0.6,
  ddBrutalMultiplier: 10.0,
  targetTimeMinutes: 60,
  timingBoostMax: 0.5,
  minHit2xPct: 0.5,
  consistencyWeight: 0.3,
  tailBonusWeight: 0.1,
};

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

/**
 * Objective function component breakdown.
 * Useful for understanding what's driving the score.
 */
export interface ObjectiveComponents {
  /** Base value (log(median_ath) or primary metric) */
  baseValue: number;
  /** Drawdown penalty (exponential cliff) */
  ddPenalty: number;
  /** Speed/timing boost */
  timingBoost: number;
  /** Consistency boost (hit2x rate) */
  consistencyBoost: number;
  /** Tail bonus (p95/p75 spread) */
  tailBonus: number;
  /** Final objective score */
  finalScore: number;
}

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
  /** Objective function breakdown (optional) */
  objectiveBreakdown?: ObjectiveComponents;
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
    /** Hit 2x rate (0-1) */
    hit2xRate?: number;
    /** Median peak multiple (ATH) */
    medianPeakMultiple?: number;
    /** P75 peak multiple */
    p75PeakMultiple?: number;
    /** P95 peak multiple */
    p95PeakMultiple?: number;
    /** Median time to 2x in minutes */
    medianTimeToT2xMin?: number;
    /** Median drawdown pre-2x as decimal */
    medianDdPre2x?: number;
  };
}

// =============================================================================
// Objective Function Helpers
// =============================================================================

/**
 * Compute drawdown penalty with exponential cliff.
 *
 * - penalty = 0 if dd <= threshold
 * - penalty = exp(k * (dd - threshold)) - 1 if dd > threshold
 * - penalty *= brutal_multiplier if dd > brutal_threshold
 *
 * This creates a cliff the optimizer learns to avoid.
 */
export function computeDdPenalty(
  ddPre2x: number,
  config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG
): number {
  if (ddPre2x <= config.ddPenaltyThreshold) {
    return 0;
  }

  const excess = ddPre2x - config.ddPenaltyThreshold;

  // Base exponential penalty
  let penalty = Math.exp(config.ddPenaltyK * excess) - 1;

  // Brutal zone multiplier ("untradeable" territory)
  if (ddPre2x > config.ddBrutalThreshold) {
    const brutalExcess = ddPre2x - config.ddBrutalThreshold;
    penalty *= 1 + config.ddBrutalMultiplier * brutalExcess;
  }

  return penalty;
}

/**
 * Compute timing/speed boost.
 *
 * boost = log(1 + (target_minutes / actual_minutes))
 *
 * Rewards fast time-to-2x with diminishing returns.
 */
export function computeTimingBoost(
  timeToT2xMinutes: number | null,
  config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG
): number {
  if (timeToT2xMinutes === null || timeToT2xMinutes <= 0 || !isFinite(timeToT2xMinutes)) {
    return 0;
  }

  const boost = Math.log(1 + config.targetTimeMinutes / timeToT2xMinutes);
  return Math.min(boost, config.timingBoostMax);
}

/**
 * Compute consistency boost based on hit2x rate.
 *
 * Strong linear weight above threshold.
 */
export function computeConsistencyBoost(
  hit2xRate: number,
  config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG
): number {
  if (hit2xRate < config.minHit2xPct) {
    return 0;
  }

  // Linear boost above threshold
  return (hit2xRate - config.minHit2xPct) * config.consistencyWeight;
}

/**
 * Compute tail bonus for asymmetric upside.
 *
 * Bonus based on p95/p75 spread (fat right tail).
 */
export function computeTailBonus(
  p75Multiple: number | null,
  p95Multiple: number | null,
  config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG
): number {
  if (p75Multiple === null || p95Multiple === null || p75Multiple <= 0) {
    return 0;
  }

  // Ratio of p95 to p75 - higher = fatter tail
  const ratio = p95Multiple / p75Multiple;
  return (ratio - 1) * config.tailBonusWeight;
}

/**
 * Compute full objective function.
 *
 * Shape:
 * - base = log(median_ath)
 * - speed_boost = log(1 + (target_minutes / median_t2x_minutes))
 * - consistency_boost = linear above hit2x threshold
 * - risk_penalty = exponential cliff at 30%, brutal at 60%
 *
 * final = base + speed_boost + consistency_boost + tail_bonus - dd_penalty
 */
export function computeObjective(
  metrics: {
    medianPeakMultiple?: number;
    hit2xRate?: number;
    medianTimeToT2xMin?: number;
    medianDdPre2x?: number;
    p75PeakMultiple?: number;
    p95PeakMultiple?: number;
  },
  config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG
): ObjectiveComponents {
  // Base value
  const baseValue =
    metrics.medianPeakMultiple && metrics.medianPeakMultiple > 0
      ? Math.log(metrics.medianPeakMultiple)
      : 0;

  // DD penalty
  const ddPenalty = computeDdPenalty(metrics.medianDdPre2x ?? 0, config);

  // Timing boost
  const timingBoost = computeTimingBoost(metrics.medianTimeToT2xMin ?? null, config);

  // Consistency boost
  const consistencyBoost = computeConsistencyBoost(metrics.hit2xRate ?? 0, config);

  // Tail bonus
  const tailBonus = computeTailBonus(
    metrics.p75PeakMultiple ?? null,
    metrics.p95PeakMultiple ?? null,
    config
  );

  // Final score
  const finalScore = baseValue + timingBoost + consistencyBoost + tailBonus - ddPenalty;

  return {
    baseValue,
    ddPenalty,
    timingBoost,
    consistencyBoost,
    tailBonus,
    finalScore,
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
  constraints: OptimizationConstraints = DEFAULT_CONSTRAINTS,
  objectiveConfig: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG
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
    objectiveBreakdown: {
      baseValue: 0,
      ddPenalty: 0,
      timingBoost: 0,
      consistencyBoost: 0,
      tailBonus: 0,
      finalScore: -Infinity,
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
      hit2xRate: 0,
      medianPeakMultiple: 0,
      p75PeakMultiple: 0,
      p95PeakMultiple: 0,
      medianTimeToT2xMin: undefined,
      medianDdPre2x: 0,
    },
  };
}

/**
 * Format objective breakdown for display.
 */
export function formatObjectiveBreakdown(
  breakdown: ObjectiveComponents,
  config: ObjectiveConfig = DEFAULT_OBJECTIVE_CONFIG
): string {
  const lines = [
    `Base (log median ATH):  ${breakdown.baseValue.toFixed(4)}`,
    `DD penalty:            -${breakdown.ddPenalty.toFixed(4)} (threshold: ${(config.ddPenaltyThreshold * 100).toFixed(0)}%)`,
    `Timing boost:          +${breakdown.timingBoost.toFixed(4)}`,
    `Consistency boost:     +${breakdown.consistencyBoost.toFixed(4)}`,
    `Tail bonus:            +${breakdown.tailBonus.toFixed(4)}`,
    `─────────────────────────────`,
    `FINAL SCORE:            ${breakdown.finalScore.toFixed(4)}`,
  ];
  return lines.join('\n');
}

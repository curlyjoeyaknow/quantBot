/**
 * StabilityScorer
 *
 * Computes stability metrics for strategies across rolling windows.
 *
 * For each strategy config:
 * - Performance variance across windows
 * - Drawdown consistency
 * - Decay over time
 *
 * This becomes a leaderboard dimension, not just PnL.
 */

import type { SimulationMetrics } from './types.js';
import { logger } from '@quantbot/utils';

/**
 * Stability score
 */
export interface StabilityScore {
  /**
   * Overall stability score (0-1, higher is better)
   */
  score: number;

  /**
   * Performance variance (lower is better)
   */
  performanceVariance: number;

  /**
   * Drawdown consistency (lower variance in drawdowns is better)
   */
  drawdownConsistency: number;

  /**
   * Decay over time (negative means performance degrading, positive means improving)
   */
  decayOverTime: number;

  /**
   * Consistency score (0-1, higher is better)
   */
  consistencyScore: number;
}

/**
 * StabilityScorer
 */
export class StabilityScorer {
  /**
   * Compute stability score from window results
   */
  computeStability(metrics: SimulationMetrics[]): StabilityScore {
    if (metrics.length === 0) {
      return {
        score: 0,
        performanceVariance: 0,
        drawdownConsistency: 0,
        decayOverTime: 0,
        consistencyScore: 0,
      };
    }

    if (metrics.length === 1) {
      // Single window - can't compute variance
      return {
        score: 0.5, // Neutral score
        performanceVariance: 0,
        drawdownConsistency: 0,
        decayOverTime: 0,
        consistencyScore: 0.5,
      };
    }

    // Extract metrics
    const pnlPercents = metrics.map((m) => m.totalPnlPercent);
    const drawdowns = metrics.map((m) => m.maxDrawdownPercent);
    const sharpeRatios = metrics.map((m) => m.sharpeRatio ?? 0).filter((r) => r !== 0);

    // Compute performance variance
    const performanceVariance = this.computeVariance(pnlPercents);

    // Compute drawdown consistency (lower variance is better)
    const drawdownVariance = this.computeVariance(drawdowns);
    const drawdownConsistency = 1 / (1 + drawdownVariance); // Inverse variance, normalized

    // Compute decay over time (trend in performance)
    const decayOverTime = this.computeDecay(pnlPercents);

    // Compute consistency score (combination of variance metrics)
    const consistencyScore = this.computeConsistencyScore(
      performanceVariance,
      drawdownVariance,
      sharpeRatios
    );

    // Overall stability score (weighted combination)
    const score = this.computeOverallScore(
      performanceVariance,
      drawdownConsistency,
      decayOverTime,
      consistencyScore
    );

    return {
      score,
      performanceVariance,
      drawdownConsistency,
      decayOverTime,
      consistencyScore,
    };
  }

  /**
   * Compute variance of a metric array
   */
  private computeVariance(values: number[]): number {
    if (values.length === 0) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / values.length;
    return variance;
  }

  /**
   * Compute decay over time (linear regression slope)
   */
  private computeDecay(values: number[]): number {
    if (values.length < 2) return 0;

    // Simple linear regression
    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = values.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * values[i]!, 0);
    const sumX2 = x.reduce((sum, xi) => sum + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
    return slope; // Negative = decaying, positive = improving
  }

  /**
   * Compute consistency score
   */
  private computeConsistencyScore(
    performanceVariance: number,
    drawdownVariance: number,
    sharpeRatios: number[]
  ): number {
    // Normalize variances (use inverse, higher variance = lower score)
    const perfScore = 1 / (1 + Math.abs(performanceVariance));
    const drawdownScore = 1 / (1 + drawdownVariance);

    // Sharpe ratio consistency
    let sharpeScore = 0.5; // Default if no sharpe ratios
    if (sharpeRatios.length > 1) {
      const sharpeVariance = this.computeVariance(sharpeRatios);
      sharpeScore = 1 / (1 + sharpeVariance);
    }

    // Weighted average
    return perfScore * 0.4 + drawdownScore * 0.4 + sharpeScore * 0.2;
  }

  /**
   * Compute overall stability score
   */
  private computeOverallScore(
    performanceVariance: number,
    drawdownConsistency: number,
    decayOverTime: number,
    consistencyScore: number
  ): number {
    // Normalize decay (prefer small decay, penalize large negative decay)
    const decayScore = decayOverTime >= 0 ? 1 : Math.max(0, 1 + decayOverTime / 100);

    // Weighted combination
    return consistencyScore * 0.6 + drawdownConsistency * 0.3 + decayScore * 0.1;
  }
}

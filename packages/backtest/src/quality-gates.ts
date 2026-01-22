/**
 * Data Quality Gates - Enforce minimum thresholds
 *
 * Addresses: Risk #2 from ARCHITECTURE_REVIEW_2026-01-21.md
 *           "Data quality gates are advisory, not enforced"
 *
 * These gates FAIL HARD if data quality is insufficient.
 * No more garbage-in-garbage-out backtests.
 */

import { logger } from '@quantbot/infra/utils';

export interface QualityGateConfig {
  /** Minimum coverage threshold (0.0 to 1.0). Default: 0.95 (95%) */
  minCoverageThreshold?: number;

  /** Minimum quality score (0 to 100). Default: 80 */
  minQualityScore?: number;

  /** Fail hard if thresholds not met. Default: true */
  enforceGates?: boolean;
}

export interface QualityMetrics {
  coverage: number; // 0.0 to 1.0
  qualityScore: number; // 0 to 100
  candleCount: number;
  expectedCandles: number;
  gaps: number;
  duplicates: number;
  distortions: number;
}

export class QualityGateError extends Error {
  constructor(
    message: string,
    public readonly metrics: QualityMetrics,
    public readonly threshold: { coverage?: number; quality?: number }
  ) {
    super(message);
    this.name = 'QualityGateError';
  }
}

/**
 * Enforce coverage threshold
 *
 * @throws QualityGateError if coverage < threshold and enforceGates=true
 */
export function enforceCoverageGate(metrics: QualityMetrics, config: QualityGateConfig = {}): void {
  const minCoverage = config.minCoverageThreshold ?? 0.95;
  const enforce = config.enforceGates ?? true;

  if (metrics.coverage < minCoverage) {
    const message =
      `Coverage gate failed: ${(metrics.coverage * 100).toFixed(1)}% < ${(minCoverage * 100).toFixed(0)}% ` +
      `(${metrics.candleCount}/${metrics.expectedCandles} candles)`;

    logger.error(message, {
      coverage: metrics.coverage,
      threshold: minCoverage,
      candleCount: metrics.candleCount,
      expectedCandles: metrics.expectedCandles,
    });

    if (enforce) {
      throw new QualityGateError(message, metrics, { coverage: minCoverage });
    } else {
      logger.warn('Coverage gate failed but enforcement disabled');
    }
  } else {
    logger.info('Coverage gate passed', {
      coverage: metrics.coverage,
      threshold: minCoverage,
    });
  }
}

/**
 * Enforce quality score threshold
 *
 * @throws QualityGateError if qualityScore < threshold and enforceGates=true
 */
export function enforceQualityGate(metrics: QualityMetrics, config: QualityGateConfig = {}): void {
  const minQuality = config.minQualityScore ?? 80;
  const enforce = config.enforceGates ?? true;

  if (metrics.qualityScore < minQuality) {
    const message =
      `Quality gate failed: ${metrics.qualityScore.toFixed(1)} < ${minQuality} ` +
      `(gaps: ${metrics.gaps}, duplicates: ${metrics.duplicates}, distortions: ${metrics.distortions})`;

    logger.error(message, {
      qualityScore: metrics.qualityScore,
      threshold: minQuality,
      gaps: metrics.gaps,
      duplicates: metrics.duplicates,
      distortions: metrics.distortions,
    });

    if (enforce) {
      throw new QualityGateError(message, metrics, { quality: minQuality });
    } else {
      logger.warn('Quality gate failed but enforcement disabled');
    }
  } else {
    logger.info('Quality gate passed', {
      qualityScore: metrics.qualityScore,
      threshold: minQuality,
    });
  }
}

/**
 * Enforce all quality gates
 *
 * @throws QualityGateError if any gate fails and enforceGates=true
 */
export function enforceAllQualityGates(
  metrics: QualityMetrics,
  config: QualityGateConfig = {}
): void {
  enforceCoverageGate(metrics, config);
  enforceQualityGate(metrics, config);
}

/**
 * Calculate quality metrics from candle data
 *
 * This is a simplified version - full implementation should use
 * tools/backtest/lib/slice_quality.py for comprehensive checks
 */
export function calculateQualityMetrics(
  candles: number,
  expectedCandles: number,
  gaps: number = 0,
  duplicates: number = 0,
  distortions: number = 0
): QualityMetrics {
  const coverage = expectedCandles > 0 ? candles / expectedCandles : 0;

  // Quality score (0-100):
  // - Start at 100
  // - Deduct for gaps: -5 points per 1% gap rate
  // - Deduct for duplicates: -10 points per 1% duplicate rate
  // - Deduct for distortions: -20 points per distortion
  const gapRate = expectedCandles > 0 ? gaps / expectedCandles : 0;
  const dupRate = candles > 0 ? duplicates / candles : 0;

  let qualityScore = 100;
  qualityScore -= gapRate * 500; // -5 per 1% gaps
  qualityScore -= dupRate * 1000; // -10 per 1% duplicates
  qualityScore -= distortions * 20; // -20 per distortion

  qualityScore = Math.max(0, Math.min(100, qualityScore));

  return {
    coverage,
    qualityScore,
    candleCount: candles,
    expectedCandles,
    gaps,
    duplicates,
    distortions,
  };
}

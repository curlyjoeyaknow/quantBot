/**
 * Quality Gates for Backtest Data
 *
 * Enforces data quality requirements before backtest execution.
 * Based on Phase A requirements: coverage gates and quality score enforcement.
 */

export interface QualityMetrics {
  /** Coverage percentage (0-1) */
  coverage: number;
  /** Quality score (0-100) */
  qualityScore: number;
  /** Number of gaps in candle data */
  gaps: number;
  /** Number of duplicate candles */
  duplicates: number;
  /** Number of data distortions */
  distortions: number;
  /** Total candles */
  totalCandles: number;
  /** Expected candles */
  expectedCandles: number;
}

export interface QualityGateConfig {
  /** Minimum coverage threshold (default 0.95 = 95%) */
  minCoverageThreshold?: number;
  /** Minimum quality score (default 80) */
  minQualityScore?: number;
  /** Whether to enforce gates (default true) */
  enforceGates?: boolean;
}

export class QualityGateError extends Error {
  constructor(
    message: string,
    public readonly metrics: QualityMetrics,
    public readonly config: QualityGateConfig
  ) {
    super(message);
    this.name = 'QualityGateError';
  }
}

/**
 * Calculate quality metrics from candle data
 */
export function calculateQualityMetrics(
  totalCandles: number,
  expectedCandles: number,
  gaps: number = 0,
  duplicates: number = 0,
  distortions: number = 0
): QualityMetrics {
  const coverage = expectedCandles > 0 ? totalCandles / expectedCandles : 0;

  // Quality score calculation (0-100)
  // Base score: coverage * 100
  // Penalties: gaps, duplicates, distortions reduce score
  const baseScore = coverage * 100;
  const gapPenalty = Math.min(gaps * 0.5, 20); // Max 20 point penalty
  const duplicatePenalty = Math.min(duplicates * 0.3, 15); // Max 15 point penalty
  const distortionPenalty = Math.min(distortions * 1.0, 25); // Max 25 point penalty

  const qualityScore = Math.max(0, baseScore - gapPenalty - duplicatePenalty - distortionPenalty);

  return {
    coverage,
    qualityScore,
    gaps,
    duplicates,
    distortions,
    totalCandles,
    expectedCandles,
  };
}

/**
 * Enforce coverage gate
 */
export function enforceCoverageGate(metrics: QualityMetrics, config: QualityGateConfig = {}): void {
  const minCoverage = config.minCoverageThreshold ?? 0.95;
  const enforce = config.enforceGates ?? true;

  if (metrics.coverage < minCoverage) {
    const message = `Coverage gate failed: ${(metrics.coverage * 100).toFixed(1)}% < ${(minCoverage * 100).toFixed(1)}%`;
    if (enforce) {
      throw new QualityGateError(message, metrics, config);
    }
  }
}

/**
 * Enforce quality score gate
 */
export function enforceQualityGate(metrics: QualityMetrics, config: QualityGateConfig = {}): void {
  const minQuality = config.minQualityScore ?? 80;
  const enforce = config.enforceGates ?? true;

  if (metrics.qualityScore < minQuality) {
    const message = `Quality gate failed: score ${metrics.qualityScore.toFixed(1)} < ${minQuality}`;
    if (enforce) {
      throw new QualityGateError(message, metrics, config);
    }
  }
}

/**
 * Enforce all quality gates
 */
export function enforceAllQualityGates(
  metrics: QualityMetrics,
  config: QualityGateConfig = {}
): void {
  enforceCoverageGate(metrics, config);
  enforceQualityGate(metrics, config);
}

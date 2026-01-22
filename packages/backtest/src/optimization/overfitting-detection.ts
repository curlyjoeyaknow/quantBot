/**
 * Overfitting Detection
 *
 * Detects overfitting by comparing train vs validation performance.
 * Flags policies with large performance gaps between train and validation sets.
 */

import type { PolicyScore } from './scoring.js';

// =============================================================================
// Types
// =============================================================================

export interface OverfittingMetrics {
  /** Train score */
  trainScore: PolicyScore;
  /** Validation score */
  validationScore: PolicyScore;
  /** Performance gap (train - validation) */
  scoreGap: number;
  /** Relative performance gap (%) */
  relativeGapPercent: number;
  /** Whether overfitting is detected */
  overfittingDetected: boolean;
  /** Severity level */
  severity: 'none' | 'low' | 'medium' | 'high';
  /** Gap thresholds */
  thresholds: {
    /** Score gap threshold for low severity */
    lowThreshold: number;
    /** Score gap threshold for medium severity */
    mediumThreshold: number;
    /** Score gap threshold for high severity */
    highThreshold: number;
    /** Relative gap threshold (%) */
    relativeThresholdPercent: number;
  };
  /** Detailed gap metrics */
  gaps: {
    medianReturnBps: number;
    stopOutRate: number;
    p95DrawdownBps: number;
    avgTailCapture: number;
  };
}

export interface OverfittingDetectionConfig {
  /** Score gap threshold for low severity (default: 0.1) */
  lowThreshold?: number;
  /** Score gap threshold for medium severity (default: 0.3) */
  mediumThreshold?: number;
  /** Score gap threshold for high severity (default: 0.5) */
  highThreshold?: number;
  /** Relative gap threshold (%) (default: 20%) */
  relativeThresholdPercent?: number;
  /** Minimum validation sample size to detect overfitting (default: 10) */
  minValidationSamples?: number;
}

const DEFAULT_CONFIG: Required<OverfittingDetectionConfig> = {
  lowThreshold: 0.1,
  mediumThreshold: 0.3,
  highThreshold: 0.5,
  relativeThresholdPercent: 20,
  minValidationSamples: 10,
};

// =============================================================================
// Overfitting Detection
// =============================================================================

/**
 * Detect overfitting by comparing train vs validation performance
 */
export function detectOverfitting(
  trainScore: PolicyScore,
  validationScore: PolicyScore,
  config: OverfittingDetectionConfig = {}
): OverfittingMetrics {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Check minimum validation sample size
  if (validationScore.metrics.count < cfg.minValidationSamples) {
    return {
      trainScore,
      validationScore,
      scoreGap: trainScore.score - validationScore.score,
      relativeGapPercent: 0,
      overfittingDetected: false,
      severity: 'none',
      thresholds: {
        lowThreshold: cfg.lowThreshold,
        mediumThreshold: cfg.mediumThreshold,
        highThreshold: cfg.highThreshold,
        relativeThresholdPercent: cfg.relativeThresholdPercent,
      },
      gaps: {
        medianReturnBps:
          trainScore.metrics.medianReturnBps - validationScore.metrics.medianReturnBps,
        stopOutRate: trainScore.metrics.stopOutRate - validationScore.metrics.stopOutRate,
        p95DrawdownBps: trainScore.metrics.p95DrawdownBps - validationScore.metrics.p95DrawdownBps,
        avgTailCapture: trainScore.metrics.avgTailCapture - validationScore.metrics.avgTailCapture,
      },
    };
  }

  // Compute score gap
  const scoreGap = trainScore.score - validationScore.score;

  // Compute relative gap (%)
  const relativeGapPercent =
    trainScore.score !== 0
      ? Math.abs((scoreGap / trainScore.score) * 100)
      : scoreGap !== 0
        ? Infinity
        : 0;

  // Determine severity
  let severity: OverfittingMetrics['severity'] = 'none';
  let overfittingDetected = false;

  if (scoreGap > cfg.highThreshold || relativeGapPercent > cfg.relativeThresholdPercent * 2) {
    severity = 'high';
    overfittingDetected = true;
  } else if (
    scoreGap > cfg.mediumThreshold ||
    relativeGapPercent > cfg.relativeThresholdPercent * 1.5
  ) {
    severity = 'medium';
    overfittingDetected = true;
  } else if (scoreGap > cfg.lowThreshold || relativeGapPercent > cfg.relativeThresholdPercent) {
    severity = 'low';
    overfittingDetected = true;
  }

  // Compute detailed gaps
  const gaps = {
    medianReturnBps: trainScore.metrics.medianReturnBps - validationScore.metrics.medianReturnBps,
    stopOutRate: trainScore.metrics.stopOutRate - validationScore.metrics.stopOutRate,
    p95DrawdownBps: trainScore.metrics.p95DrawdownBps - validationScore.metrics.p95DrawdownBps,
    avgTailCapture: trainScore.metrics.avgTailCapture - validationScore.metrics.avgTailCapture,
  };

  return {
    trainScore,
    validationScore,
    scoreGap,
    relativeGapPercent,
    overfittingDetected,
    severity,
    thresholds: {
      lowThreshold: cfg.lowThreshold,
      mediumThreshold: cfg.mediumThreshold,
      highThreshold: cfg.highThreshold,
      relativeThresholdPercent: cfg.relativeThresholdPercent,
    },
    gaps,
  };
}

/**
 * Format overfitting metrics for logging/reporting
 */
export function formatOverfittingMetrics(metrics: OverfittingMetrics): string {
  const lines: string[] = [];

  lines.push(`Overfitting Detection: ${metrics.overfittingDetected ? '⚠️ DETECTED' : '✅ None'}`);
  lines.push(`Severity: ${metrics.severity.toUpperCase()}`);
  lines.push('');
  lines.push('Score Gap:');
  lines.push(`  Train Score: ${metrics.trainScore.score.toFixed(4)}`);
  lines.push(`  Validation Score: ${metrics.validationScore.score.toFixed(4)}`);
  lines.push(`  Gap: ${metrics.scoreGap.toFixed(4)}`);
  lines.push(`  Relative Gap: ${metrics.relativeGapPercent.toFixed(2)}%`);
  lines.push('');
  lines.push('Metric Gaps:');
  lines.push(`  Median Return: ${metrics.gaps.medianReturnBps.toFixed(0)} bps`);
  lines.push(`  Stop-Out Rate: ${(metrics.gaps.stopOutRate * 100).toFixed(2)}%`);
  lines.push(`  P95 Drawdown: ${metrics.gaps.p95DrawdownBps.toFixed(0)} bps`);
  lines.push(`  Tail Capture: ${metrics.gaps.avgTailCapture.toFixed(4)}`);

  return lines.join('\n');
}

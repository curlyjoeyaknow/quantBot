/**
 * Candle Data Integrity Checks
 *
 * Comprehensive integrity checks for candle data:
 * - Duplicate candles (same timestamp)
 * - Timestamp gaps (missing candles)
 * - Price anomalies (spikes, zeros, negatives)
 * - Volume anomalies
 * - OHLC consistency violations
 */

import type { Candle } from '@quantbot/core';

// =============================================================================
// Types
// =============================================================================

export interface IntegrityIssue {
  /** Issue type */
  type: 'duplicate' | 'gap' | 'price_anomaly' | 'volume_anomaly' | 'ohlc_violation';
  /** Severity level */
  severity: 'critical' | 'warning' | 'info';
  /** Issue description */
  description: string;
  /** Affected timestamp(s) */
  timestamps: number[];
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

export interface IntegrityCheckResult {
  /** Whether data passes integrity checks */
  passed: boolean;
  /** List of issues found */
  issues: IntegrityIssue[];
  /** Summary statistics */
  summary: {
    totalCandles: number;
    duplicateCount: number;
    gapCount: number;
    priceAnomalyCount: number;
    volumeAnomalyCount: number;
    ohlcViolationCount: number;
    criticalIssues: number;
    warningIssues: number;
    infoIssues: number;
  };
}

export interface IntegrityCheckConfig {
  /** Expected interval in milliseconds */
  expectedIntervalMs: number;
  /** Maximum gap size (in intervals) before flagging */
  maxGapIntervals?: number;
  /** Price spike threshold (e.g., 0.5 = 50% change) */
  priceSpikeThreshold?: number;
  /** Volume spike threshold (e.g., 2.0 = 200% of average) */
  volumeSpikeThreshold?: number;
  /** Minimum volume threshold */
  minVolume?: number;
}

const DEFAULT_CONFIG: Required<IntegrityCheckConfig> = {
  expectedIntervalMs: 300000, // 5 minutes
  maxGapIntervals: 10, // Allow up to 10 intervals gap
  priceSpikeThreshold: 0.5, // 50% change
  volumeSpikeThreshold: 2.0, // 200% of average
  minVolume: 0,
};

// =============================================================================
// Integrity Checks
// =============================================================================

/**
 * Check candle data integrity
 */
export function checkCandleIntegrity(
  candles: Candle[],
  config: IntegrityCheckConfig
): IntegrityCheckResult {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const issues: IntegrityIssue[] = [];

  if (candles.length === 0) {
    return {
      passed: false,
      issues: [
        {
          type: 'gap',
          severity: 'critical',
          description: 'No candles provided',
          timestamps: [],
        },
      ],
      summary: {
        totalCandles: 0,
        duplicateCount: 0,
        gapCount: 1,
        priceAnomalyCount: 0,
        volumeAnomalyCount: 0,
        ohlcViolationCount: 0,
        criticalIssues: 1,
        warningIssues: 0,
        infoIssues: 0,
      },
    };
  }

  // Sort candles by timestamp (ascending)
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);

  // Check for duplicates
  const duplicateIssues = checkDuplicates(sorted);
  issues.push(...duplicateIssues);

  // Check for gaps
  const gapIssues = checkGaps(sorted, cfg);
  issues.push(...gapIssues);

  // Check for price anomalies
  const priceIssues = checkPriceAnomalies(sorted, cfg);
  issues.push(...priceIssues);

  // Check for volume anomalies
  const volumeIssues = checkVolumeAnomalies(sorted, cfg);
  issues.push(...volumeIssues);

  // Check OHLC consistency
  const ohlcIssues = checkOhlcConsistency(sorted);
  issues.push(...ohlcIssues);

  // Calculate summary
  const summary = {
    totalCandles: sorted.length,
    duplicateCount: duplicateIssues.length,
    gapCount: gapIssues.length,
    priceAnomalyCount: priceIssues.length,
    volumeAnomalyCount: volumeIssues.length,
    ohlcViolationCount: ohlcIssues.length,
    criticalIssues: issues.filter((i) => i.severity === 'critical').length,
    warningIssues: issues.filter((i) => i.severity === 'warning').length,
    infoIssues: issues.filter((i) => i.severity === 'info').length,
  };

  return {
    passed: summary.criticalIssues === 0,
    issues,
    summary,
  };
}

/**
 * Check for duplicate timestamps
 */
function checkDuplicates(candles: Candle[]): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];
  const seen = new Map<number, number[]>();

  for (let i = 0; i < candles.length; i++) {
    const ts = candles[i].timestamp;
    if (!seen.has(ts)) {
      seen.set(ts, [i]);
    } else {
      seen.get(ts)!.push(i);
    }
  }

  for (const [ts, indices] of seen.entries()) {
    if (indices.length > 1) {
      issues.push({
        type: 'duplicate',
        severity: 'critical',
        description: `Duplicate timestamp: ${indices.length} candles with timestamp ${ts}`,
        timestamps: [ts],
        metadata: {
          duplicateCount: indices.length,
          indices,
        },
      });
    }
  }

  return issues;
}

/**
 * Check for gaps in timestamp sequence
 */
function checkGaps(candles: Candle[], config: Required<IntegrityCheckConfig>): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  for (let i = 1; i < candles.length; i++) {
    const prevTs = candles[i - 1].timestamp;
    const currTs = candles[i].timestamp;
    const gapMs = currTs - prevTs;
    const expectedGapMs = config.expectedIntervalMs;
    const gapIntervals = gapMs / expectedGapMs;

    if (gapIntervals > config.maxGapIntervals) {
      const severity: IntegrityIssue['severity'] =
        gapIntervals > config.maxGapIntervals * 5 ? 'critical' : 'warning';

      issues.push({
        type: 'gap',
        severity,
        description: `Gap detected: ${gapIntervals.toFixed(1)} intervals between ${prevTs} and ${currTs}`,
        timestamps: [prevTs, currTs],
        metadata: {
          gapMs,
          gapIntervals,
          expectedGapMs,
        },
      });
    }
  }

  return issues;
}

/**
 * Check for price anomalies (spikes, zeros, negatives)
 */
function checkPriceAnomalies(
  candles: Candle[],
  config: Required<IntegrityCheckConfig>
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    const ts = candle.timestamp;

    // Check for zero or negative prices
    if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0) {
      issues.push({
        type: 'price_anomaly',
        severity: 'critical',
        description: `Zero or negative price at timestamp ${ts}`,
        timestamps: [ts],
        metadata: {
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        },
      });
      continue;
    }

    // Check for price spikes (if previous candle exists)
    if (i > 0) {
      const prevClose = candles[i - 1].close;
      const currOpen = candle.open;
      const change = Math.abs((currOpen - prevClose) / prevClose);

      if (change > config.priceSpikeThreshold) {
        issues.push({
          type: 'price_anomaly',
          severity: change > config.priceSpikeThreshold * 2 ? 'critical' : 'warning',
          description: `Price spike detected: ${(change * 100).toFixed(2)}% change from ${prevClose} to ${currOpen}`,
          timestamps: [ts],
          metadata: {
            prevClose,
            currOpen,
            changePercent: change * 100,
          },
        });
      }
    }
  }

  return issues;
}

/**
 * Check for volume anomalies
 */
function checkVolumeAnomalies(
  candles: Candle[],
  config: Required<IntegrityCheckConfig>
): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  // Calculate average volume (excluding zeros)
  const volumes = candles.map((c) => c.volume).filter((v) => v > 0);
  if (volumes.length === 0) {
    // All volumes are zero - critical issue
    issues.push({
      type: 'volume_anomaly',
      severity: 'critical',
      description: 'All candles have zero volume',
      timestamps: candles.map((c) => c.timestamp),
    });
    return issues;
  }

  const avgVolume = volumes.reduce((sum, v) => sum + v, 0) / volumes.length;

  for (const candle of candles) {
    const ts = candle.timestamp;

    // Check minimum volume
    if (candle.volume < config.minVolume) {
      issues.push({
        type: 'volume_anomaly',
        severity: 'info',
        description: `Volume below minimum: ${candle.volume} < ${config.minVolume}`,
        timestamps: [ts],
        metadata: {
          volume: candle.volume,
          minVolume: config.minVolume,
        },
      });
    }

    // Check for volume spikes
    if (candle.volume > avgVolume * config.volumeSpikeThreshold) {
      issues.push({
        type: 'volume_anomaly',
        severity: 'warning',
        description: `Volume spike: ${candle.volume.toFixed(2)} (${((candle.volume / avgVolume) * 100).toFixed(1)}% of average)`,
        timestamps: [ts],
        metadata: {
          volume: candle.volume,
          avgVolume,
          spikeRatio: candle.volume / avgVolume,
        },
      });
    }
  }

  return issues;
}

/**
 * Check OHLC consistency
 */
function checkOhlcConsistency(candles: Candle[]): IntegrityIssue[] {
  const issues: IntegrityIssue[] = [];

  for (const candle of candles) {
    const ts = candle.timestamp;
    const violations: string[] = [];

    // High must be >= Low
    if (candle.high < candle.low) {
      violations.push(`high < low (${candle.high} < ${candle.low})`);
    }

    // Open must be within [low, high]
    if (candle.open < candle.low || candle.open > candle.high) {
      violations.push(`open outside [low, high] (${candle.open})`);
    }

    // Close must be within [low, high]
    if (candle.close < candle.low || candle.close > candle.high) {
      violations.push(`close outside [low, high] (${candle.close})`);
    }

    if (violations.length > 0) {
      issues.push({
        type: 'ohlc_violation',
        severity: 'critical',
        description: `OHLC consistency violation: ${violations.join(', ')}`,
        timestamps: [ts],
        metadata: {
          violations,
          open: candle.open,
          high: candle.high,
          low: candle.low,
          close: candle.close,
        },
      });
    }
  }

  return issues;
}

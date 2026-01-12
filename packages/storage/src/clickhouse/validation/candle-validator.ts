/**
 * Candle validation before insertion.
 *
 * Validation happens BEFORE insertion. Invalid OHLC data is a data corruption signal.
 *
 * Error severity levels:
 *   - CORRUPTION: Mathematically impossible data (high < low, open outside range).
 *                 This indicates a bug in the data source or pipeline.
 *                 Action: DISCARD candle, FLAG token, potentially HALT run.
 *   - QUALITY: Valid but low quality (zero volume, zero prices).
 *             Action: DISCARD or INSERT with low quality_score (configurable).
 *   - WARNING: Acceptable but noteworthy (future timestamp within tolerance).
 *             Action: INSERT but log for review.
 */

import type { Candle } from '@quantbot/core';
import { SourceTier } from '../types/quality-score.js';

/**
 * Error severity determines how validation failures are handled.
 */
export enum ValidationSeverity {
  CORRUPTION = 'corruption', // Impossible data - never insert
  QUALITY = 'quality', // Valid but poor - configurable
  WARNING = 'warning', // Acceptable - insert with note
}

export interface ValidationIssue {
  severity: ValidationSeverity;
  code: string;
  message: string;
  field?: string;
  value?: unknown;
}

export interface CandleValidationResult {
  valid: boolean; // Can this candle be inserted?
  issues: ValidationIssue[]; // All detected issues
  hasCorruption: boolean; // Any CORRUPTION-level issues?
  hasQualityIssues: boolean; // Any QUALITY-level issues?
}

/**
 * Quality validation options (configurable).
 */
export interface QualityValidationOptions {
  /** Reject candles with volume = 0 */
  rejectZeroVolume: boolean;
  /** Reject candles with any OHLC = 0 */
  rejectZeroPrice: boolean;
  /** Reject future timestamps (> now + tolerance) */
  rejectFutureTimestamps: boolean;
  /** Future tolerance in seconds */
  futureTolerance: number;
  /** Minimum source tier to allow insertion */
  minSourceTier: SourceTier;
}

/** Strict validation (default for production ingestion) */
export const STRICT_VALIDATION: QualityValidationOptions = {
  rejectZeroVolume: true, // Candles without volume are low quality
  rejectZeroPrice: true,
  rejectFutureTimestamps: true,
  futureTolerance: 300,
  minSourceTier: SourceTier.BACKFILL_RAW,
};

/** Lenient validation (for importing legacy/external data) */
export const LENIENT_VALIDATION: QualityValidationOptions = {
  rejectZeroVolume: false, // Allow zero-volume for legacy data (will have low quality score)
  rejectZeroPrice: true,
  rejectFutureTimestamps: true,
  futureTolerance: 300,
  minSourceTier: SourceTier.UNKNOWN,
};

/**
 * Validate a single candle.
 * Corruption checks are ALWAYS enforced.
 * Quality checks are configurable.
 */
export function validateCandle(
  candle: Candle,
  qualityOptions: QualityValidationOptions,
  nowMs?: number
): CandleValidationResult {
  const issues: ValidationIssue[] = [];
  const now = nowMs ?? Date.now();

  // ═══════════════════════════════════════════════════════════════════
  // CORRUPTION CHECKS - Always enforced, never configurable
  // Any of these = immediate discard, token flag
  // ═══════════════════════════════════════════════════════════════════

  if (candle.high < candle.low) {
    issues.push({
      severity: ValidationSeverity.CORRUPTION,
      code: 'INVALID_RANGE',
      message: `high (${candle.high}) < low (${candle.low})`,
      field: 'high/low',
    });
  }

  if (candle.open < candle.low || candle.open > candle.high) {
    issues.push({
      severity: ValidationSeverity.CORRUPTION,
      code: 'OPEN_OUTSIDE_RANGE',
      message: `open (${candle.open}) outside [${candle.low}, ${candle.high}]`,
      field: 'open',
      value: candle.open,
    });
  }

  if (candle.close < candle.low || candle.close > candle.high) {
    issues.push({
      severity: ValidationSeverity.CORRUPTION,
      code: 'CLOSE_OUTSIDE_RANGE',
      message: `close (${candle.close}) outside [${candle.low}, ${candle.high}]`,
      field: 'close',
      value: candle.close,
    });
  }

  if (
    candle.open < 0 ||
    candle.high < 0 ||
    candle.low < 0 ||
    candle.close < 0 ||
    candle.volume < 0
  ) {
    issues.push({
      severity: ValidationSeverity.CORRUPTION,
      code: 'NEGATIVE_VALUES',
      message: 'Negative OHLCV values detected',
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  // QUALITY CHECKS - Configurable via options
  // ═══════════════════════════════════════════════════════════════════

  if (candle.volume === 0) {
    issues.push({
      severity: qualityOptions.rejectZeroVolume
        ? ValidationSeverity.QUALITY
        : ValidationSeverity.WARNING,
      code: 'ZERO_VOLUME',
      message: 'Volume is zero',
      field: 'volume',
    });
  }

  if (qualityOptions.rejectZeroPrice) {
    if (candle.open === 0) {
      issues.push({
        severity: ValidationSeverity.QUALITY,
        code: 'ZERO_OPEN',
        message: 'Open is zero',
        field: 'open',
      });
    }
    if (candle.high === 0) {
      issues.push({
        severity: ValidationSeverity.QUALITY,
        code: 'ZERO_HIGH',
        message: 'High is zero',
        field: 'high',
      });
    }
    if (candle.low === 0) {
      issues.push({
        severity: ValidationSeverity.QUALITY,
        code: 'ZERO_LOW',
        message: 'Low is zero',
        field: 'low',
      });
    }
    if (candle.close === 0) {
      issues.push({
        severity: ValidationSeverity.QUALITY,
        code: 'ZERO_CLOSE',
        message: 'Close is zero',
        field: 'close',
      });
    }
  }

  if (qualityOptions.rejectFutureTimestamps) {
    const toleranceMs = qualityOptions.futureTolerance * 1000;
    // candle.timestamp is in seconds per domain rules, convert to ms
    const candleMs = candle.timestamp * 1000;
    if (candleMs > now + toleranceMs) {
      issues.push({
        severity: ValidationSeverity.QUALITY,
        code: 'FUTURE_TIMESTAMP',
        message: `Timestamp ${new Date(candleMs).toISOString()} is in the future`,
        field: 'timestamp',
        value: candle.timestamp,
      });
    }
  }

  const hasCorruption = issues.some((i) => i.severity === ValidationSeverity.CORRUPTION);
  const hasQualityIssues = issues.some((i) => i.severity === ValidationSeverity.QUALITY);

  return {
    valid: !hasCorruption && !hasQualityIssues,
    issues,
    hasCorruption,
    hasQualityIssues,
  };
}

/**
 * Validate a batch of candles.
 * Returns arrays of valid candles, rejected candles, and aggregate stats.
 */
export function validateCandleBatch(
  candles: Candle[],
  options: QualityValidationOptions,
  nowMs?: number
): {
  valid: Candle[];
  rejected: Array<{ candle: Candle; errors: string[] }>;
  warningCount: number;
} {
  const valid: Candle[] = [];
  const rejected: Array<{ candle: Candle; errors: string[] }> = [];
  let warningCount = 0;

  for (const candle of candles) {
    const result = validateCandle(candle, options, nowMs);
    if (result.valid) {
      valid.push(candle);
      if (result.issues.some((i) => i.severity === ValidationSeverity.WARNING)) {
        warningCount++;
      }
    } else {
      rejected.push({
        candle,
        errors: result.issues.map((i) => `${i.code}: ${i.message}`),
      });
    }
  }

  return { valid, rejected, warningCount };
}

/**
 * Token flagging and run halt policy.
 */
export interface TokenFlag {
  tokenAddress: string;
  runId: string;
  flaggedAt: Date;
  reason: 'corruption' | 'excessive_quality_failures';
  corruptionCount: number;
  sampleIssues: ValidationIssue[]; // First few issues for debugging
}

export interface RunHaltPolicy {
  /** Halt run if any single token has this many corruption errors */
  maxCorruptionPerToken: number; // Default: 1 (any corruption = flag)

  /** Halt run if total corrupted tokens exceeds this count */
  maxCorruptedTokens: number; // Default: 3 (halt and investigate)

  /** Halt run if corruption rate exceeds this percentage */
  maxCorruptionRatePercent: number; // Default: 0.1% (1 in 1000)
}

export const DEFAULT_HALT_POLICY: RunHaltPolicy = {
  maxCorruptionPerToken: 1, // First corruption flags the token
  maxCorruptedTokens: 3, // Third flagged token halts the run
  maxCorruptionRatePercent: 0.1, // 0.1% corruption rate = halt
};

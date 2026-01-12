/**
 * Quality score types and computation for OHLCV candle deduplication.
 *
 * Quality score determines which candle wins during ReplacingMergeTree deduplication.
 * Higher score = better data = wins.
 *
 * Score is computed FROM the candle data itself (volume, OHLC consistency),
 * with source tier as a tie-breaker only.
 */

import type { Candle } from '@quantbot/core';

/**
 * Source tier - indicates WHERE the data came from.
 * Used ONLY as a tie-breaker (0-5 points) when data quality is identical.
 *
 * IMPORTANT: Source tier does NOT determine quality by itself.
 * A BACKFILL_RAW candle with volume beats a CANONICAL candle without volume.
 */
export enum SourceTier {
  /** Legacy data, unknown source */
  UNKNOWN = 0,
  /** Backfill from API, no validation */
  BACKFILL_RAW = 1,
  /** Backfill from primary API (Birdeye) */
  BACKFILL_API = 2,
  /** Real-time stream ingestion */
  REALTIME = 3,
  /** Manually validated or cross-referenced */
  VALIDATED = 4,
  /** Authoritative source (e.g., exchange direct feed) */
  CANONICAL = 5,
}

/**
 * Quality score breakdown for debugging.
 */
export interface QualityScoreBreakdown {
  hasVolume: boolean; // +100 if true
  validRange: boolean; // +10 if high >= low
  consistentOpen: boolean; // +5 if open within [low, high]
  consistentClose: boolean; // +5 if close within [low, high]
  sourceTier: SourceTier; // +0-5
  totalScore: number; // Sum of all components
}

/**
 * Compute quality score from candle data.
 *
 * This score determines which candle wins during ReplacingMergeTree deduplication.
 * Higher score = better data = wins.
 *
 * Score breakdown:
 *   - Has volume (> 0):     +100 points  (MOST IMPORTANT - dominates everything)
 *   - Valid range (h >= l): +10 points
 *   - Consistent open:      +5 points (open within high/low)
 *   - Consistent close:     +5 points (close within high/low)
 *   - Source tier:          +0-5 points (tie-breaker only)
 *
 * Maximum possible score: 100 + 10 + 5 + 5 + 5 = 125
 *
 * Examples:
 *   - Raw backfill WITH volume:     100+10+5+5+1 = 121
 *   - Canonical source NO volume:   0+10+5+5+5 = 25
 *   - Legacy garbage:               0+0+0+0+0 = 0
 *
 * GUARANTEE: Any candle with volume (score >= 100) beats any candle without volume (score <= 25).
 */
export function computeQualityScore(candle: Candle, sourceTier: SourceTier): number {
  let score = 0;

  // Volume is king - a candle with volume is ALWAYS better than one without
  // This is the primary discriminator (+100 points)
  if (candle.volume > 0) {
    score += 100;
  }

  // Valid OHLC range: high must be >= low (+10 points)
  if (candle.high >= candle.low) {
    score += 10;
  }

  // Consistent open: within [low, high] range (+5 points)
  if (candle.open >= candle.low && candle.open <= candle.high) {
    score += 5;
  }

  // Consistent close: within [low, high] range (+5 points)
  if (candle.close >= candle.low && candle.close <= candle.high) {
    score += 5;
  }

  // Source tier as tie-breaker (+0-5 points)
  score += sourceTier;

  return score;
}

/**
 * Compute quality score with full breakdown for debugging.
 */
export function computeQualityScoreWithBreakdown(
  candle: Candle,
  sourceTier: SourceTier
): QualityScoreBreakdown {
  const hasVolume = candle.volume > 0;
  const validRange = candle.high >= candle.low;
  const consistentOpen = candle.open >= candle.low && candle.open <= candle.high;
  const consistentClose = candle.close >= candle.low && candle.close <= candle.high;

  const totalScore =
    (hasVolume ? 100 : 0) +
    (validRange ? 10 : 0) +
    (consistentOpen ? 5 : 0) +
    (consistentClose ? 5 : 0) +
    sourceTier;

  return {
    hasVolume,
    validRange,
    consistentOpen,
    consistentClose,
    sourceTier,
    totalScore,
  };
}

/**
 * Ingestion run manifest - audit trail for every ingestion run.
 */
export interface IngestionRunManifest {
  runId: string;
  scriptVersion: string;
  gitCommitHash: string;
  gitBranch: string;
  gitDirty: boolean;
  cliArgs: Record<string, unknown>;
  envInfo: Record<string, string>;
  inputHash: string;
  dedupMode: 'inline' | 'post-batch' | 'none';
  sourceTier: SourceTier; // Used for quality score calculation
}


/**
 * Candle Validation and Continuity Checks
 *
 * Validates candle continuity (gaps and duplicates) and aligns to interval boundaries.
 */

import type { Candle } from '@quantbot/core';
import { logger } from '@quantbot/utils';

export interface CandleSliceAudit {
  token: string;
  interval: string;
  requestedCount: number;
  fetchedCount: number;
  minTs: number;
  maxTs: number;
  duplicateCount: number;
  gapCount: number;
  alignmentOk: boolean;
  finalCount: number;
  simSafe: boolean;
}

/**
 * Get interval seconds for alignment
 */
function getIntervalSeconds(interval: string): number {
  switch (interval) {
    case '1s':
      return 1;
    case '15s':
      return 15;
    case '1m':
      return 60;
    case '5m':
      return 300;
    case '15m':
      return 900;
    case '1h':
      return 3600;
    case '4h':
      return 14400;
    case '1d':
      return 86400;
    default:
      throw new Error(`Unknown interval: ${interval}`);
  }
}

/**
 * Check if timestamp is aligned to interval boundary
 */
function isAligned(ts: number, intervalSeconds: number): boolean {
  return ts % intervalSeconds === 0;
}

/**
 * Align timestamp to interval boundary (round down)
 */
function alignTimestamp(ts: number, intervalSeconds: number): number {
  return Math.floor(ts / intervalSeconds) * intervalSeconds;
}

/**
 * Deduplicate candles by timestamp, keeping the one with highest volume
 * (deterministic dedup strategy)
 */
function deduplicateCandles(candles: Candle[]): { candles: Candle[]; duplicateCount: number } {
  const byTimestamp = new Map<number, Candle>();
  let duplicateCount = 0;

  for (const candle of candles) {
    const existing = byTimestamp.get(candle.timestamp);
    if (existing) {
      duplicateCount++;
      // Keep the one with higher volume (deterministic)
      if (candle.volume > existing.volume) {
        byTimestamp.set(candle.timestamp, candle);
      }
    } else {
      byTimestamp.set(candle.timestamp, candle);
    }
  }

  return {
    candles: Array.from(byTimestamp.values()),
    duplicateCount,
  };
}

/**
 * Check for gaps in candle sequence
 * Returns array of gap positions (indices where gap was found)
 */
function checkGaps(candles: Candle[], intervalSeconds: number): number[] {
  const gaps: number[] = [];

  if (candles.length < 2) {
    return gaps;
  }

  // Sort by timestamp
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);

  for (let i = 1; i < sorted.length; i++) {
    const prevTs = sorted[i - 1].timestamp;
    const currTs = sorted[i].timestamp;
    const expectedDiff = intervalSeconds;
    const actualDiff = currTs - prevTs;

    if (actualDiff !== expectedDiff) {
      gaps.push(i);
    }
  }

  return gaps;
}

/**
 * Validate and process candle slice
 *
 * 1. Sort by timestamp
 * 2. Deduplicate (keep highest volume)
 * 3. Check for gaps (audit only - don't filter)
 * 4. Check alignment (audit only - don't filter)
 * 5. Only trim if we have way more than expected (>110% of target)
 *
 * NOTE: This function does NOT filter out candles based on alignment or gaps.
 * It only deduplicates and provides audit information. The caller should decide
 * what to do with gaps/alignment issues.
 *
 * @param candles - Raw candles from API
 * @param token - Token address
 * @param interval - Candle interval
 * @param targetCount - Target number of candles (e.g., 5000) - used for audit only
 * @returns Processed candles (deduplicated, sorted) and audit record
 */
export function validateAndProcessCandleSlice(
  candles: Candle[],
  token: string,
  interval: string,
  targetCount: number
): { candles: Candle[]; audit: CandleSliceAudit } {
  const intervalSeconds = getIntervalSeconds(interval);
  const requestedCount = targetCount;
  const fetchedCount = candles.length;

  // Step 1: Sort by timestamp
  const sorted = [...candles].sort((a, b) => a.timestamp - b.timestamp);

  // Step 2: Deduplicate (keep highest volume)
  const { candles: deduped, duplicateCount } = deduplicateCandles(sorted);

  // Step 3: Check for gaps
  const gapPositions = checkGaps(deduped, intervalSeconds);
  const gapCount = gapPositions.length;

  // Step 4: Check alignment (but don't filter - just log warnings)
  let aligned: Candle[] = deduped; // Keep all candles
  let alignmentOk = true;

  // Check alignment without filtering
  const unalignedCount = deduped.filter((c) => !isAligned(c.timestamp, intervalSeconds)).length;
  if (unalignedCount > 0) {
    alignmentOk = false;
    const unalignedPercent = (unalignedCount / deduped.length) * 100;
    if (unalignedPercent > 10) {
      // Only warn if >10% are unaligned
      logger.warn(`Some candles not aligned for ${token} (${interval})`, {
        token,
        interval,
        totalCandles: deduped.length,
        unalignedCount,
        unalignedPercent: unalignedPercent.toFixed(1),
      });
    }
  }

  // Trim to targetCount ONLY if we have more than targetCount
  // For gap fills, we want exactly the candles we fetched (minus duplicates and ones after first existing)
  // Only trim if we somehow got way more than expected
  if (aligned.length > targetCount * 1.1) {
    // If we have significantly more than target, trim to targetCount (take last N to keep most recent)
    aligned = aligned.slice(-targetCount);
    logger.debug(
      `Trimmed candles for ${token} (${interval}) from ${deduped.length} to ${targetCount}`,
      {
        token,
        interval,
        originalCount: deduped.length,
        trimmedCount: targetCount,
      }
    );
  }

  const finalCount = aligned.length;
  const minTs = aligned.length > 0 ? aligned[0].timestamp : 0;
  const maxTs = aligned.length > 0 ? aligned[aligned.length - 1].timestamp : 0;

  // Determine if slice is sim-safe
  // Not sim-safe if: gaps exist, or too few candles, or alignment issues
  const simSafe = gapCount === 0 && finalCount >= targetCount * 0.95 && alignmentOk;

  const audit: CandleSliceAudit = {
    token,
    interval,
    requestedCount,
    fetchedCount,
    minTs,
    maxTs,
    duplicateCount,
    gapCount,
    alignmentOk,
    finalCount,
    simSafe,
  };

  return { candles: aligned, audit };
}

/**
 * Candle Data Validation
 *
 * Validates candle sequences before simulation to catch pathological cases early.
 * This prevents silent failures and ensures deterministic behavior.
 */

import type { Candle } from '../types/candle';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a single candle
 */
export function validateCandle(candle: Candle): ValidationResult {
  // Check for negative prices first (before zero check)
  if (candle.open < 0 || candle.high < 0 || candle.low < 0 || candle.close < 0) {
    return { valid: false, error: 'negative_price' };
  }

  // Check for zero prices
  if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0) {
    return { valid: false, error: 'zero_price' };
  }

  // Check for negative volume
  if (candle.volume < 0) {
    return { valid: false, error: 'negative_volume' };
  }

  // Check OHLC consistency
  if (candle.high < candle.low) {
    return { valid: false, error: 'high_less_than_low' };
  }

  if (candle.open > candle.high || candle.open < candle.low) {
    return { valid: false, error: 'ohlc_inconsistent' };
  }

  if (candle.close > candle.high || candle.close < candle.low) {
    return { valid: false, error: 'ohlc_inconsistent' };
  }

  return { valid: true };
}

/**
 * Validate a sequence of candles
 */
export function validateCandleSequence(candles: readonly Candle[]): ValidationResult {
  // Check for empty sequence
  if (candles.length === 0) {
    return { valid: false, error: 'insufficient_data' };
  }

  // Validate each candle first (before checking length)
  // This ensures we catch data quality issues (OHLC inconsistencies, negative prices, etc.)
  // before rejecting for insufficient length
  for (const candle of candles) {
    const result = validateCandle(candle);
    if (!result.valid) {
      return result;
    }
  }

  // Check for duplicate timestamps (before length check)
  const timestamps = candles.map((c) => c.timestamp);
  const uniqueTimestamps = new Set(timestamps);
  if (timestamps.length !== uniqueTimestamps.size) {
    return { valid: false, error: 'duplicate_timestamp' };
  }

  // Check for monotonic timestamps (must be sorted ascending) (before length check)
  for (let i = 1; i < candles.length; i++) {
    if (candles[i].timestamp <= candles[i - 1].timestamp) {
      return { valid: false, error: 'non_monotonic_timestamps' };
    }
  }

  // Check minimum length (need enough for indicators)
  // Only check after validating individual candles and sequence properties
  if (candles.length < 52) {
    return { valid: false, error: 'insufficient_data' };
  }

  return { valid: true };
}

/**
 * Sort candles by timestamp (ascending) if needed
 * Returns sorted copy, original unchanged
 */
export function sortCandlesByTimestamp(candles: readonly Candle[]): Candle[] {
  return [...candles].sort((a, b) => a.timestamp - b.timestamp);
}


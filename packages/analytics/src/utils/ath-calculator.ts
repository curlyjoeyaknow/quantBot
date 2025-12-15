/**
 * ATH Calculator Utility
 * =======================
 * Calculates All-Time High (ATH) metrics from OHLCV candles.
 * Extended with period-based analysis and post-ATH drawdown tracking.
 */

import type { Candle } from '@quantbot/core';

export interface AthResult {
  athPrice: number;
  athMultiple: number;
  timeToAthMinutes: number;
  atlPrice: number;
  atlTimestamp?: number; // Unix timestamp when ATL was hit
  atlMultiple: number; // Entry price / ATL price
}

/**
 * Period-based ATH/ATL result with post-ATH drawdown tracking
 */
export interface PeriodAthAtlResult {
  // Period ATH (highest price in the period)
  periodAthPrice: number;
  periodAthTimestamp: number;
  periodAthMultiple: number; // periodAthPrice / entryPrice
  timeToPeriodAthMinutes: number;

  // Period ATL (lowest price in the period, before period ATH)
  periodAtlPrice: number;
  periodAtlTimestamp?: number;
  periodAtlMultiple: number; // periodAtlPrice / entryPrice

  // Post-ATH drawdown (lowest price after period ATH)
  postAthDrawdownPrice?: number;
  postAthDrawdownTimestamp?: number;
  postAthDrawdownPercent?: number; // Percentage drop from ATH (e.g., 30 = 30% drop)
  postAthDrawdownMultiple?: number; // postAthDrawdownPrice / periodAthPrice

  // Re-entry opportunities (price retraces after drawdown)
  reEntryOpportunities?: ReEntryOpportunity[];
}

/**
 * Re-entry opportunity detected after drawdown
 */
export interface ReEntryOpportunity {
  timestamp: number;
  price: number;
  drawdownFromAth: number; // Percentage drawdown from ATH when re-entry occurred
  recoveryMultiple?: number; // If price recovered, what multiple from re-entry price
  recoveryTimestamp?: number;
}

/**
 * Calculate ATH from OHLCV candles
 *
 * @param entryPrice Entry price at alert time
 * @param entryTimestamp Entry timestamp (unix seconds)
 * @param candles Array of candles with timestamp and high price
 * @returns ATH metrics
 */
export function calculateAthFromCandles(
  entryPrice: number,
  entryTimestamp: number,
  candles: Array<{ timestamp: number; high: number; low?: number }>
): AthResult {
  // Validate inputs
  if (!entryPrice || entryPrice <= 0 || !Number.isFinite(entryPrice)) {
    return {
      athPrice: entryPrice,
      athMultiple: 1,
      timeToAthMinutes: 0,
      atlPrice: entryPrice,
      atlMultiple: 1,
    };
  }

  if (!entryTimestamp || entryTimestamp <= 0) {
    return {
      athPrice: entryPrice,
      athMultiple: 1,
      timeToAthMinutes: 0,
      atlPrice: entryPrice,
      atlMultiple: 1,
    };
  }

  if (!candles || candles.length === 0) {
    return {
      athPrice: entryPrice,
      athMultiple: 1,
      timeToAthMinutes: 0,
      atlPrice: entryPrice,
      atlMultiple: 1,
    };
  }

  let athPrice = entryPrice;
  let athTimestamp = entryTimestamp;

  // First pass: Find the ATH (highest high after entry)
  for (const candle of candles) {
    if (candle.timestamp > entryTimestamp) {
      const candleHigh = candle.high;

      if (candleHigh && Number.isFinite(candleHigh) && candleHigh > 0) {
        if (candleHigh > athPrice) {
          athPrice = candleHigh;
          athTimestamp = candle.timestamp;
        }
      }
    }
  }

  // Second pass: Find the ATL (lowest low) from entry until ATH timestamp
  // ATL is only tracked until ATH is reached (not after)
  let atlPrice = entryPrice;
  let atlTimestamp: number | undefined = undefined;

  for (const candle of candles) {
    // Only consider candles from entry time up to ATH timestamp
    if (candle.timestamp > entryTimestamp && candle.timestamp <= athTimestamp) {
      const candleLow = candle.low;

      if (candleLow && Number.isFinite(candleLow) && candleLow > 0) {
        if (candleLow < atlPrice) {
          atlPrice = candleLow;
          atlTimestamp = candle.timestamp;
        }
      }
    }
  }

  // Calculate multiples
  const athMultiple = athPrice / entryPrice;
  const atlMultiple = atlPrice / entryPrice; // Ratio of ATL to entry (0.5 = dropped to 50%, 0.25 = dropped to 25%)

  // Calculate time to ATH in minutes
  const timeToAthMinutes = (athTimestamp - entryTimestamp) / 60;

  // Sanity check: cap multiples at 10000x to filter data issues
  if (athMultiple > 10000) {
    return {
      athPrice: entryPrice,
      athMultiple: 1,
      timeToAthMinutes: 0,
      atlPrice: entryPrice,
      atlMultiple: 1,
    };
  }

  return {
    athPrice,
    athMultiple,
    timeToAthMinutes,
    atlPrice,
    atlTimestamp,
    atlMultiple,
  };
}

/**
 * Calculate ATH from Candle objects (from @quantbot/core)
 */
export function calculateAthFromCandleObjects(
  entryPrice: number,
  entryTimestamp: number,
  candles: Candle[]
): AthResult {
  // Convert Candle objects to simple format (include both high and low)
  const simpleCandles = candles.map((c) => ({
    timestamp: c.timestamp,
    high: c.high,
    low: c.low,
  }));

  return calculateAthFromCandles(entryPrice, entryTimestamp, simpleCandles);
}

/**
 * Calculate period-based ATH/ATL with post-ATH drawdown tracking
 *
 * This function is designed for re-entry strategies:
 * 1. Finds ATH within a specific period
 * 2. Tracks ATL before ATH (entry drawdown)
 * 3. Tracks drawdown after ATH (for re-entry opportunities)
 * 4. Identifies potential re-entry points after drawdowns
 *
 * @param entryPrice Entry price at alert time
 * @param entryTimestamp Entry timestamp (unix seconds)
 * @param candles Array of candles with timestamp, high, and low
 * @param periodEndTimestamp Optional: end of analysis period (defaults to last candle)
 * @param minDrawdownPercent Minimum drawdown percentage to consider for re-entry (default: 20%)
 * @param minRecoveryPercent Minimum recovery percentage to mark as successful re-entry (default: 10%)
 * @returns Period-based ATH/ATL metrics with drawdown analysis
 */
export function calculatePeriodAthAtl(
  entryPrice: number,
  entryTimestamp: number,
  candles: Array<{ timestamp: number; high: number; low?: number }>,
  periodEndTimestamp?: number,
  minDrawdownPercent: number = 20,
  minRecoveryPercent: number = 10
): PeriodAthAtlResult {
  // Validate inputs
  if (!entryPrice || entryPrice <= 0 || !Number.isFinite(entryPrice)) {
    return createEmptyPeriodResult(entryPrice);
  }

  if (!entryTimestamp || entryTimestamp <= 0) {
    return createEmptyPeriodResult(entryPrice);
  }

  if (!candles || candles.length === 0) {
    return createEmptyPeriodResult(entryPrice);
  }

  // Determine period end
  const periodEnd = periodEndTimestamp || Math.max(...candles.map((c) => c.timestamp));

  // Filter candles within period (period end is exclusive if provided)
  const periodCandles = candles.filter((c) => {
    if (c.timestamp <= entryTimestamp) return false;
    if (periodEndTimestamp !== undefined && c.timestamp >= periodEnd) return false;
    return true;
  });

  if (periodCandles.length === 0) {
    return createEmptyPeriodResult(entryPrice);
  }

  // Step 1: Find period ATH (highest high in the period, respecting period end)
  let periodAthPrice = entryPrice;
  let periodAthTimestamp = entryTimestamp;

  for (const candle of periodCandles) {
    // Only consider candles up to period end
    if (
      candle.timestamp <= periodEnd &&
      candle.high &&
      Number.isFinite(candle.high) &&
      candle.high > 0
    ) {
      if (candle.high > periodAthPrice) {
        periodAthPrice = candle.high;
        periodAthTimestamp = candle.timestamp;
      }
    }
  }

  // Step 2: Find period ATL (lowest low before period ATH)
  let periodAtlPrice = entryPrice;
  let periodAtlTimestamp: number | undefined = undefined;

  for (const candle of periodCandles) {
    if (candle.timestamp <= periodAthTimestamp && candle.low) {
      if (Number.isFinite(candle.low) && candle.low > 0 && candle.low < periodAtlPrice) {
        periodAtlPrice = candle.low;
        periodAtlTimestamp = candle.timestamp;
      }
    }
  }

  // Step 3: Find post-ATH drawdown (lowest low after period ATH)
  let postAthDrawdownPrice: number | undefined = undefined;
  let postAthDrawdownTimestamp: number | undefined = undefined;

  for (const candle of periodCandles) {
    if (candle.timestamp > periodAthTimestamp && candle.low) {
      if (Number.isFinite(candle.low) && candle.low > 0) {
        if (postAthDrawdownPrice === undefined || candle.low < postAthDrawdownPrice) {
          postAthDrawdownPrice = candle.low;
          postAthDrawdownTimestamp = candle.timestamp;
        }
      }
    }
  }

  // Calculate metrics
  const periodAthMultiple = periodAthPrice / entryPrice;
  const periodAtlMultiple = periodAtlPrice / entryPrice;
  const timeToPeriodAthMinutes = (periodAthTimestamp - entryTimestamp) / 60;

  // Calculate post-ATH drawdown percentage
  let postAthDrawdownPercent: number | undefined = undefined;
  let postAthDrawdownMultiple: number | undefined = undefined;

  if (postAthDrawdownPrice !== undefined && periodAthPrice > 0) {
    postAthDrawdownPercent = ((periodAthPrice - postAthDrawdownPrice) / periodAthPrice) * 100;
    postAthDrawdownMultiple = postAthDrawdownPrice / periodAthPrice;
  }

  // Step 4: Identify re-entry opportunities
  const reEntryOpportunities = identifyReEntryOpportunities(
    periodCandles,
    periodAthTimestamp,
    periodAthPrice,
    postAthDrawdownPrice,
    minDrawdownPercent,
    minRecoveryPercent
  );

  // Sanity check: cap multiples at 10000x
  if (periodAthMultiple > 10000) {
    return createEmptyPeriodResult(entryPrice);
  }

  return {
    periodAthPrice,
    periodAthTimestamp,
    periodAthMultiple,
    timeToPeriodAthMinutes,
    periodAtlPrice,
    periodAtlTimestamp,
    periodAtlMultiple,
    postAthDrawdownPrice,
    postAthDrawdownTimestamp,
    postAthDrawdownPercent,
    postAthDrawdownMultiple,
    reEntryOpportunities: reEntryOpportunities.length > 0 ? reEntryOpportunities : undefined,
  };
}

/**
 * Identify re-entry opportunities after drawdowns
 *
 * Looks for patterns where:
 * 1. Price drops significantly from ATH (drawdown)
 * 2. Price then recovers (potential re-entry success)
 */
function identifyReEntryOpportunities(
  candles: Array<{ timestamp: number; high: number; low?: number }>,
  athTimestamp: number,
  athPrice: number,
  maxDrawdownPrice: number | undefined,
  minDrawdownPercent: number,
  minRecoveryPercent: number
): ReEntryOpportunity[] {
  if (maxDrawdownPrice === undefined || athPrice <= 0) {
    return [];
  }

  const opportunities: ReEntryOpportunity[] = [];
  const postAthCandles = candles.filter((c) => c.timestamp > athTimestamp);

  // Track drawdowns and recoveries
  let currentDrawdownPrice: number | undefined = undefined;
  let currentDrawdownTimestamp: number | undefined = undefined;
  let recoveryPrice: number | undefined = undefined;
  let recoveryTimestamp: number | undefined = undefined;

  for (const candle of postAthCandles) {
    const candleLow = candle.low;
    const candleHigh = candle.high;

    if (!candleLow || !candleHigh || !Number.isFinite(candleLow) || !Number.isFinite(candleHigh)) {
      continue;
    }

    // Check if we hit a new drawdown
    if (candleLow < (currentDrawdownPrice || athPrice)) {
      const drawdownPercent = ((athPrice - candleLow) / athPrice) * 100;

      if (drawdownPercent >= minDrawdownPercent) {
        currentDrawdownPrice = candleLow;
        currentDrawdownTimestamp = candle.timestamp;
        // Reset recovery tracking when we hit a new drawdown
        recoveryPrice = undefined;
        recoveryTimestamp = undefined;
      }
    }

    // Check if we recovered from drawdown
    if (currentDrawdownPrice !== undefined && candleHigh > currentDrawdownPrice) {
      const recoveryPercent = ((candleHigh - currentDrawdownPrice) / currentDrawdownPrice) * 100;

      if (recoveryPercent >= minRecoveryPercent) {
        recoveryPrice = candleHigh;
        recoveryTimestamp = candle.timestamp;
      }
    }

    // If we have both a drawdown and recovery, record the opportunity
    if (
      currentDrawdownPrice !== undefined &&
      currentDrawdownTimestamp !== undefined &&
      recoveryPrice !== undefined &&
      recoveryTimestamp !== undefined &&
      recoveryTimestamp > currentDrawdownTimestamp
    ) {
      const drawdownFromAth = ((athPrice - currentDrawdownPrice) / athPrice) * 100;
      const recoveryMultiple = recoveryPrice / currentDrawdownPrice;

      // Check if this opportunity is already recorded (avoid duplicates)
      const isDuplicate = opportunities.some(
        (opp) => Math.abs(opp.timestamp - currentDrawdownTimestamp!) < 3600 // Within 1 hour
      );

      if (!isDuplicate) {
        opportunities.push({
          timestamp: currentDrawdownTimestamp,
          price: currentDrawdownPrice,
          drawdownFromAth,
          recoveryMultiple,
          recoveryTimestamp,
        });

        // Reset for next opportunity
        currentDrawdownPrice = undefined;
        currentDrawdownTimestamp = undefined;
        recoveryPrice = undefined;
        recoveryTimestamp = undefined;
      }
    }
  }

  return opportunities;
}

/**
 * Create empty period result for error cases
 */
function createEmptyPeriodResult(entryPrice: number): PeriodAthAtlResult {
  return {
    periodAthPrice: entryPrice,
    periodAthTimestamp: 0,
    periodAthMultiple: 1,
    timeToPeriodAthMinutes: 0,
    periodAtlPrice: entryPrice,
    periodAtlMultiple: 1,
  };
}

/**
 * Calculate period-based ATH/ATL from Candle objects
 */
export function calculatePeriodAthAtlFromCandles(
  entryPrice: number,
  entryTimestamp: number,
  candles: Candle[],
  periodEndTimestamp?: number,
  minDrawdownPercent?: number,
  minRecoveryPercent?: number
): PeriodAthAtlResult {
  const simpleCandles = candles.map((c) => ({
    timestamp: c.timestamp,
    high: c.high,
    low: c.low,
  }));

  return calculatePeriodAthAtl(
    entryPrice,
    entryTimestamp,
    simpleCandles,
    periodEndTimestamp,
    minDrawdownPercent,
    minRecoveryPercent
  );
}

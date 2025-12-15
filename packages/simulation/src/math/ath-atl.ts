/**
 * ATH/ATL Math Utilities
 * =======================
 * Pure math functions for calculating All-Time High (ATH) and All-Time Low (ATL) metrics.
 * Extracted from @quantbot/analytics to remove dependency.
 */

import type { Candle } from '../types';

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
  recoveryMultiple: number; // Price recovery multiple from drawdown price
  recoveryTimestamp: number; // Timestamp when recovery was detected
}

/**
 * Calculate period-based ATH/ATL from Candle objects
 */
export function calculatePeriodAthAtlFromCandles(
  entryPrice: number,
  entryTimestamp: number,
  candles: Candle[],
  periodEndTimestamp?: number,
  minDrawdownPercent: number = 20,
  minRecoveryPercent: number = 10
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

/**
 * Core calculation function (pure math)
 */
function calculatePeriodAthAtl(
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

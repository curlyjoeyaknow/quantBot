/**
 * Period Metrics Integration
 * ==========================
 * Calculates period-based ATH/ATL metrics for simulation results.
 * Uses pure math utilities from simulation/math.
 */

import { DateTime } from 'luxon';
import type { Candle } from '../types';
import type { PeriodMetrics } from '../types/results';
import type { PeriodMetricsConfig } from '../config';
import {
  calculatePeriodAthAtlFromCandles,
  type PeriodAthAtlResult,
  type ReEntryOpportunity,
} from '../math/ath-atl';

/**
 * Calculate period metrics from simulation candles and entry price
 */
export function calculatePeriodMetricsForSimulation(
  candles: Candle[],
  entryPrice: number,
  entryTimestamp: number,
  config: PeriodMetricsConfig
): PeriodMetrics | undefined {
  if (!config.enabled || candles.length === 0) {
    return undefined;
  }

  try {
    // Calculate period end timestamp
    const entryDateTime = DateTime.fromSeconds(entryTimestamp);
    const periodEndDateTime = entryDateTime.plus({ days: config.periodDays });
    const periodEndTimestamp = Math.floor(periodEndDateTime.toSeconds());

    // Calculate period metrics using analytics package
    const result: PeriodAthAtlResult = calculatePeriodAthAtlFromCandles(
      entryPrice,
      entryTimestamp,
      candles,
      periodEndTimestamp,
      config.minDrawdownPercent,
      config.minRecoveryPercent
    );

    // Convert to simulation PeriodMetrics format
    return {
      periodAthPrice: result.periodAthPrice,
      periodAthTimestamp: result.periodAthTimestamp,
      periodAthMultiple: result.periodAthMultiple,
      timeToPeriodAthMinutes: result.timeToPeriodAthMinutes,
      periodAtlPrice: result.periodAtlPrice,
      periodAtlTimestamp: result.periodAtlTimestamp,
      periodAtlMultiple: result.periodAtlMultiple,
      postAthDrawdownPrice: result.postAthDrawdownPrice,
      postAthDrawdownTimestamp: result.postAthDrawdownTimestamp,
      postAthDrawdownPercent: result.postAthDrawdownPercent,
      postAthDrawdownMultiple: result.postAthDrawdownMultiple,
      reEntryOpportunities: result.reEntryOpportunities?.map((opp: ReEntryOpportunity) => ({
        timestamp: opp.timestamp,
        price: opp.price,
        drawdownFromAth: opp.drawdownFromAth,
        recoveryMultiple: opp.recoveryMultiple,
        recoveryTimestamp: opp.recoveryTimestamp,
      })),
    };
  } catch (error) {
    // Silently fail - period metrics are optional
    console.warn('[PeriodMetrics] Failed to calculate period metrics:', error);
    return undefined;
  }
}

/**
 * Enrich simulation result with period metrics
 */
export function enrichSimulationResultWithPeriodMetrics(
  result: { entryPrice: number; events: Array<{ timestamp: number }> },
  candles: Candle[],
  config?: PeriodMetricsConfig
): PeriodMetrics | undefined {
  if (!config?.enabled || candles.length === 0) {
    return undefined;
  }

  // Find entry timestamp from events or use first candle
  let entryTimestamp: number;
  const entryEvent = result.events.find((e) => e.timestamp > 0);
  if (entryEvent) {
    entryTimestamp = entryEvent.timestamp;
  } else if (candles.length > 0) {
    entryTimestamp = candles[0].timestamp;
  } else {
    return undefined;
  }

  return calculatePeriodMetricsForSimulation(candles, result.entryPrice, entryTimestamp, config);
}

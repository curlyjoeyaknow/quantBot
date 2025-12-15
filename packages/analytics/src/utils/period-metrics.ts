/**
 * Period Metrics Utility
 * ======================
 * Utilities for enriching calls with period-based ATH/ATL metrics
 * and post-ATH drawdown analysis for re-entry strategies.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import { getStorageEngine } from '@quantbot/storage';
import type { CallPerformance, PeriodMetrics } from '../types';
import { calculatePeriodAthAtlFromCandles } from './ath-calculator';

export interface EnrichPeriodMetricsOptions {
  /** Analysis period in days (default: 7 days) */
  periodDays?: number;
  /** Minimum drawdown percentage to consider for re-entry (default: 20%) */
  minDrawdownPercent?: number;
  /** Minimum recovery percentage to mark as successful re-entry (default: 10%) */
  minRecoveryPercent?: number;
  /** Use cache for candle fetching (default: true) */
  useCache?: boolean;
}

/**
 * Enrich a single call with period-based metrics
 */
export async function enrichCallWithPeriodMetrics(
  call: CallPerformance,
  options: EnrichPeriodMetricsOptions = {}
): Promise<CallPerformance> {
  const {
    periodDays = 7,
    minDrawdownPercent = 20,
    minRecoveryPercent = 10,
    useCache = true,
  } = options;

  try {
    const storageEngine = getStorageEngine();
    const alertTime = DateTime.fromJSDate(call.alertTimestamp);
    const entryTimestamp = Math.floor(alertTime.toSeconds());

    // Calculate period end (periodDays after alert)
    const periodEnd = alertTime.plus({ days: periodDays });
    const periodEndTimestamp = Math.floor(periodEnd.toSeconds());

    // Fetch candles for the period
    let candles = await storageEngine.getCandles(
      call.tokenAddress,
      call.chain,
      alertTime,
      periodEnd,
      { interval: '5m', useCache }
    );

    // Fallback to 1m if no 5m candles
    if (candles.length === 0) {
      candles = await storageEngine.getCandles(
        call.tokenAddress,
        call.chain,
        alertTime,
        periodEnd,
        { interval: '1m', useCache }
      );
    }

    if (candles.length === 0) {
      logger.debug('[PeriodMetrics] No candles found for call', {
        callId: call.callId,
        tokenAddress: call.tokenAddress,
      });
      return call;
    }

    // Calculate period metrics
    const periodResult = calculatePeriodAthAtlFromCandles(
      call.entryPrice,
      entryTimestamp,
      candles,
      periodEndTimestamp,
      minDrawdownPercent,
      minRecoveryPercent
    );

    // Convert to PeriodMetrics format
    const periodMetrics: PeriodMetrics = {
      periodAthPrice: periodResult.periodAthPrice,
      periodAthTimestamp: new Date(periodResult.periodAthTimestamp * 1000),
      periodAthMultiple: periodResult.periodAthMultiple,
      timeToPeriodAthMinutes: periodResult.timeToPeriodAthMinutes,
      periodAtlPrice: periodResult.periodAtlPrice,
      periodAtlTimestamp: periodResult.periodAtlTimestamp
        ? new Date(periodResult.periodAtlTimestamp * 1000)
        : undefined,
      periodAtlMultiple: periodResult.periodAtlMultiple,
      postAthDrawdownPrice: periodResult.postAthDrawdownPrice,
      postAthDrawdownTimestamp: periodResult.postAthDrawdownTimestamp
        ? new Date(periodResult.postAthDrawdownTimestamp * 1000)
        : undefined,
      postAthDrawdownPercent: periodResult.postAthDrawdownPercent,
      postAthDrawdownMultiple: periodResult.postAthDrawdownMultiple,
      reEntryOpportunities: periodResult.reEntryOpportunities?.map((opp) => ({
        timestamp: new Date(opp.timestamp * 1000),
        price: opp.price,
        drawdownFromAth: opp.drawdownFromAth,
        recoveryMultiple: opp.recoveryMultiple,
        recoveryTimestamp: opp.recoveryTimestamp
          ? new Date(opp.recoveryTimestamp * 1000)
          : undefined,
      })),
    };

    return {
      ...call,
      periodMetrics,
    };
  } catch (error) {
    logger.warn('[PeriodMetrics] Failed to enrich call with period metrics', {
      error: error instanceof Error ? error.message : String(error),
      callId: call.callId,
    });
    return call;
  }
}

/**
 * Enrich multiple calls with period-based metrics
 */
export async function enrichCallsWithPeriodMetrics(
  calls: CallPerformance[],
  options: EnrichPeriodMetricsOptions = {}
): Promise<CallPerformance[]> {
  logger.info(`[PeriodMetrics] Enriching ${calls.length} calls with period metrics`);

  const enriched: CallPerformance[] = [];
  let enrichedCount = 0;
  let skippedCount = 0;

  // Process in batches to avoid overwhelming the system
  const batchSize = 10;
  for (let i = 0; i < calls.length; i += batchSize) {
    const batch = calls.slice(i, i + batchSize);

    const results = await Promise.allSettled(
      batch.map((call) => enrichCallWithPeriodMetrics(call, options))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        enriched.push(result.value);
        if (result.value.periodMetrics) {
          enrichedCount++;
        } else {
          skippedCount++;
        }
      } else {
        // If enrichment failed, keep the original call
        const originalCall = batch[results.indexOf(result)];
        if (originalCall) {
          enriched.push(originalCall);
          skippedCount++;
        }
      }
    }
  }

  logger.info(
    `[PeriodMetrics] Enriched ${enrichedCount} calls, skipped ${skippedCount} (no data or errors)`
  );
  return enriched;
}

/**
 * Analyze re-entry opportunities across multiple calls
 */
export interface ReEntryAnalysis {
  totalCalls: number;
  callsWithReEntries: number;
  totalReEntryOpportunities: number;
  avgDrawdownPercent: number;
  avgRecoveryMultiple: number;
  successfulReEntries: number; // Re-entries that recovered
  failedReEntries: number; // Re-entries that didn't recover
}

/**
 * Analyze re-entry opportunities from enriched calls
 */
export function analyzeReEntryOpportunities(calls: CallPerformance[]): ReEntryAnalysis {
  let callsWithReEntries = 0;
  let totalReEntryOpportunities = 0;
  let totalDrawdownPercent = 0;
  let totalRecoveryMultiple = 0;
  let successfulReEntries = 0;
  let failedReEntries = 0;

  for (const call of calls) {
    if (!call.periodMetrics?.reEntryOpportunities) {
      continue;
    }

    const opportunities = call.periodMetrics.reEntryOpportunities;
    if (opportunities.length > 0) {
      callsWithReEntries++;
      totalReEntryOpportunities += opportunities.length;

      for (const opp of opportunities) {
        totalDrawdownPercent += opp.drawdownFromAth;

        if (opp.recoveryMultiple !== undefined) {
          totalRecoveryMultiple += opp.recoveryMultiple;
          successfulReEntries++;
        } else {
          failedReEntries++;
        }
      }
    }
  }

  return {
    totalCalls: calls.length,
    callsWithReEntries,
    totalReEntryOpportunities,
    avgDrawdownPercent:
      totalReEntryOpportunities > 0 ? totalDrawdownPercent / totalReEntryOpportunities : 0,
    avgRecoveryMultiple: successfulReEntries > 0 ? totalRecoveryMultiple / successfulReEntries : 0,
    successfulReEntries,
    failedReEntries,
  };
}

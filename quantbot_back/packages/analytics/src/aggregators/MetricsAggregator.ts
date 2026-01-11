/**
 * Metrics Aggregator
 * ==================
 * Aggregates call performance data into metrics and statistics.
 */

import { logger } from '@quantbot/utils';
// PostgreSQL removed - use DuckDB workflows instead
import type { CallPerformance, CallerMetrics, AthDistribution, SystemMetrics } from '../types.js';

/**
 * ATH bucket definitions
 */
const ATH_BUCKETS = [
  { min: 0, max: 1, label: 'Loss (<1x)' },
  { min: 1, max: 1.5, label: '1.0-1.5x' },
  { min: 1.5, max: 2, label: '1.5-2x' },
  { min: 2, max: 5, label: '2-5x' },
  { min: 5, max: 10, label: '5-10x' },
  { min: 10, max: 20, label: '10-20x' },
  { min: 20, max: 50, label: '20-50x' },
  { min: 50, max: Infinity, label: '50x+' },
];

/**
 * Metrics Aggregator - Production-ready aggregation
 */
export class MetricsAggregator {
  /**
   * Aggregate caller metrics from calls
   */
  aggregateCallerMetrics(calls: CallPerformance[]): CallerMetrics[] {
    const byCaller = new Map<string, CallPerformance[]>();

    // Group calls by caller
    for (const call of calls) {
      if (!byCaller.has(call.callerName)) {
        byCaller.set(call.callerName, []);
      }
      byCaller.get(call.callerName)!.push(call);
    }

    // Calculate metrics for each caller
    const metrics: CallerMetrics[] = [];

    for (const [callerName, callerCalls] of byCaller.entries()) {
      // Filter out invalid calls (NaN, Infinity, negative, zero entry price)
      const validCalls = callerCalls.filter(
        (c) =>
          c &&
          !Number.isNaN(c.athMultiple) &&
          Number.isFinite(c.athMultiple) &&
          c.athMultiple > 0 &&
          c.entryPrice > 0 &&
          Number.isFinite(c.entryPrice)
      );
      const invalidCalls = callerCalls.filter(
        (c) =>
          !c ||
          Number.isNaN(c.athMultiple) ||
          !Number.isFinite(c.athMultiple) ||
          c.athMultiple <= 0 ||
          c.entryPrice <= 0 ||
          !Number.isFinite(c.entryPrice)
      );

      const winningCalls = validCalls.filter((c) => c.athMultiple > 1);
      const losingCalls = validCalls.filter((c) => c.athMultiple <= 1);
      // Include invalid calls as losing calls for conservation law
      const totalLosingCalls = losingCalls.length + invalidCalls.length;
      const multiples = validCalls.map((c) => c.athMultiple);
      const timesToAth = callerCalls
        .filter((c) => c && c.timeToAthMinutes > 0 && Number.isFinite(c.timeToAthMinutes))
        .map((c) => c.timeToAthMinutes);

      // Filter out invalid timestamps
      const validTimestamps = callerCalls
        .filter((c) => c && c.alertTimestamp && !isNaN(c.alertTimestamp.getTime()))
        .map((c) => c.alertTimestamp.getTime());

      if (validTimestamps.length === 0) {
        logger.warn(`[MetricsAggregator] No valid timestamps for caller ${callerName}`);
      }

      metrics.push({
        callerName,
        totalCalls: callerCalls.length,
        winningCalls: winningCalls.length,
        losingCalls: totalLosingCalls,
        winRate: callerCalls.length > 0 ? winningCalls.length / callerCalls.length : 0,
        avgMultiple:
          multiples.length > 0 ? multiples.reduce((a, b) => a + b, 0) / multiples.length : 0,
        bestMultiple: multiples.length > 0 ? Math.max(...multiples) : 0,
        worstMultiple: multiples.length > 0 ? Math.min(...multiples) : 0,
        avgTimeToAth:
          timesToAth.length > 0 ? timesToAth.reduce((a, b) => a + b, 0) / timesToAth.length : 0,
        firstCall: validTimestamps.length > 0 ? new Date(Math.min(...validTimestamps)) : new Date(),
        lastCall: validTimestamps.length > 0 ? new Date(Math.max(...validTimestamps)) : new Date(),
      });
    }

    // Sort by total calls (descending)
    metrics.sort((a, b) => b.totalCalls - a.totalCalls);

    logger.debug(`[MetricsAggregator] Aggregated metrics for ${metrics.length} callers`);
    return metrics;
  }

  /**
   * Calculate ATH distribution
   */
  calculateAthDistribution(calls: CallPerformance[]): AthDistribution[] {
    if (!calls || calls.length === 0) {
      return ATH_BUCKETS.map((b) => ({
        bucket: b.label,
        count: 0,
        percentage: 0,
        avgTimeToAth: 0,
      }));
    }

    // Separate valid and NaN calls
    const validCalls = calls.filter((c) => !Number.isNaN(c.athMultiple));
    const nanCalls = calls.filter((c) => Number.isNaN(c.athMultiple));

    const distribution: AthDistribution[] = [];

    for (const bucket of ATH_BUCKETS) {
      const inBucket = validCalls.filter(
        (c) => c.athMultiple >= bucket.min && c.athMultiple < bucket.max
      );

      // Include NaN calls in the "Loss (<1x)" bucket (first bucket)
      const count =
        bucket.min === 0 && bucket.max === 1 ? inBucket.length + nanCalls.length : inBucket.length;

      const avgTimeToAth =
        inBucket.length > 0
          ? inBucket
              .filter((c) => c.timeToAthMinutes > 0)
              .reduce((sum, c) => sum + c.timeToAthMinutes, 0) / inBucket.length
          : 0;

      distribution.push({
        bucket: bucket.label,
        count,
        percentage: calls.length > 0 ? (count / calls.length) * 100 : 0,
        avgTimeToAth,
      });
    }

    logger.debug('[MetricsAggregator] Calculated ATH distribution');
    return distribution;
  }

  /**
   * Calculate system metrics
   */
  /**
   * Calculate system metrics
   *
   * @deprecated PostgreSQL removed - use DuckDB workflows to get system metrics
   */
  async calculateSystemMetrics(calls: CallPerformance[]): Promise<SystemMetrics> {
    // PostgreSQL removed - calculate metrics from provided calls only
    // For full system metrics, use DuckDB workflows

    // Filter valid calls (with valid timestamps)
    const validCalls = calls.filter(
      (c) => c && c.alertTimestamp && !isNaN(c.alertTimestamp.getTime())
    );

    // Extract unique callers and tokens
    const uniqueCallers = new Set<string>();
    const uniqueTokens = new Set<string>();
    const validTimestamps: number[] = [];

    for (const call of validCalls) {
      if (call.callerName) {
        uniqueCallers.add(call.callerName);
      }
      if (call.tokenAddress) {
        uniqueTokens.add(call.tokenAddress);
      }
      if (call.alertTimestamp && !isNaN(call.alertTimestamp.getTime())) {
        validTimestamps.push(call.alertTimestamp.getTime());
      }
    }

    // Return metrics based on provided calls (no DB queries)
    return {
      totalCalls: validCalls.length,
      totalCallers: uniqueCallers.size,
      totalTokens: uniqueTokens.size,
      dataRange: {
        start: validTimestamps.length > 0 ? new Date(Math.min(...validTimestamps)) : new Date(),
        end: validTimestamps.length > 0 ? new Date(Math.max(...validTimestamps)) : new Date(),
      },
      simulationsTotal: 0, // Requires DuckDB query - use workflows
      simulationsToday: 0, // Requires DuckDB query - use workflows
    };
  }
}

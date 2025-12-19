/**
 * Metrics Aggregator
 * ==================
 * Aggregates call performance data into metrics and statistics.
 */

import { logger } from '@quantbot/utils';
// PostgreSQL removed - use DuckDB workflows instead
import type { CallPerformance, CallerMetrics, AthDistribution, SystemMetrics } from '../types';

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
      const winningCalls = callerCalls.filter((c) => c.athMultiple > 1);
      const losingCalls = callerCalls.filter((c) => c.athMultiple <= 1);
      const multiples = callerCalls.map((c) => c.athMultiple);
      const timesToAth = callerCalls
        .filter((c) => c.timeToAthMinutes > 0)
        .map((c) => c.timeToAthMinutes);

      const timestamps = callerCalls.map((c) => c.alertTimestamp.getTime());

      metrics.push({
        callerName,
        totalCalls: callerCalls.length,
        winningCalls: winningCalls.length,
        losingCalls: losingCalls.length,
        winRate: callerCalls.length > 0 ? winningCalls.length / callerCalls.length : 0,
        avgMultiple:
          multiples.length > 0 ? multiples.reduce((a, b) => a + b, 0) / multiples.length : 0,
        bestMultiple: multiples.length > 0 ? Math.max(...multiples) : 0,
        worstMultiple: multiples.length > 0 ? Math.min(...multiples) : 0,
        avgTimeToAth:
          timesToAth.length > 0 ? timesToAth.reduce((a, b) => a + b, 0) / timesToAth.length : 0,
        firstCall: new Date(Math.min(...timestamps)),
        lastCall: new Date(Math.max(...timestamps)),
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
    if (calls.length === 0) {
      return ATH_BUCKETS.map((b) => ({
        bucket: b.label,
        count: 0,
        percentage: 0,
        avgTimeToAth: 0,
      }));
    }

    const distribution: AthDistribution[] = [];

    for (const bucket of ATH_BUCKETS) {
      const inBucket = calls.filter(
        (c) => c.athMultiple >= bucket.min && c.athMultiple < bucket.max
      );

      const avgTimeToAth =
        inBucket.length > 0
          ? inBucket
              .filter((c) => c.timeToAthMinutes > 0)
              .reduce((sum, c) => sum + c.timeToAthMinutes, 0) / inBucket.length
          : 0;

      distribution.push({
        bucket: bucket.label,
        count: inBucket.length,
        percentage: (inBucket.length / calls.length) * 100,
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
    
    // Calculate date range from calls
    const timestamps = calls.map((c) => c.alertTimestamp.getTime());
    const dataRange = {
      start: timestamps.length > 0 ? new Date(Math.min(...timestamps)) : new Date(),
      end: timestamps.length > 0 ? new Date(Math.max(...timestamps)) : new Date(),
    };

    // Return metrics based on provided calls (no DB queries)
    return {
      totalCalls: calls.length,
      totalCallers: new Set(calls.map((c) => c.callerName)).size,
      totalTokens: new Set(calls.map((c) => c.tokenAddress)).size,
      dataRange,
      simulationsTotal: 0, // Requires DuckDB query - use workflows
      simulationsToday: 0, // Requires DuckDB query - use workflows
    };
  }
}

/**
 * Data Coverage Tooling
 *
 * Calculates % completeness per token/window and detects anomalies.
 */

import { DateTime } from 'luxon';
import type { CanonicalEvent } from '../canonical/schemas.js';

/**
 * Coverage metrics for a token in a time window
 */
export interface TokenCoverage {
  /**
   * Token address
   */
  tokenAddress: string;

  /**
   * Chain
   */
  chain: string;

  /**
   * Time window start
   */
  from: DateTime;

  /**
   * Time window end
   */
  to: DateTime;

  /**
   * Expected event count (based on interval and window size)
   */
  expectedCount: number;

  /**
   * Actual event count
   */
  actualCount: number;

  /**
   * Completeness percentage (0-100)
   */
  completeness: number;

  /**
   * Missing time ranges (gaps in data)
   */
  gaps: Array<{ from: DateTime; to: DateTime }>;

  /**
   * Anomalies detected
   */
  anomalies: string[];
}

/**
 * Coverage calculator
 */
export class CoverageCalculator {
  /**
   * Calculate coverage for a token in a time window
   */
  calculateTokenCoverage(
    tokenAddress: string,
    chain: string,
    events: CanonicalEvent[],
    from: DateTime,
    to: DateTime,
    expectedIntervalMinutes: number = 5
  ): TokenCoverage {
    // Filter events for this token
    const tokenEvents = events.filter(
      (e) => e.asset === tokenAddress && e.chain === chain
    );

    // Calculate expected count based on interval
    const windowMinutes = to.diff(from, 'minutes').minutes;
    const expectedCount = Math.floor(windowMinutes / expectedIntervalMinutes);

    // Calculate actual count
    const actualCount = tokenEvents.length;

    // Calculate completeness
    const completeness =
      expectedCount > 0 ? (actualCount / expectedCount) * 100 : 0;

    // Detect gaps
    const gaps = this.detectGaps(tokenEvents, from, to, expectedIntervalMinutes);

    // Detect anomalies
    const anomalies = this.detectAnomalies(tokenEvents);

    return {
      tokenAddress,
      chain,
      from,
      to,
      expectedCount,
      actualCount,
      completeness,
      gaps,
      anomalies,
    };
  }

  /**
   * Detect gaps in event timeline
   */
  private detectGaps(
    events: CanonicalEvent[],
    from: DateTime,
    to: DateTime,
    expectedIntervalMinutes: number
  ): Array<{ from: DateTime; to: DateTime }> {
    if (events.length === 0) {
      return [{ from, to }];
    }

    const gaps: Array<{ from: DateTime; to: DateTime }> = [];
    const sortedEvents = [...events].sort(
      (a, b) =>
        DateTime.fromISO(a.timestamp).toMillis() -
        DateTime.fromISO(b.timestamp).toMillis()
    );

    // Check gap at start
    const firstEventTime = DateTime.fromISO(sortedEvents[0].timestamp);
    if (firstEventTime.diff(from, 'minutes').minutes > expectedIntervalMinutes * 2) {
      gaps.push({ from, to: firstEventTime });
    }

    // Check gaps between events
    for (let i = 0; i < sortedEvents.length - 1; i++) {
      const currentTime = DateTime.fromISO(sortedEvents[i].timestamp);
      const nextTime = DateTime.fromISO(sortedEvents[i + 1].timestamp);
      const gapMinutes = nextTime.diff(currentTime, 'minutes').minutes;

      if (gapMinutes > expectedIntervalMinutes * 2) {
        gaps.push({
          from: currentTime,
          to: nextTime,
        });
      }
    }

    // Check gap at end
    const lastEventTime = DateTime.fromISO(
      sortedEvents[sortedEvents.length - 1].timestamp
    );
    if (to.diff(lastEventTime, 'minutes').minutes > expectedIntervalMinutes * 2) {
      gaps.push({ from: lastEventTime, to });
    }

    return gaps;
  }

  /**
   * Detect anomalies in events
   */
  private detectAnomalies(events: CanonicalEvent[]): string[] {
    const anomalies: string[] = [];

    // Check for missing data flags
    const missingCount = events.filter((e) => e.isMissing).length;
    if (missingCount > 0) {
      anomalies.push(`${missingCount} events marked as missing`);
    }

    // Check for duplicate timestamps (potential data quality issue)
    const timestamps = events.map((e) => e.timestamp);
    const uniqueTimestamps = new Set(timestamps);
    if (timestamps.length !== uniqueTimestamps.size) {
      anomalies.push('Duplicate timestamps detected');
    }

    // Check for events with null/undefined values
    const nullValueCount = events.filter(
      (e) => e.value === null || e.value === undefined
    ).length;
    if (nullValueCount > 0) {
      anomalies.push(`${nullValueCount} events with null/undefined values`);
    }

    return anomalies;
  }

  /**
   * Calculate aggregate coverage across multiple tokens
   */
  calculateAggregateCoverage(
    coverages: TokenCoverage[]
  ): {
    averageCompleteness: number;
    totalTokens: number;
    tokensWithFullCoverage: number;
    tokensWithPartialCoverage: number;
    tokensWithNoCoverage: number;
  } {
    if (coverages.length === 0) {
      return {
        averageCompleteness: 0,
        totalTokens: 0,
        tokensWithFullCoverage: 0,
        tokensWithPartialCoverage: 0,
        tokensWithNoCoverage: 0,
      };
    }

    const totalCompleteness = coverages.reduce(
      (sum, c) => sum + c.completeness,
      0
    );
    const averageCompleteness = totalCompleteness / coverages.length;

    const tokensWithFullCoverage = coverages.filter((c) => c.completeness >= 100)
      .length;
    const tokensWithPartialCoverage = coverages.filter(
      (c) => c.completeness > 0 && c.completeness < 100
    ).length;
    const tokensWithNoCoverage = coverages.filter((c) => c.completeness === 0)
      .length;

    return {
      averageCompleteness,
      totalTokens: coverages.length,
      tokensWithFullCoverage,
      tokensWithPartialCoverage,
      tokensWithNoCoverage,
    };
  }
}


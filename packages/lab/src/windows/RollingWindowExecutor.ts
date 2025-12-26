/**
 * RollingWindowExecutor
 *
 * Splits time range into train/test windows and slides forward.
 *
 * Pattern: [T0..T1] → [T1..T2] → [T2..T3]
 *
 * Rules:
 * - Features reused (cache hit)
 * - No leakage (strict time boundaries)
 * - Metrics aggregated per window
 */

import { createHash } from 'crypto';
import type { WindowConfig, TimeWindow, WindowResult } from './types.js';
import { logger } from '@quantbot/utils';

/**
 * RollingWindowExecutor
 */
export class RollingWindowExecutor {
  /**
   * Generate time windows from configuration
   */
  generateWindows(startTs: number, endTs: number, config: WindowConfig): TimeWindow[] {
    const windows: TimeWindow[] = [];
    const step = config.stepSeconds ?? config.testDurationSeconds;

    let currentStart = startTs;
    let windowIndex = 0;

    while (currentStart + config.trainDurationSeconds + config.testDurationSeconds <= endTs) {
      const trainStart = currentStart;
      const trainEnd = trainStart + config.trainDurationSeconds;
      const testStart = trainEnd;
      const testEnd = testStart + config.testDurationSeconds;

      const windowId = this.generateWindowId(windowIndex, trainStart, testEnd);

      windows.push({
        windowId,
        trainStart,
        trainEnd,
        testStart,
        testEnd,
      });

      // Slide forward
      currentStart += step;
      windowIndex++;
    }

    logger.info('Generated rolling windows', {
      totalWindows: windows.length,
      trainDuration: config.trainDurationSeconds,
      testDuration: config.testDurationSeconds,
      step,
    });

    return windows;
  }

  /**
   * Generate deterministic window ID
   */
  private generateWindowId(index: number, trainStart: number, testEnd: number): string {
    const hash = createHash('sha256')
      .update(`${index}:${trainStart}:${testEnd}`)
      .digest('hex')
      .slice(0, 12);
    return `window_${hash}`;
  }

  /**
   * Execute simulation for a window
   *
   * This is a placeholder - actual execution happens in the workflow
   * that calls this executor. This method just validates window boundaries.
   */
  validateWindow(
    window: TimeWindow,
    dataStartTs: number,
    dataEndTs: number
  ): {
    valid: boolean;
    errors: string[];
  } {
    const errors: string[] = [];

    if (window.trainStart < dataStartTs) {
      errors.push(`Train start (${window.trainStart}) is before data start (${dataStartTs})`);
    }

    if (window.testEnd > dataEndTs) {
      errors.push(`Test end (${window.testEnd}) is after data end (${dataEndTs})`);
    }

    if (window.trainStart >= window.trainEnd) {
      errors.push(
        `Train start (${window.trainStart}) must be before train end (${window.trainEnd})`
      );
    }

    if (window.testStart >= window.testEnd) {
      errors.push(`Test start (${window.testStart}) must be before test end (${window.testEnd})`);
    }

    if (window.trainEnd > window.testStart) {
      errors.push(
        `Train end (${window.trainEnd}) must be <= test start (${window.testStart}) - no leakage allowed`
      );
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Aggregate results across windows
   */
  aggregateResults(results: WindowResult[]): {
    totalWindows: number;
    successfulWindows: number;
    failedWindows: number;
    avgTestMetrics?: Record<string, number>;
    metricsVariance?: Record<string, number>;
  } {
    const successful = results.filter((r) => r.success);
    const failed = results.filter((r) => !r.success);

    // Extract numeric metrics from test results
    const testMetrics: Record<string, number[]> = {};
    for (const result of successful) {
      if (result.testMetrics && typeof result.testMetrics === 'object') {
        for (const [key, value] of Object.entries(result.testMetrics)) {
          if (typeof value === 'number') {
            if (!testMetrics[key]) {
              testMetrics[key] = [];
            }
            testMetrics[key]!.push(value);
          }
        }
      }
    }

    // Compute averages and variance
    const avgTestMetrics: Record<string, number> = {};
    const metricsVariance: Record<string, number> = {};

    for (const [key, values] of Object.entries(testMetrics)) {
      if (values.length > 0) {
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        avgTestMetrics[key] = avg;

        if (values.length > 1) {
          const variance = values.reduce((sum, v) => sum + Math.pow(v - avg, 2), 0) / values.length;
          metricsVariance[key] = variance;
        }
      }
    }

    return {
      totalWindows: results.length,
      successfulWindows: successful.length,
      failedWindows: failed.length,
      avgTestMetrics: Object.keys(avgTestMetrics).length > 0 ? avgTestMetrics : undefined,
      metricsVariance: Object.keys(metricsVariance).length > 0 ? metricsVariance : undefined,
    };
  }
}

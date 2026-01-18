/**
 * Performance Monitor
 * ===================
 * Tracks performance metrics for simulation operations.
 */

import { logger } from '@quantbot/infra/utils';

/**
 * Performance metrics
 */
export interface PerformanceMetrics {
  /** Operation name */
  operation: string;
  /** Duration in milliseconds */
  duration: number;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Performance monitor
 */
export class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private readonly enabled: boolean;

  constructor(enabled: boolean = process.env.SIMULATION_PERF_MONITOR === 'true') {
    this.enabled = enabled;
  }

  /**
   * Measure operation duration
   */
  async measure<T>(
    operation: string,
    fn: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    if (!this.enabled) {
      return fn();
    }

    const start = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - start;

      this.metrics.push({
        operation,
        duration,
        metadata: { ...metadata, success: true },
      });

      if (duration > 1000) {
        logger.warn('Slow operation detected', {
          operation,
          duration: Math.round(duration),
          metadata,
        });
      }

      return result;
    } catch (error) {
      const duration = performance.now() - start;

      // Track failed operations too
      this.metrics.push({
        operation,
        duration,
        metadata: { ...metadata, success: false, error: (error as Error).message },
      });

      logger.error('Operation failed', error as Error, {
        operation,
        duration: Math.round(duration),
        metadata,
      });
      throw error;
    }
  }

  /**
   * Get performance summary
   */
  getSummary(): {
    totalOperations: number;
    averageDuration: number;
    slowestOperations: Array<{ operation: string; duration: number }>;
    operationsByType: Record<string, { count: number; avgDuration: number }>;
  } {
    if (this.metrics.length === 0) {
      return {
        totalOperations: 0,
        averageDuration: 0,
        slowestOperations: [],
        operationsByType: {},
      };
    }

    const totalDuration = this.metrics.reduce((sum, m) => sum + m.duration, 0);
    const averageDuration = totalDuration / this.metrics.length;

    // Get slowest operations
    const slowestOperations = [...this.metrics]
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10)
      .map((m) => ({ operation: m.operation, duration: m.duration }));

    // Group by operation type
    const operationsByType: Record<string, { count: number; totalDuration: number }> = {};
    for (const metric of this.metrics) {
      if (!operationsByType[metric.operation]) {
        operationsByType[metric.operation] = { count: 0, totalDuration: 0 };
      }
      operationsByType[metric.operation].count++;
      operationsByType[metric.operation].totalDuration += metric.duration;
    }

    const operationsByTypeSummary: Record<string, { count: number; avgDuration: number }> = {};
    for (const [operation, stats] of Object.entries(operationsByType)) {
      operationsByTypeSummary[operation] = {
        count: stats.count,
        avgDuration: stats.totalDuration / stats.count,
      };
    }

    return {
      totalOperations: this.metrics.length,
      averageDuration,
      slowestOperations,
      operationsByType: operationsByTypeSummary,
    };
  }

  /**
   * Clear metrics
   */
  clear(): void {
    this.metrics = [];
  }

  /**
   * Log summary
   */
  logSummary(): void {
    if (!this.enabled || this.metrics.length === 0) {
      return;
    }

    const summary = this.getSummary();
    logger.info('Performance summary', {
      totalOperations: summary.totalOperations,
      averageDuration: Math.round(summary.averageDuration),
      slowestOperations: summary.slowestOperations.slice(0, 5),
      operationsByType: summary.operationsByType,
    });
  }
}

/**
 * Global performance monitor
 */
let globalMonitor: PerformanceMonitor | null = null;

/**
 * Get or create global performance monitor
 */
export function getPerformanceMonitor(enabled?: boolean): PerformanceMonitor {
  if (!globalMonitor) {
    globalMonitor = new PerformanceMonitor(enabled);
  }
  return globalMonitor;
}

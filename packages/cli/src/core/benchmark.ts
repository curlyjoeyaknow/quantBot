/**
 * Benchmark Utility
 *
 * Provides timing and performance metrics for commands.
 * Can be enabled with --benchmark flag on any command.
 *
 * Usage:
 * ```typescript
 * const benchmark = new Benchmark(enabled);
 * await benchmark.measure('operation-name', async () => {
 *   // operation code
 * });
 * const report = benchmark.getReport();
 * ```
 */

import { performance } from 'node:perf_hooks';

export interface BenchmarkMetric {
  name: string;
  durationMs: number;
  startTime: number;
  endTime: number;
  metadata?: Record<string, unknown>;
}

export interface BenchmarkReport {
  enabled: boolean;
  totalDurationMs: number;
  metrics: BenchmarkMetric[];
  summary: {
    operationCount: number;
    averageDurationMs: number;
    minDurationMs: number;
    maxDurationMs: number;
    operationsByCategory: Record<string, { count: number; totalMs: number; avgMs: number }>;
  };
}

/**
 * Benchmark utility for tracking command performance
 */
export class Benchmark {
  private enabled: boolean;
  private metrics: BenchmarkMetric[] = [];
  private startTime: number;
  private currentOperation: { name: string; startTime: number; metadata?: Record<string, unknown> } | null = null;

  constructor(enabled: boolean = false) {
    this.enabled = enabled;
    this.startTime = performance.now();
  }

  /**
   * Measure an operation's duration
   */
  async measure<T>(
    name: string,
    operation: () => Promise<T>,
    metadata?: Record<string, unknown>
  ): Promise<T> {
    if (!this.enabled) {
      return operation();
    }

    const startTime = performance.now();
    try {
      const result = await operation();
      const endTime = performance.now();
      const durationMs = endTime - startTime;

      this.metrics.push({
        name,
        durationMs,
        startTime,
        endTime,
        metadata,
      });

      return result;
    } catch (error) {
      const endTime = performance.now();
      const durationMs = endTime - startTime;

      this.metrics.push({
        name,
        durationMs,
        startTime,
        endTime,
        metadata: {
          ...metadata,
          error: error instanceof Error ? error.message : String(error),
          failed: true,
        },
      });

      throw error;
    }
  }

  /**
   * Start tracking an operation (for manual timing)
   */
  start(name: string, metadata?: Record<string, unknown>): void {
    if (!this.enabled) return;
    if (this.currentOperation) {
      throw new Error(`Operation "${this.currentOperation.name}" already in progress. Call end() first.`);
    }
    this.currentOperation = {
      name,
      startTime: performance.now(),
      metadata,
    };
  }

  /**
   * End tracking an operation (for manual timing)
   */
  end(name?: string, metadata?: Record<string, unknown>): void {
    if (!this.enabled || !this.currentOperation) return;

    const expectedName = name || this.currentOperation.name;
    if (this.currentOperation.name !== expectedName) {
      throw new Error(
        `Operation name mismatch. Expected "${this.currentOperation.name}", got "${expectedName}"`
      );
    }

    const endTime = performance.now();
    const durationMs = endTime - this.currentOperation.startTime;

    this.metrics.push({
      name: this.currentOperation.name,
      durationMs,
      startTime: this.currentOperation.startTime,
      endTime,
      metadata: {
        ...this.currentOperation.metadata,
        ...metadata,
      },
    });

    this.currentOperation = null;
  }

  /**
   * Add a custom metric (for operations measured outside this utility)
   */
  addMetric(name: string, durationMs: number, metadata?: Record<string, unknown>): void {
    if (!this.enabled) return;
    const now = performance.now();
    this.metrics.push({
      name,
      durationMs,
      startTime: now - durationMs,
      endTime: now,
      metadata,
    });
  }

  /**
   * Get benchmark report
   */
  getReport(): BenchmarkReport {
    const endTime = performance.now();
    const totalDurationMs = endTime - this.startTime;

    if (!this.enabled || this.metrics.length === 0) {
      return {
        enabled: this.enabled,
        totalDurationMs,
        metrics: [],
        summary: {
          operationCount: 0,
          averageDurationMs: 0,
          minDurationMs: 0,
          maxDurationMs: 0,
          operationsByCategory: {},
        },
      };
    }

    const durations = this.metrics.map((m) => m.durationMs);
    const averageDurationMs = durations.reduce((a, b) => a + b, 0) / durations.length;
    const minDurationMs = Math.min(...durations);
    const maxDurationMs = Math.max(...durations);

    // Group operations by category (extract category from name, e.g., "fetch-candles" -> "fetch")
    const operationsByCategory: Record<string, { count: number; totalMs: number; avgMs: number }> = {};
    for (const metric of this.metrics) {
      const category = metric.name.split('-')[0] || 'other';
      if (!operationsByCategory[category]) {
        operationsByCategory[category] = { count: 0, totalMs: 0, avgMs: 0 };
      }
      operationsByCategory[category].count++;
      operationsByCategory[category].totalMs += metric.durationMs;
    }

    // Calculate averages
    for (const category of Object.keys(operationsByCategory)) {
      const cat = operationsByCategory[category];
      cat.avgMs = cat.totalMs / cat.count;
    }

    return {
      enabled: this.enabled,
      totalDurationMs,
      metrics: [...this.metrics],
      summary: {
        operationCount: this.metrics.length,
        averageDurationMs,
        minDurationMs,
        maxDurationMs,
        operationsByCategory,
      },
    };
  }

  /**
   * Format report as human-readable string
   */
  formatReport(): string {
    const report = this.getReport();

    if (!report.enabled || report.metrics.length === 0) {
      return 'Benchmarking disabled or no metrics collected.';
    }

    const lines: string[] = [];
    lines.push('\n📊 Benchmark Report');
    lines.push('═'.repeat(60));
    lines.push(`Total Duration: ${formatDuration(report.totalDurationMs)}`);
    lines.push(`Operations: ${report.summary.operationCount}`);
    lines.push(`Average: ${formatDuration(report.summary.averageDurationMs)}`);
    lines.push(`Min: ${formatDuration(report.summary.minDurationMs)}`);
    lines.push(`Max: ${formatDuration(report.summary.maxDurationMs)}`);
    lines.push('');

    // Group by category
    if (Object.keys(report.summary.operationsByCategory).length > 0) {
      lines.push('By Category:');
      for (const [category, stats] of Object.entries(report.summary.operationsByCategory)) {
        lines.push(
          `  ${category.padEnd(20)} ${stats.count.toString().padStart(4)} ops | ` +
            `Total: ${formatDuration(stats.totalMs).padStart(10)} | ` +
            `Avg: ${formatDuration(stats.avgMs).padStart(10)}`
        );
      }
      lines.push('');
    }

    // Top 10 slowest operations
    const sortedMetrics = [...report.metrics].sort((a, b) => b.durationMs - a.durationMs);
    const topSlow = sortedMetrics.slice(0, 10);

    if (topSlow.length > 0) {
      lines.push('Top 10 Slowest Operations:');
      for (const metric of topSlow) {
        const metadataStr = metric.metadata
          ? ` | ${Object.entries(metric.metadata)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ')}`
          : '';
        lines.push(
          `  ${formatDuration(metric.durationMs).padStart(10)} ${metric.name}${metadataStr}`
        );
      }
      lines.push('');
    }

    // All operations (if not too many)
    if (report.metrics.length <= 50) {
      lines.push('All Operations:');
      for (const metric of report.metrics) {
        const metadataStr = metric.metadata
          ? ` | ${Object.entries(metric.metadata)
              .map(([k, v]) => `${k}=${v}`)
              .join(', ')}`
          : '';
        lines.push(`  ${formatDuration(metric.durationMs).padStart(10)} ${metric.name}${metadataStr}`);
      }
    } else {
      lines.push(`(Skipping detailed list - ${report.metrics.length} operations)`);
    }

    return lines.join('\n');
  }

  /**
   * Reset benchmark (start fresh)
   */
  reset(): void {
    this.metrics = [];
    this.startTime = performance.now();
    this.currentOperation = null;
  }
}

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  } else if (ms < 60000) {
    return `${(ms / 1000).toFixed(2)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = ((ms % 60000) / 1000).toFixed(2);
    return `${minutes}m ${seconds}s`;
  }
}

/**
 * Create benchmark instance from command args
 */
export function createBenchmark(args: { benchmark?: boolean }): Benchmark {
  return new Benchmark(args.benchmark === true);
}


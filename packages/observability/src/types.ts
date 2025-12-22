/**
 * Observability Metrics Types
 * ============================
 * Type definitions for metrics collection and persistence
 */

/**
 * Latency metric for tracking operation duration
 */
export interface LatencyMetric {
  /** Operation name (e.g., 'simulation.e2e', 'birdeye.fetchCandles') */
  operation: string;
  /** Duration in milliseconds */
  durationMs: number;
  /** Component/service name (e.g., 'simulation', 'api-clients') */
  component: string;
  /** Whether the operation succeeded */
  success: boolean;
  /** Optional metadata (JSON stringified) */
  metadata?: Record<string, unknown>;
  /** Timestamp when metric was recorded */
  timestamp: Date;
}

/**
 * Throughput metric for tracking operation counts over time
 */
export interface ThroughputMetric {
  /** Operation name */
  operation: string;
  /** Number of operations in the period */
  count: number;
  /** Period duration in seconds */
  periodSeconds: number;
  /** Component/service name */
  component: string;
  /** Optional metadata */
  metadata?: Record<string, unknown>;
  /** Timestamp when metric was recorded */
  timestamp: Date;
}

/**
 * Base structure for versioned metric points in InfluxDB
 */
export interface VersionedMetricPoint {
  /** Package version from root package.json */
  packageVersion: string;
  /** Node environment (development, production, test) */
  nodeEnv: string;
  /** Component/service name */
  component: string;
}

/**
 * Timer interface for manual instrumentation
 */
export interface MetricTimer {
  /** Stop the timer and record the metric */
  stop(options?: { success?: boolean; metadata?: Record<string, unknown> }): void;
}

/**
 * Query options for retrieving metrics from InfluxDB
 */
export interface MetricQueryOptions {
  /** Operation name to filter by */
  operation?: string;
  /** Package versions to compare */
  versions?: string[];
  /** Time range for query */
  timeRange: {
    start: string; // Flux time string (e.g., '-7d', '2024-01-01T00:00:00Z')
    stop?: string; // Flux time string (default: 'now()')
  };
  /** Component to filter by */
  component?: string;
}

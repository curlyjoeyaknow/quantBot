/**
 * @quantbot/observability - System Observability Package
 * ======================================================
 *
 * Monitors system health, API quotas, database connections, and application performance.
 * Provides E2E observability with DuckDB event logging and Prometheus metrics.
 * Separate from @quantbot/monitoring which handles live token monitoring.
 */

// Health checks
export * from './health.js';

// API quota monitoring
export * from './quotas.js';

// Database health
export * from './database-health.js';

// System metrics
export * from './system-metrics.js';

// Error tracking
export * from './error-tracking.js';

// DuckDB event log (billing-grade API call tracking)
export * from './event-log.js';

// Prometheus metrics (live counters and alerting)
export * from './prometheus-metrics.js';

// Legacy: Metrics collection and InfluxDB persistence (deprecated)
export * from './types.js';
export * from './metrics-collector.js';
export * from './influxdb-metrics-writer.js';

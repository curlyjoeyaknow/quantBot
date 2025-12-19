/**
 * @quantbot/observability - System Observability Package
 * ======================================================
 *
 * Monitors system health, API quotas, database connections, and application performance.
 * Provides E2E observability with DuckDB event logging and Prometheus metrics.
 * Separate from @quantbot/monitoring which handles live token monitoring.
 */

// Health checks
export * from './health';

// API quota monitoring
export * from './quotas';

// Database health
export * from './database-health';

// System metrics
export * from './system-metrics';

// Error tracking
export * from './error-tracking';

// DuckDB event log (billing-grade API call tracking)
export * from './event-log';

// Prometheus metrics (live counters and alerting)
export * from './prometheus-metrics';

// Legacy: Metrics collection and InfluxDB persistence (deprecated)
export * from './types';
export * from './metrics-collector';
export * from './influxdb-metrics-writer';

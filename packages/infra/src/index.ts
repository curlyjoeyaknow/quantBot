/**
 * @quantbot/infra - Infrastructure Layer
 *
 * Consolidated infrastructure package combining:
 * - utils: Shared utilities, logging, config, error handling
 * - storage: Database adapters (ClickHouse, DuckDB, InfluxDB)
 * - observability: Health checks, metrics, tracing
 * - api-clients: External API clients (Birdeye, Helius)
 *
 * Import submodules directly for specific functionality:
 * - @quantbot/infra/utils
 * - @quantbot/infra/storage
 * - @quantbot/infra/observability
 * - @quantbot/infra/api-clients
 *
 * Note: Due to naming collisions between submodules, prefer importing
 * from subpaths directly rather than the main package.
 */

// Re-export submodules as namespaces to avoid naming collisions
export * as utils from './utils/index.js';
export * as storage from './storage/index.js';
export * as observability from './observability/index.js';
export * as apiClients from './api-clients/index.js';

// Common utilities that are frequently needed (no collisions)
export { logger, createLogger, Logger } from './utils/index.js';
export { getClickHouseClient } from './storage/index.js';
export { performHealthCheck, PrometheusMetricsService } from './observability/index.js';
export { getBirdeyeClient, HeliusClient } from './api-clients/index.js';


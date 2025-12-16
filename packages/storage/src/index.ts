/**
 * @quantbot/storage
 *
 * Unified storage engine for QuantBot data.
 *
 * Provides a single interface for storing and retrieving:
 * - OHLCV candles (ClickHouse)
 * - Token calls (Postgres)
 * - Strategies (Postgres)
 * - Indicators (ClickHouse)
 * - Simulation results (Postgres + ClickHouse)
 */

// Export the main storage engine
export { StorageEngine, getStorageEngine } from './engine/StorageEngine';
export type {
  StorageEngineConfig,
  OHLCVQueryOptions,
  IndicatorValue,
  IndicatorQueryOptions,
  SimulationRunMetadata,
} from './engine/StorageEngine';

// Export repositories (for advanced usage)
export { OhlcvRepository } from './clickhouse/repositories/OhlcvRepository';
export { IndicatorsRepository } from './clickhouse/repositories/IndicatorsRepository';
export { TokenMetadataRepository } from './clickhouse/repositories/TokenMetadataRepository';
export { SimulationEventsRepository } from './clickhouse/repositories/SimulationEventsRepository';
export { TokensRepository } from './postgres/repositories/TokensRepository';
export { TokenDataRepository } from './postgres/repositories/TokenDataRepository';
export type {
  TokenDataInsertData,
  TokenDataRecord,
} from './postgres/repositories/TokenDataRepository';
export { CallsRepository } from './postgres/repositories/CallsRepository';
export { StrategiesRepository } from './postgres/repositories/StrategiesRepository';
export { AlertsRepository } from './postgres/repositories/AlertsRepository';
export { CallersRepository } from './postgres/repositories/CallersRepository';
export { SimulationResultsRepository } from './postgres/repositories/SimulationResultsRepository';
export { SimulationRunsRepository } from './postgres/repositories/SimulationRunsRepository';
export { ApiQuotaRepository } from './postgres/repositories/ApiQuotaRepository';
export type { ApiQuotaUsage } from './postgres/repositories/ApiQuotaRepository';
export { ErrorRepository } from './postgres/repositories/ErrorRepository';
export type { ErrorStats } from './postgres/repositories/ErrorRepository';

// Export clients
export { getClickHouseClient, initClickHouse, closeClickHouse } from './clickhouse-client';
export { insertCandles, queryCandles, insertTicks, hasCandles } from './clickhouse-client';
export type { TickEvent } from './clickhouse-client';
export {
  getPostgresPool,
  getPostgresClient,
  queryPostgres,
  withPostgresTransaction,
  closePostgresPool,
} from './postgres/postgres-client';

// Export cache utilities
export {
  OHLCVCache,
  ohlcvCache,
  type OhlcvCacheCandle,
  type CacheEntry,
  type CacheStats,
} from './cache/ohlcv-cache';

// Legacy exports (temporary - will be deprecated)
// Note: CallerDatabase export removed to avoid sqlite3 dependency
// Import directly from './caller-database' if needed
export {
  InfluxDBOHLCVClient,
  influxDBClient,
  type OHLCVData,
  type TokenInfo,
} from './influxdb-client';

/**
 * @quantbot/storage
 *
 * Unified storage engine for QuantBot data.
 *
 * Provides a single interface for storing and retrieving:
 * - OHLCV candles (ClickHouse)
 * - Token calls (DuckDB)
 * - Strategies (DuckDB)
 * - Indicators (ClickHouse)
 * - Simulation results (ClickHouse)
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

// PostgreSQL repositories removed - use DuckDB repositories instead

// DuckDB client and repositories (new - preferred)
export { DuckDBClient, getDuckDBClient } from './duckdb/duckdb-client';
export { TokenDataRepository } from './duckdb/repositories/TokenDataRepository';
export type { OHLCVCoverageRecord } from './duckdb/repositories/TokenDataRepository';
export { CallersRepository } from './duckdb/repositories/CallersRepository';
export { StrategiesRepository } from './duckdb/repositories/StrategiesRepository';

// Export clients
export { getClickHouseClient, initClickHouse, closeClickHouse } from './clickhouse-client';
export { insertCandles, queryCandles, insertTicks, hasCandles } from './clickhouse-client';
export type { TickEvent } from './clickhouse-client';

// PostgreSQL client removed - use DuckDB instead

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

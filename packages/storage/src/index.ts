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
export { CallsRepository } from './postgres/repositories/CallsRepository';
export { StrategiesRepository } from './postgres/repositories/StrategiesRepository';
export { AlertsRepository } from './postgres/repositories/AlertsRepository';
export { CallersRepository } from './postgres/repositories/CallersRepository';
export { SimulationResultsRepository } from './postgres/repositories/SimulationResultsRepository';

// Export clients
export { getClickHouseClient, initClickHouse, closeClickHouse } from './clickhouse-client';
export { getPostgresPool, getPostgresClient, queryPostgres, withPostgresTransaction, closePostgresPool } from './postgres/postgres-client';


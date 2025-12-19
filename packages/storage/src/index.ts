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
                              
                              // PostgreSQL repositories (DEPRECATED - use DuckDB repositories instead)
                              /**
                               * @deprecated PostgreSQL is being phased out. Use DuckDB repositories instead.
                               * These exports will be removed in a future version.
                               */
                              export { TokensRepository } from './postgres/repositories/TokensRepository';
                              export { TokenDataRepository as PostgresTokenDataRepository } from './postgres/repositories/TokenDataRepository';
                              export type {
                                TokenDataInsertData,
                                TokenDataRecord,
                              } from './postgres/repositories/TokenDataRepository';
                              export { CallsRepository } from './postgres/repositories/CallsRepository';
                              export { StrategiesRepository as PostgresStrategiesRepository } from './postgres/repositories/StrategiesRepository';
                              export { AlertsRepository } from './postgres/repositories/AlertsRepository';
                              export { CallersRepository as PostgresCallersRepository } from './postgres/repositories/CallersRepository';
                              export { SimulationResultsRepository } from './postgres/repositories/SimulationResultsRepository';
                              export { SimulationRunsRepository } from './postgres/repositories/SimulationRunsRepository';
                              /**
                               * @deprecated ApiQuotaRepository is replaced by DuckDB event log (@quantbot/observability/event-log)
                               * and Prometheus metrics (@quantbot/observability/prometheus-metrics)
                               */
                              export { ApiQuotaRepository } from './postgres/repositories/ApiQuotaRepository';
                              export type { ApiQuotaUsage } from './postgres/repositories/ApiQuotaRepository';
                              export { ErrorRepository } from './postgres/repositories/ErrorRepository';
                              export type { ErrorStats } from './postgres/repositories/ErrorRepository';
                              
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
                              
                              // PostgreSQL client (DEPRECATED - use DuckDB instead)
                              /**
                               * @deprecated PostgreSQL is being phased out. Use DuckDB client instead.
                               * These exports will be removed in a future version.
                               */
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

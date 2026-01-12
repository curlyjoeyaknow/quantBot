/**
 * @quantbot/storage - DEPRECATED: Use @quantbot/infra/storage instead
 *
 * This package is being consolidated into @quantbot/infra.
 * All exports are re-exported from @quantbot/infra/storage for backwards compatibility.
 *
 * @deprecated Import from '@quantbot/infra/storage' instead
 */

export * from '@quantbot/infra/storage';

// Export the main storage engine
export { StorageEngine, getStorageEngine } from './engine/StorageEngine.js';
export type {
  StorageEngineConfig,
  OHLCVQueryOptions,
  IndicatorValue,
  IndicatorQueryOptions,
  SimulationRunMetadata,
} from './engine/StorageEngine.js';

// Export repositories (for advanced usage)
export { OhlcvRepository } from './clickhouse/repositories/OhlcvRepository.js';
export type { UpsertResult } from './clickhouse/repositories/OhlcvRepository.js';
export { IndicatorsRepository } from './clickhouse/repositories/IndicatorsRepository.js';
export { TokenMetadataRepository } from './clickhouse/repositories/TokenMetadataRepository.js';
export { SimulationEventsRepository } from './clickhouse/repositories/SimulationEventsRepository.js';
export { LeaderboardRepository } from './clickhouse/repositories/LeaderboardRepository.js';
export type { LeaderboardEntry } from './clickhouse/repositories/LeaderboardRepository.js';
export { RunLogRepository } from './clickhouse/repositories/RunLogRepository.js';
export type { RunLog, RunLogInsertData } from './clickhouse/repositories/RunLogRepository.js';
export { RunRepository } from './clickhouse/repositories/RunRepository.js';
export type { RunRepository as IRunRepository } from './ports/RunRepositoryPort.js';
export { IngestionRunRepository } from './clickhouse/repositories/IngestionRunRepository.js';
export type { IngestionRun, RunStats } from './clickhouse/repositories/IngestionRunRepository.js';

// PostgreSQL repositories removed - use DuckDB repositories instead

// DuckDB client and repositories (new - preferred)
export { DuckDBClient, getDuckDBClient } from './duckdb/duckdb-client.js';
export { connectionManager, ensureConnectionCleanup } from './duckdb/connection-utils.js';
export type { ConnectionCleanupOptions } from './duckdb/connection-utils.js';
export { TokenDataRepository } from './duckdb/repositories/TokenDataRepository.js';
export { RunStatusRepository } from './duckdb/repositories/RunStatusRepository.js';
export type { RunStatus, RunStatusInsertData } from './duckdb/repositories/RunStatusRepository.js';
export { ArtifactRepository } from './duckdb/repositories/ArtifactRepository.js';
export type { Artifact } from './duckdb/repositories/ArtifactRepository.js';
export {
  DuckDBWorklistService,
  getDuckDBWorklistService,
} from './duckdb/duckdb-worklist-service.js';
export type { OhlcvWorklistConfig, OhlcvWorklistResult } from './duckdb/duckdb-worklist-service.js';

// Artifact repository adapter
export { ArtifactDuckDBAdapter } from './adapters/artifact-duckdb-adapter.js';
export { ExperimentDuckDBAdapter } from './adapters/experiment-duckdb-adapter.js';

// Slice export and analysis adapters
export {
  ClickHouseSliceExporterAdapterImpl,
  createClickHouseSliceExporterAdapterImpl,
} from './adapters/clickhouse-slice-exporter-adapter-impl.js';
export { datasetRegistry, initializeDefaultDatasets } from './adapters/dataset-registry.js';
export type { DatasetType, DatasetMetadata } from './adapters/dataset-registry.js';
export {
  insertSqlForParquet,
  type InsertMode,
  type InsertParquetOptions,
} from './adapters/clickhouse-slice-importer.js';
export { createClickHouseSliceExporterAdapter } from './adapters/clickhouse-slice-exporter-adapter.js';
export {
  DuckDbSliceAnalyzerAdapter,
  createDuckDbSliceAnalyzerAdapter,
} from './adapters/duckdb-slice-analyzer-adapter.js';
export {
  DuckDbSliceAnalyzerAdapterImpl,
  createDuckDbSliceAnalyzerAdapterImpl,
} from './adapters/duckdb-slice-analyzer-adapter-impl.js';
export {
  SliceValidatorAdapter,
  createSliceValidatorAdapter,
} from './adapters/slice-validator-adapter.js';

// Lab workflow adapters (for composition roots/wiring)
export { CandleSliceExporter } from './adapters/clickhouse/CandleSliceExporter.js';
export { FeatureComputer } from './adapters/duckdb/FeatureComputer.js';
export { SimulationExecutor } from './adapters/duckdb/SimulationExecutor.js';
export { DuckDbCatalogAdapter } from './adapters/duckdb/DuckDbCatalogAdapter.js';
export { openDuckDb, runSqlFile } from './adapters/duckdb/duckdbClient.js';
export type { DuckDbConnection } from './adapters/duckdb/duckdbClient.js';

// Export port types for convenience (also available via /ports/* subpath exports)
export type {
  CandleSlicePort,
  CandleSliceSpec,
  SliceExportResult,
  RunContext,
} from './ports/CandleSlicePort.js';
export type {
  FeatureComputePort,
  FeatureSpecV1,
  FeatureComputeResult,
} from './ports/FeatureComputePort.js';
export type {
  SimulationPort,
  StrategySpecV1,
  RiskSpecV1,
  SimulationResult,
} from './ports/SimulationPort.js';
export type {
  CatalogPort,
  TokenSetRecord,
  SliceRecord,
  FeatureSetRecord,
  FeaturesRecord,
  SimRunRecord,
} from './ports/CatalogPort.js';
export type { OHLCVCoverageRecord } from './duckdb/repositories/TokenDataRepository.js';
export { CallersRepository } from './duckdb/repositories/CallersRepository.js';
export { StrategiesRepository } from './duckdb/repositories/StrategiesRepository.js';
export { ErrorRepository } from './duckdb/repositories/ErrorRepository.js';
export type {
  ErrorEvent,
  ErrorInsertData,
  ErrorStats,
  ErrorQueryOptions,
} from './duckdb/repositories/ErrorRepository.js';

// Export clients
export { getClickHouseClient, initClickHouse, closeClickHouse } from './clickhouse-client.js';
export { insertCandles, queryCandles, insertTicks, hasCandles } from './clickhouse-client.js';
export type { TickEvent } from './clickhouse-client.js';

// PostgreSQL client removed - use DuckDB instead

// Export cache utilities
export {
  OHLCVCache,
  ohlcvCache,
  type OhlcvCacheCandle,
  type CacheEntry,
  type CacheStats,
} from './cache/ohlcv-cache.js';

// Export OHLCV deduplication and quality scoring
export { OhlcvDedupService } from './clickhouse/services/OhlcvDedupService.js';
export type { DedupResult, RollbackResult, FaultyRunReport } from './clickhouse/services/OhlcvDedupService.js';
export {
  SourceTier,
  computeQualityScore,
  computeQualityScoreWithBreakdown,
  type IngestionRunManifest,
  type QualityScoreBreakdown,
} from './clickhouse/types/quality-score.js';
export {
  ValidationSeverity,
  validateCandle,
  validateCandleBatch,
  STRICT_VALIDATION,
  LENIENT_VALIDATION,
  DEFAULT_HALT_POLICY,
  type ValidationIssue,
  type CandleValidationResult,
  type QualityValidationOptions,
  type TokenFlag,
  type RunHaltPolicy,
} from './clickhouse/validation/candle-validator.js';
export { getGitInfo, getGitInfoSync, type GitInfo } from './utils/git-info.js';
export { getVersionInfo, type VersionInfo } from './utils/version-info.js';

// Legacy exports (temporary - will be deprecated)
// Note: SQLite CallerDatabase removed - use DuckDB CallersRepository instead
// Import directly from './caller-database.js' if needed

// InfluxDB exports - types only (implementation not in use)
// Exporting types for backward compatibility, but InfluxDBOHLCVClient is not used
export type { OHLCVData, TokenInfo } from './influxdb-client.js';
// Export stub for influxDBClient (not actually used, but needed for type compatibility)
export { influxDBClient } from './influxdb-client.js';

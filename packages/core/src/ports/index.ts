/**
 * Ports Barrel Export
 *
 * All port interfaces are exported from here.
 * This is the public API for ports - handlers depend on these interfaces.
 */

export type { ClockPort } from './clockPort.js';
export { createSystemClock } from './clockPort.js';
export type {
  OhlcvIngestionPort,
  IngestOhlcvSpec,
  IngestOhlcvResult,
} from './ohlcvIngestionPort.js';
export type {
  MarketDataPort,
  MarketDataOhlcvRequest,
  MarketDataMetadataRequest,
  TokenMetadata,
  HistoricalPriceRequest,
  HistoricalPriceResponse,
} from './marketDataPort.js';
export type { ExecutionPort, ExecutionRequest, ExecutionResult } from './executionPort.js';
export type {
  StatePort,
  StateGetRequest,
  StateSetRequest,
  StateDeleteRequest,
  StateGetResult,
  StateQueryRequest,
  StateQueryResult,
  StateTransaction,
  StateTransactionResult,
} from './statePort.js';
export type {
  TelemetryPort,
  MetricEmission,
  EventEmission,
  SpanEmission,
  MetricType,
} from './telemetryPort.js';
export type { QueryPort, QueryRequest, QueryResult } from './queryPort.js';
export type { ArtifactRepository, ArtifactQueryFilter } from './artifact-repository-port.js';
export type {
  RawDataRepository,
  RawDataQueryFilter,
  RawDataRecord,
  RawDataSourceType,
} from './raw-data-repository-port.js';
export type {
  ExperimentRepository,
  ExperimentMetadata,
  ExperimentQueryFilter,
  ExperimentQueryResult,
} from './experiment-repository-port.js';
export type {
  SliceExporterPort,
  SliceExportSpec,
  SliceManifest,
  SliceExportResult,
  ParquetFileMetadata,
} from './slice-exporter-port.js';
export type {
  SliceAnalyzerPort,
  AnalysisQueryPlan,
  AnalysisResult,
  AnalysisResultMetadata,
} from './slice-analyzer-port.js';
export type { RunEventPort, RunEventQuery, RunEventQueryResult } from './run-event-port.js';

export type {
  WorkflowContext,
  SimulationRunSpec,
  SimulationRunResult,
  SimulationCallResult,
  StrategyRecord,
  CallRecord,
  Candle,
  SimulationEngineResult,
} from './types.js';

export { runSimulation } from './simulation/runSimulation.js';
export { createProductionContext } from './context/createProductionContext.js';
export type { ProductionContextConfig } from './context/createProductionContext.js';
export { ingestTelegramJson } from './telegram/ingestTelegramJson.js';
export type {
  TelegramJsonIngestSpec,
  TelegramJsonIngestResult,
  TelegramJsonIngestContext,
} from './telegram/ingestTelegramJson.js';
export { ingestOhlcv } from './ohlcv/ingestOhlcv.js';
export type {
  IngestOhlcvSpec,
  IngestOhlcvResult,
  IngestOhlcvContext,
} from './ohlcv/ingestOhlcv.js';
export { createOhlcvIngestionContext } from './context/createOhlcvIngestionContext.js';
export { runSimulationDuckdb } from './simulation/runSimulationDuckdb.js';
export type {
  RunSimulationDuckdbSpec,
  RunSimulationDuckdbResult,
  RunSimulationDuckdbContext,
  SkippedToken,
} from './simulation/runSimulationDuckdb.js';
export { createDuckdbSimulationContext } from './context/createDuckdbSimulationContext.js';
export type { DuckdbSimulationContextConfig } from './context/createDuckdbSimulationContext.js';
export { queryCallsDuckdb, createQueryCallsDuckdbContext } from './calls/queryCallsDuckdb.js';
export type {
  QueryCallsDuckdbSpec,
  QueryCallsDuckdbResult,
  QueryCallsDuckdbContext,
} from './calls/queryCallsDuckdb.js';
export { getStorageStats } from './storage/getStorageStats.js';
export type {
  GetStorageStatsSpec,
  GetStorageStatsResult,
  StorageStatsContext,
} from './storage/getStorageStats.js';
export { getOhlcvStats } from './storage/getOhlcvStats.js';
export type {
  GetOhlcvStatsSpec,
  GetOhlcvStatsResult,
  OhlcvStatsContext,
} from './storage/getOhlcvStats.js';
export {
  createStorageStatsContext,
  createOhlcvStatsContext,
} from './context/createStorageStatsContext.js';
export type { StorageStatsContextConfig } from './context/createStorageStatsContext.js';
export { getTokenStats } from './storage/getTokenStats.js';
export type {
  GetTokenStatsSpec,
  GetTokenStatsResult,
  TokenStatsContext,
} from './storage/getTokenStats.js';
export { createTokenStatsContext } from './context/createTokenStatsContext.js';
export type { TokenStatsContextConfig } from './context/createTokenStatsContext.js';
export { resolveEvmChains } from './metadata/resolveEvmChains.js';
export type {
  ResolveEvmChainsSpec,
  ResolveEvmChainsResult,
  ResolveEvmChainsContext,
  TokenResolutionResult,
} from './metadata/resolveEvmChains.js';
export { surgicalOhlcvFetch } from './ohlcv/surgicalOhlcvFetch.js';
export type {
  SurgicalOhlcvFetchSpec,
  SurgicalOhlcvFetchResult,
  SurgicalOhlcvFetchContext,
  FetchTask,
  CoverageData,
  ProgressCallback,
} from './ohlcv/surgicalOhlcvFetch.js';
export { analyzeCoverage } from './ohlcv/analyzeCoverage.js';
export { analyzeDetailedCoverage } from './ohlcv/analyzeDetailedCoverage.js';
export type {
  AnalyzeDetailedCoverageSpec,
  AnalyzeDetailedCoverageResult,
  AnalyzeDetailedCoverageContext,
  DetailedCoverageRecord,
  DetailedCoverageSummary,
  IntervalCoverageResult,
} from './ohlcv/analyzeDetailedCoverage.js';
export type {
  AnalyzeCoverageSpec,
  AnalyzeCoverageResult,
  AnalyzeCoverageContext,
  OverallCoverageResult,
  CallerCoverageResult,
} from './ohlcv/analyzeCoverage.js';
export { createOhlcvIngestionWorkflowAdapter } from './adapters/ohlcvIngestionWorkflowAdapter.js';
export * from './context/ports.js';
export * from './context/workflowContextWithPorts.js';
export { createProductionPorts } from './context/createProductionPorts.js';
export { createQueryClickhouseAdapter } from './adapters/queryClickhouseAdapter.js';
export { createProductionContextWithPorts } from './context/createProductionContext.js';
export { createTelemetryConsoleAdapter } from './adapters/telemetryConsoleAdapter.js';
export { createMarketDataBirdeyeAdapter } from './adapters/marketDataBirdeyeAdapter.js';
export { createMarketDataStorageAdapter } from './adapters/marketDataStorageAdapter.js';
export { createStateDuckdbAdapter } from './adapters/stateDuckdbAdapter.js';
export { createExecutionStubAdapter } from './adapters/executionStubAdapter.js';
export { ingestOhlcvWorkflowPorted } from './ohlcv/ingestOhlcvPorted.js';
export type {
  IngestOhlcvWorkflowInput,
  IngestOhlcvWorkflowOutput,
} from './ohlcv/ingestOhlcvPorted.js';
export { evaluateCallsWorkflow } from './calls/evaluate.js';
export type {
  EvaluateCallsRequest,
  EvaluateCallsOutput,
  CallerSummary,
  WorkflowContextWithPorts,
} from './calls/evaluate.js';
export type { CallBacktestResult, BacktestParams } from './calls/backtest.js';

// Research OS - Experiment Engine
export * from './research/index.js';
export { createExperimentContext } from './research/context.js';
export type { ExperimentContextConfig } from './research/context.js';

// Slice Export and Analysis
// Types moved to @quantbot/core - re-export for backward compatibility
export * from './slices/types.js';
export * from './slices/ports.js';
export { exportAndAnalyzeSlice } from './slices/exportAndAnalyzeSlice.js';
export { exportSlicesForAlerts } from './slices/exportSlicesForAlerts.js';
export type { ExportSlicesForAlertsSpec } from './slices/exportSlicesForAlerts.js';
// Ports are also in core, but we keep local definitions for now
export type { SliceExporter, SliceAnalyzer, SliceValidator } from './slices/ports.js';

// Lab Simulation Presets
export type { SimPresetV1, LabPorts, RunContext } from './lab/types.js';
export { runLabPreset } from './lab/runLabPreset.js';

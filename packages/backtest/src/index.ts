/**
 * @quantbot/backtest - Minimum Viable Backtester
 *
 * Golden path implementation with deterministic execution.
 *
 * Architecture (Guardrails):
 * 1. Truth Layer: path metrics for every eligible call (backtest_call_path_metrics)
 * 2. Policy Layer: trade outcomes when policies execute (backtest_policy_results)
 * 3. Path-only mode: compute truth without trades (--strategy path-only)
 */

export * from './types.js';
export * from './plan.js';
export * from './coverage.js';
export * from './slice.js';
export * from './engine/index.js';
export * from './report.js';
export * from './runBacktest.js';

// Path-only mode (Guardrail 2)
export { runPathOnly } from './runPathOnly.js';

// Reporting
export * from './reporting/caller-path-report.js';
export * from './reporting/run-list.js';
export * from './reporting/caller-leaderboard.js';
export * from './reporting/list-runs.js';

// Schema and insert functions (Phase 1 - split truth from policy)
export {
  ensureBacktestSchema,
  insertCallResults,
  ensurePathMetricsSchema,
  insertPathMetrics,
  getPathMetricsByRun,
  ensurePolicyResultsSchema,
  insertPolicyResults,
  getPolicyResultsByRun,
  type CallResultRow,
} from './reporting/backtest-results-duckdb.js';

export {
  getCentralDuckDbPath,
  upsertRunMetadata,
} from './reporting/central-duckdb-persistence.js';

// Path metrics query service (Phase 2-3)
export {
  getPathMetricsByCaller,
  getPathMetricsByCall,
  aggregatePathMetricsByCaller,
  getRunSummary,
} from './reporting/path-metrics-query.js';

// Caller truth leaderboard (Phase 3 - MVP 1)
export {
  getCallerTruthLeaderboard,
  getCallerTruthLeaderboardAllRuns,
  getTruthRunSummary,
  formatLeaderboardForDisplay,
} from './reporting/caller-truth-leaderboard.js';

// Risk policy system (Phase 4 - MVP 2)
export type {
  RiskPolicy,
  FixedStopPolicy,
  TimeStopPolicy,
  TrailingStopPolicy,
  LadderPolicy,
  ComboPolicy,
  PolicyExecutionResult,
} from './policies/risk-policy.js';

export {
  parseRiskPolicy,
  riskPolicySchema,
  DEFAULT_FIXED_STOP,
  DEFAULT_TIME_STOP,
  DEFAULT_TRAILING_STOP,
  DEFAULT_LADDER,
  POLICY_GRID,
} from './policies/risk-policy.js';

export { executePolicy } from './policies/policy-executor.js';

// Policy backtest workflow (Phase 4 - MVP 2)
export {
  runPolicyBacktest,
  type PolicyBacktestRequest,
  type PolicyBacktestSummary,
} from './runPolicyBacktest.js';

// Policy optimization (Phase 5 - MVP 3)
export {
  scorePolicy,
  comparePolicyScores,
  DEFAULT_CONSTRAINTS,
  type OptimizationConstraints,
  type PolicyScore,
} from './optimization/scoring.js';

export {
  optimizePolicy,
  optimizePolicyPerCaller,
  policyToId,
  type OptimizeRequest,
  type OptimalPolicy,
  type OptimizationResult,
} from './optimization/policy-optimizer.js';

// V1 Baseline Optimizer (capital-aware)
export {
  optimizeV1Baseline,
  optimizeV1BaselinePerCaller,
  runV1BaselineGroupedEvaluation,
  type V1BaselineOptimizationResult,
  type V1BaselineOptimizeRequest,
  type V1BaselinePerCallerResult,
} from './optimization/v1-baseline-optimizer.js';
export {
  simulateCapitalAware,
  type V1BaselineParams,
  type CapitalSimulationResult,
  type CapitalSimulatorConfig,
  type Position,
  type TradeExecution,
  type CapitalState,
} from './optimization/capital-simulator.js';

export {
  generateCallerFollowPlan,
  generateCallerFollowPlanReport,
  formatFollowPlanForDisplay,
  formatReportForDisplay,
  type CallerFollowPlan,
  type CallerFollowPlanReport,
} from './optimization/caller-follow-plan.js';

// Exit plan system
// Note: exit-plan.js exports ExitPlan type, which conflicts with exit-plan-validate.js
// Export only specific items to avoid conflicts
export type {
  ExitPlan,
  ExitFill,
  ExitSimParams,
  ExitSimResult,
  LadderLevel,
  TrailingStopSpec,
  IndicatorRule,
  IndicatorExitSpec,
  LadderExitSpec,
  IntrabarPolicy,
} from './exits/exit-plan.js';
export { candleTsMs } from './exits/exit-plan.js';
export * from './exits/simulate-exit-plan.js';
export * from './exits/indicator-eval.js';
export * from './exits/fills-to-trade.js';
export * from './exits/default-exit-plans.js';

// Indicator utilities
export * from './indicators/series.js';

// Path metrics (enhanced with ATH/ATL analysis)
export {
  computePathMetrics,
  computeEnhancedPathMetrics,
  type PathMetrics,
  type PathMetricOptions,
  type EnhancedPathMetrics,
  // Re-exported from simulation
  calculatePeriodAthAtlFromCandles,
  type PeriodAthAtlResult,
  type ReEntryOpportunity,
} from './metrics/path-metrics.js';

// Performance monitoring and caching (from simulation)
export * from './performance/index.js';

// Time/clock utilities (from simulation)
export * from './time/index.js';

// Execution models (from simulation, for realistic execution)
export {
  type ExecutionModel,
  type LatencyDistribution,
  type SlippageModel,
  type CostModel,
  type FailureModel,
  createPumpfunExecutionModel,
  createPumpswapExecutionModel,
  createMinimalExecutionModel,
  calculateSlippage,
  sampleLatency,
  type FeeConfig,
  type ExecutionConfig,
} from './policies/policy-executor.js';

// Execution config factory (for CLI integration)
export {
  createExecutionConfig,
  getVenueDescription,
  type ExecutionModelVenue,
} from './execution/index.js';

// Exit-stack strategy system
// Note: exit-plan-validate.js exports ExitPlanZ (Zod schema), not ExitPlan type
export { ExitPlanZ, parseExitPlan } from './strategy/exit-plan-validate.js';
export * from './strategy/duckdb-strategy-store.js';
export * from './strategy/resolve-exit-plan.js';
// Note: backtest-exit-stack exports BacktestEvent and Trade which conflict with types.js
// Export only the function, not the types
export { backtestExitStack } from './engine/backtest-exit-stack.js';
// Note: run-exit-stack exports CallRecord which conflicts with types.js
export { runExitStack, type ExitStackRunArgs } from './run/run-exit-stack.js';

// =============================================================================
// Simulation Engine - Exports from local sim/ directory
// =============================================================================
// All simulation functionality is now consolidated in @quantbot/backtest

// Core simulation function
export { simulateStrategy, simulateStrategyWithCausalAccessor } from './sim/core/simulator.js';

// Overlay simulation (recommended API)
export {
  runOverlaySimulation,
  type OverlaySimulationRequest,
  type OverlaySimulationResult,
  type TradePoint,
  type PnlBreakdown,
  type SimulationDiagnostics,
} from './sim/overlay-simulation.js';

// Strategy building
export { buildStrategy, buildStopLossConfig } from './sim/strategies/builder.js';
export { getPreset, listPresets, registerPreset } from './sim/strategies/presets.js';

// Common types
export type {
  SimulationResult,
  SimulationEvent,
  StrategyConfig,
  StrategyLeg,
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  CostConfig,
  SignalGroup as SimSignalGroup,
  SignalCondition as SimSignalCondition,
  LadderConfig,
  LadderLeg,
} from './sim/types/index.js';

// Indicator calculation
export {
  calculateIchimoku,
  detectIchimokuSignals,
  formatIchimokuData,
  type IchimokuData,
  type IchimokuSignal,
} from './sim/ichimoku.js';

// Signal evaluation and presets
export {
  evaluateSignalGroup,
  evaluateLadderLegs,
  getSignalPreset,
  listSignalPresets,
  getSignalPresetsByCategory,
  registerSignalPreset,
  combineSignalPresets,
  getPerformanceMonitor,
  PerformanceMonitor,
  parseSimulationConfig,
  type PerformanceMetrics,
  type SimulationEngineConfig,
  type SimulationScenarioConfig,
  type PeriodMetricsConfig,
} from './sim/index.js';

// Contract types for dual-run harness and simulation invariants
export { simulateFromInput } from './sim/core/contract-adapter.js';
export {
  type SimInput,
  type SimResult,
  type SimEvent,
  type SimMetrics,
  SimInputSchema,
  SimResultSchema,
} from './sim/types/contracts.js';

// =============================================================================
// Simulation Services - Exports from local sim/ directory
// =============================================================================
// Direct exports to avoid Vitest SSR module resolution issues with re-exports
export { DuckDBStorageService } from './sim/duckdb-storage-service.js';
export { ClickHouseService } from './sim/clickhouse-service.js';
export { SimulationService } from './sim/simulation-service.js';
export { BacktestBaselineService } from './sim/backtest-baseline-service.js';
export type { SimulationConfig, SimulationOutput } from './sim/simulation-service.js';

// =============================================================================
// V1 Baseline Python Service (TypeScript orchestration for Python optimizer)
// =============================================================================
export {
  V1BaselinePythonService,
  type V1BaselineParams as V1BaselineParamsPython,
  type CapitalSimulatorConfig as CapitalSimulatorConfigPython,
  type TradeExecution as TradeExecutionPython,
  type CapitalSimulationResult as CapitalSimulationResultPython,
  type V1BaselineOptimizationResult as V1BaselineOptimizationResultPython,
  type V1BaselinePerCallerResult as V1BaselinePerCallerResultPython,
  type V1BaselineGroupedResult,
  V1BaselineParamsSchema,
  CapitalSimulatorConfigSchema,
  TradeExecutionSchema,
  CapitalSimulationResultSchema,
  V1BaselineOptimizationResultSchema,
  V1BaselinePerCallerResultSchema,
  V1BaselineGroupedResultSchema,
} from './services/v1-baseline-python-service.js';
export { PythonSimulationService } from './services/python-simulation-service.js';

// Causal candle accessor
export type { CausalCandleAccessor } from './sim/types/causal-accessor.js';
export {
  CausalCandleWrapper,
  filterCandlesByCloseTimeInterval,
  getLastClosedCandleInterval,
} from './sim/types/causal-accessor.js';

// CandleInterval type (from candle types)
export type { CandleInterval } from './sim/types/candle.js';

// Execution utilities
export { calculateTradeFee } from './sim/execution/fees.js';

// Legacy types
export type { LegacySimulationEvent } from './sim/types/events.js';

// =============================================================================
// Structured Artifacts System
// =============================================================================
export * from './artifacts/index.js';

// Frontier writer for optimization results
export {
  writePolicyFrontier,
  writeV1BaselineFrontier,
  writeV1BaselinePerCallerFrontiers,
} from './optimization/frontier-writer.js';

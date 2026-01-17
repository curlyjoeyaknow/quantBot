/**
 * @quantbot/simulation/backtest - Backtest-specific functionality
 *
 * This module contains backtest-specific code that was previously in @quantbot/backtest.
 * All backtest functionality is now available via @quantbot/simulation/backtest.
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
  openCentralDuckDb,
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
  // Re-exported from simulation analytics
  calculatePeriodAthAtlFromCandles,
  type PeriodAthAtlResult,
  type ReEntryOpportunity,
} from './metrics/path-metrics.js';

// Performance monitoring and caching (from simulation)
export * from '../performance/index.js';

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
} from './execution/index.js';

// Execution config factory (for CLI integration)
export {
  createExecutionConfig as createBacktestExecutionConfig,
  getVenueDescription,
  type ExecutionModelVenue,
} from './execution/index.js';

// Exit-stack strategy system
export { ExitPlanZ, parseExitPlan } from './strategy/exit-plan-validate.js';
export * from './strategy/duckdb-strategy-store.js';
export * from './strategy/resolve-exit-plan.js';
export { backtestExitStack } from './engine/backtest-exit-stack.js';
export { runExitStack, type ExitStackRunArgs } from './run/run-exit-stack.js';

// V1 Baseline Python Service (TypeScript orchestration for Python optimizer)
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

// Frontier writer for optimization results
export {
  writePolicyFrontier,
  writeV1BaselineFrontier,
  writeV1BaselinePerCallerFrontiers,
} from './optimization/frontier-writer.js';


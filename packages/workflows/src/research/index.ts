/**
 * Research OS - Experiment Engine
 * ===============================
 *
 * This module provides the Research OS experiment engine:
 * - Simulation contract (immutable API)
 * - Run artifacts (immutable outputs)
 * - Experiment runner (orchestration)
 * - Metrics calculator
 * - Artifact storage
 */

// Contract (inputs)
export * from './contract.js';
export type {
  DataSnapshotRef,
  StrategyRef,
  ExecutionModel,
  CostModel,
  RiskModel,
  RunConfig,
  SimulationRequest,
} from './contract.js';

// Artifacts (outputs)
export * from './artifacts.js';
export type {
  TradeEvent,
  PnLSeries,
  ExposureSeries,
  RunMetrics,
  RunMetadata,
  RunArtifact,
} from './artifacts.js';

// Experiment context
export { createExperimentContext } from './context.js';
export type { ExperimentContextConfig } from './context.js';

// Experiment runner
export * from './experiment-runner.js';
export type {
  ExperimentContext,
  BatchSimulationRequest,
  BatchSimulationResult,
  ParameterSweepRequest,
} from './experiment-runner.js';
export {
  runSingleSimulation,
  runBatchSimulation,
  runParameterSweep,
  replaySimulation,
  getGitSha,
  getGitBranch,
  hashValue,
} from './experiment-runner.js';

// Metrics
export * from './metrics.js';
export { calculateMetrics, calculatePnLSeries } from './metrics.js';

// Artifact storage
export * from './artifact-storage.js';
export { FileArtifactStorage } from './artifact-storage.js';

// Simulation adapter
export * from './simulation-adapter.js';
export { ResearchSimulationAdapter, createSimulationAdapter } from './simulation-adapter.js';

// Canonical RunManifest
export * from './run-manifest.js';
export type { CanonicalRunManifest } from './run-manifest.js';
export { fromCLIManifest, fromRunArtifact, createCanonicalManifest } from './run-manifest.js';

// Research Services (Branch B & C)
export * from './services/index.js';
export { DataSnapshotService } from './services/DataSnapshotService.js';
export { ExecutionRealityService } from './services/ExecutionRealityService.js';

// Leaderboard
export * from './leaderboard.js';
export { getLeaderboard, getTopRuns, compareRuns } from './leaderboard.js';
export type { RankingCriteria, LeaderboardEntry, LeaderboardOptions } from './leaderboard.js';

// Optimization Workflow
export { runOptimizationWorkflow } from './optimization-workflow.js';
export type {
  OptimizationWorkflowConfig,
  OptimizationWorkflowResult,
  WorkflowRunMetadata,
  Phase1Config,
  Phase1Result,
  Phase2Config,
  Phase2Result,
  Phase3Config,
  Phase3Result,
} from './phases/types.js';
export { runPhase1LabSweepDiscovery } from './phases/lab-sweep-discovery.js';
export { runPhase2BacktestOptimization } from './phases/backtest-optimization.js';
export { runPhase3StressValidation } from './phases/stress-validation.js';

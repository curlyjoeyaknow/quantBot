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

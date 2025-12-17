/**
 * Core Module Index
 * =================
 * Exports core simulation functionality.
 */

export * from './events';
export * from './simulator';
// Orchestrator has been moved to @quantbot/workflows.
// Import from @quantbot/workflows/simulation/orchestrator instead.
// SimulationRunContext and related types are exported from engine.ts
export type {
  SimulationRunContext,
  SimulationLogger,
  SimulationResultSink,
  SimulationTarget,
  ScenarioRunSummary,
  SimulationRunError,
} from '../engine';

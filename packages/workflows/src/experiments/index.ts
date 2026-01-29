/**
 * Experiments Module
 *
 * Experiment execution with frozen artifact sets.
 *
 * @packageDocumentation
 */

// Main handler
export { executeExperiment, type ExperimentExecutionPorts } from './handlers/execute-experiment.js';

// Helpers
export { validateArtifacts, validateExperimentInputs } from './artifact-validator.js';
export { executeSimulation } from './simulation-executor.js';
export { publishResults, type Provenance } from './result-publisher.js';

// Types
export type {
  SimulationInput,
  SimulationConfig,
  SimulationOutput,
  SimulationResults,
  StrategyConfig,
  EntryConfig,
  ExitConfig,
  StopLossConfig,
  CostConfig,
  SignalCondition,
  ProfitTarget,
  DateRange,
  Trade,
  Metrics,
  EquityPoint,
  Diagnostic,
  ValidationResult,
  ValidationError,
} from './types.js';

/**
 * @quantbot/lab - Research Lab Package
 *
 * Provides feature computation, strategy compilation, simulation, and optimization
 * for the QuantBot research lab system.
 */

export * from './features/types.js';
export * from './features/IndicatorRegistry.js';
export * from './features/FeatureSetCompiler.js';
export * from './features/FeatureCache.js';
export * from './strategy/types.js';
export * from './strategy/StrategyGraphCompiler.js';
export * from './strategy/ConditionEvaluator.js';
export * from './risk/types.js';
export * from './risk/RiskEngine.js';
export * from './simulation/types.js';
export * from './simulation/SimulationKernel.js';
export * from './simulation/SimulationArtifactWriter.js';
export * from './metrics/types.js';
export * from './metrics/MetricsEngine.js';
export * from './metrics/StabilityScorer.js';
export * from './windows/types.js';
export * from './windows/RollingWindowExecutor.js';
export * from './optimization/types.js';
export * from './optimization/ParameterSpace.js';
export type { GridSearchResult } from './optimization/GridSearch.js';
export { GridSearch } from './optimization/GridSearch.js';
export * from './optimization/RandomSearch.js';
export * from './optimization/OptimizationEngine.js';
export * from './catalog/ids.js';

// Lab workflow orchestrators
export * from './workflows/types.js';
export { runLabPreset } from './workflows/runLabPreset.js';
export { runOptimization } from './workflows/runOptimization.js';
export { runRollingWindows } from './workflows/runRollingWindows.js';
export type { RollingWindowV1 } from './workflows/runRollingWindows.js';

// Lab server
export { startServer } from './server.js';

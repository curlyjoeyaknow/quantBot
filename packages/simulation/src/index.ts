/**
 * @quantbot/simulation - Simulation engine package
 * 
 * Public API exports for the simulation package
 */

// Core engine (includes re-exports of config types)
export * from './engine';

// Supporting modules
export * from './candles';
export * from './indicators';
export * from './ichimoku';
export * from './signals';
export * from './sinks';
export * from './target-resolver';

// Strategies and optimization
export * from './strategies';
export * from './optimization';

// Config (exported last to avoid conflicts with engine re-exports)
export type {
  SimulationScenarioConfig,
  CostConfig,
  OutputTargetConfig,
  RunOptions,
  StrategyLeg,
  LadderConfig
} from './config';

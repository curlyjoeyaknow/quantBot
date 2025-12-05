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

// Config (exported as types only to avoid conflicts)
export type {
  SimulationScenarioConfig,
  CostConfig,
  OutputTargetConfig,
  RunOptions,
  StrategyLeg,
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  LadderConfig,
  SignalCondition,
  SignalGroup,
  IndicatorName,
  ComparisonOperator
} from './config';

/**
 * @quantbot/simulation - Trading simulation engine package
 * 
 * Public API exports for the simulation package
 */

// Core engine
export { SimulationEngine } from './engine';
export type { EntryConfig, ReEntryConfig, StopLossConfig } from './engine';

// Configuration
export type { SimulationConfig, ComparisonOperator, IndicatorName, LadderConfig, SignalCondition, SignalGroup } from './config';

// Candles and data
export * from './candles';

// Technical indicators
export * from './ichimoku';
export * from './indicators';
export * from './signals';

// Output sinks
export * from './sinks';

// Target resolver
export * from './target-resolver';

// Strategies
export * from './strategies';

// Optimization
export * from './optimization';

// Package logger
export { logger } from './logger';

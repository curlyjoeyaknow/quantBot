/**
 * @quantbot/simulation - Trading simulation engine package
 * 
 * Public API exports for the simulation package
 */

// Core engine and types
export { SimulationEngine, simulateStrategy } from './engine';
export type { Strategy, SimulationEvent, SimulationResult } from './engine';

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

// Strategies (only export builder and presets, types come from config)
export * from './strategies/builder';
export * from './strategies/presets';

// Optimization
export * from './optimization';

// Configuration types
export * from './config';

// Package logger
export { logger } from './logger';

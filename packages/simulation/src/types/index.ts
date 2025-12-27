/**
 * Types Module Index
 * ==================
 * Exports all type definitions for the simulation engine.
 */

// Candle types
export * from './candle.js';

// Causal accessor (Gate 2: Causal candle accessor)
export * from './causal-accessor.js';

// Position types
export * from './position.js';

// Event types
export * from './events.js';

// Strategy types
export * from './strategy.js';

// Signal types
export * from './signals.js';

// Result types
export * from './results.js';

// Re-export StrategyPresetName from strategies/types
export type { StrategyPresetName } from '../strategies/types.js';

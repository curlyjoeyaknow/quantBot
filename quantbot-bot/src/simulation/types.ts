/**
 * Simulation Types
 * ================
 * Re-export types from engine for compatibility
 * The actual types are defined in engine.ts
 */

export type { Strategy, SimulationResult, SimulationEvent } from './engine';
export type { StopLossConfig, EntryConfig, ReEntryConfig } from './config';


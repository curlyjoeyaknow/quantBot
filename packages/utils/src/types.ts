/**
 * Shared Type Definitions
 * ========================
 * Common types used across the QuantBot application
 *
 * NOTE: These types are now defined in @quantbot/core.
 * This file re-exports them for backward compatibility.
 * New code should import directly from @quantbot/core.
 */

// Re-export all types from @quantbot/core for backward compatibility
export type {
  StrategyLeg,
  Strategy,
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  Candle,
  SimulationEvent,
  SimulationRunData,
  CACall,
  TokenMetadata,
  CallerInfo,
  LastSimulation,
  Chain,
  TokenAddress,
  Token,
  Caller,
  Alert,
  Call,
  StrategyConfig,
  CallSelection,
  DateRange,
  Trade,
  Position,
  SimulationAggregate,
  SimulationTrace,
  SimulationResult,
  SimulationTarget,
  ActiveCA,
  CostConfig,
} from '@quantbot/core';

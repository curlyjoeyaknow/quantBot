/**
 * Shared Type Definitions
 * ========================
 * Common types used across the QuantBot application
 *
 * @deprecated This file is deprecated. Import types directly from @quantbot/core.
 * This file will be removed in v2.0.0.
 *
 * NOTE: These types are now defined in @quantbot/core.
 * This file re-exports them for backward compatibility only.
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

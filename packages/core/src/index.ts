/**
 * @quantbot/core
 *
 * Foundational, shared types and interfaces for the QuantBot ecosystem.
 * This package has zero dependencies on other @quantbot packages.
 *
 * All core domain types, simulation types, and configuration types are exported from here.
 */

import { DateTime } from 'luxon';

// ============================================================================
// Ports & Adapters
// ============================================================================

export * from './ports/index.js';
// Explicit re-export for better TypeScript resolution
export { createSystemClock } from './ports/clockPort.js';
export type { ClockPort } from './ports/clockPort.js';

// ============================================================================
// Commands & Handlers
// ============================================================================

export * from './commands/index.js';
export * from './handlers/index.js';

// ============================================================================
// Core Domain Types
// ============================================================================

// Domain module (chain, telemetry, etc.)
export * from './domain/index.js';
// Run ledger domain
export * from './domain/runs/index.js';

// Domain models
export * from './domain/calls/CallSignal.js';

// ============================================================================
// Determinism & Reproducibility
// ============================================================================

export * from './determinism.js';
export * from './seed-manager.js';

// ============================================================================
// Error Classes
// ============================================================================

export * from './errors.js';

// ============================================================================
// Artifacts & Versioning
// ============================================================================

export * from './artifacts.js'; // Legacy artifact system
export { getArtifactsDir } from './paths/artifactsPath.js';
export { NdjsonLogger } from './logging/ndjsonLogger.js';

// ============================================================================
// Slice Types (moved from workflows to break circular dependency)
// ============================================================================

// Export slice types with explicit names to avoid conflicts with ports
export type {
  SliceChain,
  SliceGranularity,
  Compression,
  ParquetPath,
  RunContext,
  SliceSpec,
  ParquetLayoutSpec,
  SliceManifestV1,
  SliceAnalysisSpec,
  SliceAnalysisResult,
  ExportAndAnalyzeResult,
} from './slices/types.js';
export type { SliceExporter, SliceAnalyzer, SliceValidator } from './slices/ports.js';
export {
  validateParquetLayout,
  getCanonicalLayoutSpec,
  assertValidParquetLayout,
} from './slices/validate-layout.js';

// ============================================================================
// Canonical Data
// ============================================================================

export * from './canonical/event-schema.js';
export * from './canonical/transformers.js';

// ============================================================================
// Experiment Tracking
// ============================================================================

export * from './experiment-id-generator.js';
export * from './parameter-vector.js';
export * from './strategy/dsl-schema.js';
export * from './strategy/dsl-validator.js';
export * from './strategy/dsl-to-sim-input.js';
export * from './strategy/template-schema.js';
export * from './strategy/template-instantiation.js';
export * from './strategy/template-registry.js';

// Re-export types for convenience
export type {
  StrategyDSL,
  EntryCondition,
  ExitCondition,
  ReEntryCondition,
  PositionSizing,
  RiskConstraints,
  CostConfig as DSLCostConfig,
  SignalCondition,
  SignalGroup,
  IndicatorName,
  ComparisonOperator,
} from './strategy/dsl-schema.js';

/**
 * Supported blockchain
 *
 * Note: Standardized to lowercase for consistency. Use 'solana' instead of 'SOL'.
 */
export type Chain = 'solana' | 'ethereum' | 'bsc' | 'base' | 'monad' | 'evm';

// Chain utilities are now exported from domain/index.js
// Keep this comment for reference - exports are handled above via domain/index.js

// ============================================================================
// Domain Types (re-exported from domain subfolders)
// ============================================================================

// All domain types are now exported from domain/index.js via the domain module exports above
// These re-exports maintain backward compatibility while organizing types into subfolders

// Re-export for backward compatibility (types are now in domain subfolders)
export type {
  TokenAddress,
  Token,
  TokenMetadata,
} from './domain/tokens/index.js';
export { createTokenAddress } from './domain/tokens/index.js';

export type {
  Caller,
  CallerInfo,
} from './domain/callers/index.js';

export type {
  Alert,
  Call,
  CACall,
  ActiveCA,
} from './domain/calls/index.js';

export type {
  StrategyConfig,
  StrategyLeg,
  Strategy,
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  CostConfig,
  CallSelection,
  DateRange,
  UserStrategy,
} from './domain/strategies/index.js';

export type {
  Candle,
  Trade,
  Position,
  EntryEvent,
  TrailingEntryTriggeredEvent,
  ReEntryEvent,
  LadderEntryEvent,
  StopMovedEvent,
  TargetHitEvent,
  StopLossEvent,
  LadderExitEvent,
  FinalExitEvent,
  SimulationEvent,
  SimulationResult,
  SimulationAggregate,
  SimulationTrace,
  SimulationTarget,
  SimulationRunData,
  LastSimulation,
} from './domain/simulation/index.js';

// ============================================================================
// OHLCV Work Planning Types (moved from ingestion to break circular dependency)
// ============================================================================

/**
 * Work item for OHLCV fetching
 *
 * Moved from @quantbot/ingestion to @quantbot/core to break circular dependency
 * between @quantbot/ingestion and @quantbot/jobs.
 */
export interface OhlcvWorkItem {
  mint: string;
  chain: Chain;
  interval: '1s' | '15s' | '1m' | '5m' | '1H';
  startTime: DateTime;
  endTime: DateTime;
  priority?: number;
  alertTime?: DateTime; // Original alert time for context
  callCount?: number; // Number of calls for this mint
}
export * from './plugins/registry.js';
export type { StrategyFactory, DataSourceFactory, OutputFactory } from './plugins/types.js';

/**
 * @quantbot/simulation - Trading Simulation Engine
 * =================================================
 *
 * A comprehensive, modular simulation engine for backtesting trading strategies.
 *
 * ## Architecture
 *
 * The simulation engine is organized into the following modules:
 *
 * - **types/**: Type definitions for candles, positions, events, strategies, and signals
 * - **data/**: Candle data providers (Birdeye API, ClickHouse via StorageEngine)
 * - **indicators/**: Technical indicators (Ichimoku, Moving Averages, RSI)
 * - **signals/**: Signal evaluation for entry/exit conditions
 * - **position/**: Position and portfolio management
 * - **execution/**: Entry, exit, and fee calculation logic
 * - **core/**: Main simulation engine and orchestrator
 * - **sinks/**: Output handlers (Console, CSV, JSON, ClickHouse)
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   simulateStrategy,
 *   createOrchestrator,
 *   createHybridProvider
 * } from '@quantbot/simulation';
 *
 * // Simple simulation on candle data
 * const result = simulateStrategy(candles, [
 *   { target: 2, percent: 0.5 },
 *   { target: 3, percent: 0.5 },
 * ]);
 *
 * // Advanced: Run simulations with orchestrator
 * const orchestrator = createOrchestrator();
 * const summary = await orchestrator.runScenario({
 *   scenario: { name: 'test', strategy: [...] },
 *   targets: [...],
 * });
 * ```
 */

// =============================================================================
// Types - Core type definitions
// =============================================================================
export * from './types';
export * from './duckdb-storage-service';
export * from './clickhouse-service';

// =============================================================================
// Data - Candle providers and aggregation
// =============================================================================
export * from './data';

// =============================================================================
// Indicators - Technical analysis
// =============================================================================
export * from './indicators';

// =============================================================================
// Signals - Signal evaluation
// =============================================================================
export * from './signals';

// =============================================================================
// Position - Position/portfolio management
// =============================================================================
export * from './position';

// =============================================================================
// Execution - Entry/exit logic and fees
// =============================================================================
export {
  // Fees
  DEFAULT_COST_CONFIG,
  calculateEntryPriceWithCosts,
  calculateExitPriceWithCosts,
  getEntryCostMultiplier,
  getExitCostMultiplier,
  calculateTradeFee,
  calculateBorrowCost,
  calculateNetPnl,
  calculatePnlMultiplier,
  // Entry
  DEFAULT_ENTRY_CONFIG,
  detectEntry,
  calculateEntryDelay,
  // Exit
  checkStopLoss,
  checkTrailingStopActivation,
  calculateTrailingStopPrice,
  checkProfitTarget,
  checkExitSignal,
  createFinalExit,
  createTimeoutExit,
  initStopLossState,
  updateStopLossState,
  // Re-entry
  DEFAULT_REENTRY as EXECUTION_DEFAULT_REENTRY,
  initReEntryState,
  startReEntryWait,
  checkReEntry,
  completeReEntry,
  cancelReEntryWait,
  canReEnter,
} from './execution';

export type {
  EntryDetectionResult,
  ExitDetectionResult,
  StopLossState,
  ReEntryDetectionResult,
  ReEntryState,
} from './execution';

// =============================================================================
// Core - Main simulation engine
// =============================================================================
export * from './core';

// =============================================================================
// Config - Configuration parsing and target resolution
// =============================================================================
export { parseSimulationConfig } from './config';
export type {
  SimulationScenarioConfig,
  SimulationEngineConfig,
  PeriodMetricsConfig,
} from './config';
export { DefaultTargetResolver } from './target-resolver';
export type { ScenarioTargetResolver } from './target-resolver';

// =============================================================================
// Storage - Storage integration
// =============================================================================
// Storage integration has been moved to @quantbot/workflows.
// Import from @quantbot/workflows/storage instead.

// =============================================================================
// Performance - Performance monitoring and optimization
// =============================================================================
export { getPerformanceMonitor, PerformanceMonitor } from './performance/monitor';
export type { PerformanceMetrics } from './performance/monitor';
export { calculateIndicatorSeriesOptimized } from './performance/optimizations';

// =============================================================================
// Analytics - Period metrics integration
// =============================================================================
export {
  calculatePeriodMetricsForSimulation,
  enrichSimulationResultWithPeriodMetrics,
} from './period-metrics/period-metrics';

// =============================================================================
// Math - Pure math utilities
// =============================================================================
export * from './math';

// =============================================================================
// Sinks - Output handlers
// =============================================================================
export * from './sinks';

// =============================================================================
// Backwards Compatibility Exports
// =============================================================================

// Re-export the main simulation function directly for convenience
export { simulateStrategy } from './core/simulator';
export type { SimulationOptions } from './core/simulator';

// Orchestrator has been moved to @quantbot/workflows.
// Import from @quantbot/workflows/simulation/orchestrator instead.

// Re-export common types at top level
export type {
  Candle,
  CandleInterval,
  Position,
  SimulationResult,
  SimulationEvent,
  LegacySimulationEvent,
  StrategyConfig,
  StrategyLeg,
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  CostConfig,
  SignalGroup,
  SignalCondition,
  LadderConfig,
  LadderLeg,
} from './types';

// Orchestrator types have been moved to @quantbot/workflows.
// Import from @quantbot/workflows/simulation/orchestrator instead.

// Re-export provider types
export type { TokenMetadata, CandleFetchRequest, CandleFetchResult } from './data/provider';

// Re-export indicator types
export type { IchimokuData } from './indicators/ichimoku';
export type { LegacyIndicatorData } from './indicators/registry';

// =============================================================================
// Legacy Exports (for backwards compatibility with existing code)
// =============================================================================

// Hybrid provider functions have been moved to @quantbot/ohlcv
// Use @quantbot/ohlcv instead

// Re-export ichimoku at top level for legacy code
export { calculateIchimoku } from './indicators/ichimoku';

// Re-export ichimoku functions from legacy ichimoku.ts file
export { detectIchimokuSignals, formatIchimokuData } from './ichimoku';
export type { IchimokuSignal } from './ichimoku';

// Re-export signal evaluation at top level
export { evaluateSignalGroup, evaluateLadderLegs } from './signals';

// Re-export candle aggregation
export { aggregateCandles } from './data/aggregator';

// Re-export indicator calculation for legacy code
export {
  calculateIndicators,
  calculateIndicatorSeries,
  getBullishSignals,
  getBearishSignals,
} from './indicators/registry';

// =============================================================================
// Package logger
// =============================================================================
export { logger } from './logger';

// =============================================================================
// Utilities - Progress indicators and helpers
// =============================================================================
export * from './utils/progress';

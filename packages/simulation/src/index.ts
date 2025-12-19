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
 * import { simulateStrategy } from '@quantbot/simulation';
 * import { fetchHybridCandles } from '@quantbot/ohlcv';
 * import { runSimulation } from '@quantbot/workflows';
 *
 * // Simple simulation on candle data
 * const candles = await fetchHybridCandles(mint, startTime, endTime, chain);
 * const result = simulateStrategy(candles, [
 *   { target: 2, percent: 0.5 },
 *   { target: 3, percent: 0.5 },
 * ]);
 *
 * // Advanced: Run simulations with orchestrator (from workflows package)
 * const summary = await runSimulation({
 *   strategyName: 'test',
 *   from: startTime,
 *   to: endTime,
 * });
 * ```
 */

// =============================================================================
// Types - Core type definitions
// =============================================================================
export * from "./types/index.js";
export * from "./duckdb-storage-service.js";
export * from "./clickhouse-service.js";
export * from "./simulation-service.js";

// =============================================================================
// Data - Candle providers and aggregation
// =============================================================================
export * from "./data/index.js";

// =============================================================================
// Indicators - Technical analysis
// =============================================================================
export * from "./indicators.js";

// =============================================================================
// Signals - Signal evaluation
// =============================================================================
export * from "./signals.js";

// =============================================================================
// Position - Position/portfolio management
// =============================================================================
export * from "./position/index.js";

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
} from "./execution/index.js";

export type {
  EntryDetectionResult,
  ExitDetectionResult,
  StopLossState,
  ReEntryDetectionResult,
  ReEntryState,
} from "./execution/index.js";

// =============================================================================
// Core - Main simulation engine
// =============================================================================
export * from "./core/index.js";

// =============================================================================
// Config - Configuration parsing and target resolution
// =============================================================================
export { parseSimulationConfig } from "./config.js";
export type {
  SimulationScenarioConfig,
  SimulationEngineConfig,
  PeriodMetricsConfig,
} from "./config.js";
export { DefaultTargetResolver } from "./target-resolver.js";
export type { ScenarioTargetResolver } from "./target-resolver.js";

// =============================================================================
// Storage - Storage integration
// =============================================================================
// Storage integration has been moved to @quantbot/workflows.
// Import from @quantbot/workflows/storage instead.

// =============================================================================
// Performance - Performance monitoring and optimization
// =============================================================================
export { getPerformanceMonitor, PerformanceMonitor } from "./performance/monitor.js";
export type { PerformanceMetrics } from "./performance/monitor.js";
export { calculateIndicatorSeriesOptimized } from "./performance/optimizations.js";

// =============================================================================
// Analytics - Period metrics integration
// =============================================================================
export {
  calculatePeriodMetricsForSimulation,
  enrichSimulationResultWithPeriodMetrics,
} from "./period-metrics/period-metrics.js";

// =============================================================================
// Math - Pure math utilities
// =============================================================================
export * from "./math/index.js";

// =============================================================================
// Sinks - Output handlers
// =============================================================================
export * from "./sinks.js";

// =============================================================================
// Backwards Compatibility Exports
// =============================================================================

// Re-export the main simulation function directly for convenience
export { simulateStrategy } from "./core/simulator.js";
export { simulateFromInput } from "./core/contract-adapter.js";
export type { SimInput, SimResult, SimEvent, SimMetrics } from "./types/contracts.js";
export { SimInputSchema, SimResultSchema } from "./types/contracts.js";
export type { SimulationOptions } from "./core/simulator.js";

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
} from "./types/index.js";

// Orchestrator types have been moved to @quantbot/workflows.
// Import from @quantbot/workflows/simulation/orchestrator instead.

// Re-export provider types
export type { TokenMetadata, CandleFetchRequest, CandleFetchResult } from "./data/provider.js";

// Re-export indicator types
export type { IchimokuData } from "./indicators/ichimoku.js";
export type { LegacyIndicatorData, IndicatorData } from "./indicators/registry.js";

// =============================================================================
// Legacy Exports (for backwards compatibility with existing code)
// =============================================================================

// Hybrid provider functions have been moved to @quantbot/ohlcv
// Use @quantbot/ohlcv instead

// Re-export ichimoku at top level for legacy code
export { calculateIchimoku } from "./indicators/ichimoku.js";

// Re-export ichimoku functions from legacy ichimoku.ts file
export { detectIchimokuSignals, formatIchimokuData } from "./ichimoku.js";
export type { IchimokuSignal } from "./ichimoku.js";

// Re-export signal evaluation at top level
export { evaluateSignalGroup, evaluateLadderLegs } from "./signals.js";

// Re-export candle aggregation
export { aggregateCandles } from "./data/aggregator.js";

// Re-export indicator calculation for legacy code
export {
  calculateIndicators,
  calculateIndicatorSeries,
  getBullishSignals,
  getBearishSignals,
} from "./indicators/registry.js";

// =============================================================================
// Package logger
// =============================================================================
export { logger } from "./logger.js";

// =============================================================================
// Utilities - Progress indicators and helpers
// =============================================================================
export * from "./utils/progress.js";

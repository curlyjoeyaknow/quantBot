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
// Core Domain Types
// ============================================================================

/**
 * Supported blockchain
 *
 * Note: Standardized to lowercase for consistency. Use 'solana' instead of 'SOL'.
 */
export type Chain = 'solana' | 'ethereum' | 'bsc' | 'base';

/**
 * Token address (Solana mint address)
 *
 * CRITICAL: Always preserve full address (32-44 chars) and exact case.
 * Never truncate or modify mint addresses for storage or API calls.
 *
 * This is a branded type to prevent accidental mixing with other strings.
 * Use `createTokenAddress()` to create validated instances.
 */
export type TokenAddress = string & { readonly __brand: 'TokenAddress' };

/**
 * Creates a validated TokenAddress from a string.
 *
 * @param address - The mint address string to validate
 * @returns A branded TokenAddress type
 * @throws Error if address length is invalid (must be 32-44 characters)
 *
 * @example
 * ```typescript
 * const mint = createTokenAddress('So11111111111111111111111111111111111111112');
 * ```
 */
export function createTokenAddress(address: string): TokenAddress {
  if (address.length < 32 || address.length > 44) {
    // Note: @quantbot/core has zero dependencies, so we use plain Error
    // ValidationError would require @quantbot/utils dependency
    throw new Error(
      `ValidationError: Invalid mint address length: ${address.length}. Must be between 32 and 44 characters.`
    );
  }
  return address as TokenAddress;
}

/**
 * Caller (signal source)
 */
export interface Caller {
  id: number;
  source: string; // e.g., 'brook', 'lsy', 'manual'
  handle: string;
  displayName?: string;
  attributes?: Record<string, unknown>;
  createdAt: DateTime;
  updatedAt: DateTime;
}

/**
 * Token entity
 */
export interface Token {
  id: number;
  chain: Chain;
  address: TokenAddress; // Full mint address, case-preserved
  symbol?: string;
  name?: string;
  decimals?: number;
  metadata?: Record<string, unknown>;
  createdAt: DateTime;
  updatedAt: DateTime;
}

/**
 * Alert (raw message from caller)
 */
export interface Alert {
  id: number;
  tokenId: number;
  callerId?: number;
  strategyId?: number;
  side: 'buy' | 'sell';
  confidence?: number;
  alertPrice?: number;
  alertTimestamp: DateTime;
  rawPayload?: Record<string, unknown>;
  createdAt: DateTime;

  // Telegram-specific fields
  chatId?: string;
  messageId?: string;
  messageText?: string;
}

/**
 * Call (normalized trading signal derived from alert)
 */
export interface Call {
  id: number;
  alertId?: number;
  tokenId: number;
  callerId?: number;
  strategyId?: number;
  side: 'buy' | 'sell';
  signalType: 'entry' | 'exit' | 'scale_in' | 'scale_out';
  signalStrength?: number;
  signalTimestamp: DateTime;
  metadata?: Record<string, unknown>;
  createdAt: DateTime;
}

/**
 * Strategy configuration
 */
export interface StrategyConfig {
  name: string;
  version?: string;
  category?: string;
  description?: string;
  config: Record<string, unknown>; // Full strategy config JSON
  isActive: boolean;
  createdAt: DateTime;
  updatedAt: DateTime;
}

/**
 * Call selection criteria for simulation
 *
 * Note: Uses DateTime for consistency with database entities and timezone handling.
 */
export interface CallSelection {
  callerIds?: number[];
  callerNames?: string[];
  tokenAddresses?: TokenAddress[];
  from?: DateTime;
  to?: DateTime;
  side?: 'buy' | 'sell';
  signalTypes?: string[];
}

/**
 * Date range for queries
 *
 * Note: Uses DateTime for consistency with database entities and timezone handling.
 */
export interface DateRange {
  from: DateTime;
  to: DateTime;
}

// ============================================================================
// Simulation & Strategy Types
// ============================================================================

/**
 * Candle type representing OHLCV data for a specific time interval.
 */
export interface Candle {
  timestamp: number; // UNIX timestamp (seconds UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Strategy leg definition (array of target/percent pairs)
 */
export interface StrategyLeg {
  target: number;
  percent: number;
}

/**
 * Represents a single take-profit target in a trading strategy.
 * Alias for StrategyLeg for backward compatibility.
 */
export type Strategy = StrategyLeg;

/**
 * Configuration for stop-loss logic in a simulation.
 */
export interface StopLossConfig {
  initial: number;
  trailing: number | 'none';
  activation?: number;
}

/**
 * Entry configuration for delayed/trailing entries
 */
export interface EntryConfig {
  initialEntry: number | 'none';
  trailingEntry: number | 'none';
  maxWaitTime: number;
}

/**
 * Re-entry configuration
 */
export interface ReEntryConfig {
  trailingReEntry: number | 'none';
  maxReEntries: number;
  sizePercent: number;
}

/**
 * Cost configuration for simulation
 */
export interface CostConfig {
  entrySlippageBps?: number;
  exitSlippageBps?: number;
  takerFeeBps?: number;
  borrowAprBps?: number;
}

/**
 * Trade execution
 */
export interface Trade {
  id: string;
  tokenAddress: string;
  chain: string;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  timestamp: number;
  pnl?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Position state during simulation
 */
export interface Position {
  tokenAddress: string;
  chain: string;
  size: number; // Current position size (positive = long, negative = short)
  entryPrice: number;
  entryTimestamp: number;
  currentPrice: number;
  unrealizedPnl: number;
  realizedPnl: number;
  stopLoss?: number;
  trailingStop?: number;
  profitTargets: Array<{ target: number; percent: number; hit: boolean }>;
}

/**
 * Base fields shared by all simulation events
 */
interface BaseSimulationEvent {
  timestamp: number;
  price: number;
  description: string;
  remainingPosition: number;
  pnlSoFar: number;
  indicators?: Record<string, unknown>;
  positionState?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * Entry event - initial position entry
 */
export interface EntryEvent extends BaseSimulationEvent {
  type: 'entry';
}

/**
 * Trailing entry triggered event
 */
export interface TrailingEntryTriggeredEvent extends BaseSimulationEvent {
  type: 'trailing_entry_triggered';
}

/**
 * Re-entry event - re-entering after exit
 */
export interface ReEntryEvent extends BaseSimulationEvent {
  type: 're_entry';
}

/**
 * Ladder entry event - partial entry via ladder strategy
 */
export interface LadderEntryEvent extends BaseSimulationEvent {
  type: 'ladder_entry';
}

/**
 * Stop loss moved event - trailing stop activated or moved
 */
export interface StopMovedEvent extends BaseSimulationEvent {
  type: 'stop_moved';
  /** Previous stop loss price (optional) */
  oldStop?: number;
  /** New stop loss price (optional) */
  newStop?: number;
}

/**
 * Target hit event - profit target reached
 */
export interface TargetHitEvent extends BaseSimulationEvent {
  type: 'target_hit';
  /** Target multiplier that was hit (optional) */
  target?: number;
  /** Percentage of position sold (optional) */
  percentSold?: number;
}

/**
 * Stop loss event - stop loss triggered
 */
export interface StopLossEvent extends BaseSimulationEvent {
  type: 'stop_loss';
  /** Stop loss price that was triggered (optional) */
  stopPrice?: number;
}

/**
 * Ladder exit event - partial exit via ladder strategy
 */
export interface LadderExitEvent extends BaseSimulationEvent {
  type: 'ladder_exit';
}

/**
 * Final exit event - complete position exit
 */
export interface FinalExitEvent extends BaseSimulationEvent {
  type: 'final_exit';
  /** Exit reason (optional) */
  exitReason?: string;
}

/**
 * Simulation event - discriminated union of all event types
 *
 * Use type narrowing to access type-specific fields:
 * ```typescript
 * if (event.type === 'target_hit') {
 *   // event.target is available here
 * }
 * ```
 */
export type SimulationEvent =
  | EntryEvent
  | TrailingEntryTriggeredEvent
  | ReEntryEvent
  | LadderEntryEvent
  | StopMovedEvent
  | TargetHitEvent
  | StopLossEvent
  | LadderExitEvent
  | FinalExitEvent;

/**
 * Simulation result
 */
export interface SimulationResult {
  finalPnl: number;
  events: SimulationEvent[];
  entryPrice: number;
  finalPrice: number;
  totalCandles: number;
  entryOptimization: {
    lowestPrice: number;
    lowestPriceTimestamp: number;
    lowestPricePercent: number;
    lowestPriceTimeFromEntry: number;
    trailingEntryUsed: boolean;
    actualEntryPrice: number;
    entryDelay: number;
  };
}

/**
 * Simulation aggregate metrics
 */
export interface SimulationAggregate {
  tokenAddress: string;
  chain: string;
  finalPnl: number;
  maxDrawdown: number;
  volatility: number;
  sharpeRatio: number;
  sortinoRatio: number;
  winRate: number;
  tradeCount: number;
  reentryCount: number;
  ladderEntriesUsed: number;
  ladderExitsUsed: number;
}

/**
 * Complete simulation trace
 */
export interface SimulationTrace {
  trades: Trade[];
  events: SimulationEvent[];
  aggregates: SimulationAggregate;
}

/**
 * Simulation target for running simulations
 */
export interface SimulationTarget {
  mint: string;
  chain: string;
  startTime: DateTime;
  endTime: DateTime;
  metadata?: Record<string, unknown>;
}

/**
 * Simulation run data structure
 */
export interface SimulationRunData {
  id?: number;
  userId?: number;
  mint: string;
  chain: string;
  tokenName?: string;
  tokenSymbol?: string;
  startTime: DateTime;
  endTime: DateTime;
  strategy: Strategy[];
  stopLossConfig: StopLossConfig;
  finalPnl: number;
  totalCandles: number;
  events: SimulationEvent[];
  strategyName?: string;
  entryType?: string;
  entryPrice?: number;
  entryTimestamp?: number;
  filterCriteria?: Record<string, unknown>;
  createdAt?: DateTime;
}

/**
 * User-saved strategy with metadata
 */
export interface UserStrategy {
  id?: number;
  userId: number;
  name: string;
  description?: string;
  strategy: StrategyLeg[];
  stopLossConfig: StopLossConfig;
  isDefault: boolean;
  createdAt: DateTime;
}

// ============================================================================
// Token & Caller Types
// ============================================================================

/**
 * Token metadata from APIs
 */
export interface TokenMetadata {
  name: string;
  symbol: string;
  decimals?: number;
  price?: number;
  logoURI?: string;
  priceChange24h?: number;
  volume24h?: number;
  marketCap?: number;
  address?: string;
}

/**
 * Caller information from database
 */
export interface CallerInfo {
  id?: number;
  caller_name: string;
  token_address: string;
  token_symbol?: string;
  chain: string;
  alert_timestamp: string | Date;
  alert_message?: string;
  price_at_alert?: number;
  volume_at_alert?: number;
  caller?: string;
}

/**
 * CA Call structure from database
 */
export interface CACall {
  mint: TokenAddress;
  chain: Chain;
  token_name?: string;
  token_symbol?: string;
  call_price?: number;
  caller_name?: string;
  alert_timestamp?: string | Date;
  alert_message?: string;
  volume_at_alert?: number;
}

/**
 * Active CA tracking structure
 */
export interface ActiveCA {
  id: number;
  mint: TokenAddress;
  chain: Chain;
  token_name?: string;
  token_symbol?: string;
  call_price?: number;
  call_marketcap?: number;
  alert_timestamp?: number;
  caller?: string;
  created_at?: string;
}

/**
 * Last simulation info for /repeat command
 */
export interface LastSimulation {
  mint: string;
  chain: string;
  datetime: DateTime;
  metadata: TokenMetadata;
  candles: Candle[];
}

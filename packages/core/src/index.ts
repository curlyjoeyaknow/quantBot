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
 */
export type Chain = 'SOL' | 'solana' | 'ethereum' | 'bsc' | 'base';

/**
 * Token address (Solana mint address)
 *
 * CRITICAL: Always preserve full address (32-44 chars) and exact case.
 * Never truncate or modify mint addresses for storage or API calls.
 */
export type TokenAddress = string;

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
 */
export interface CallSelection {
  callerIds?: number[];
  callerNames?: string[];
  tokenAddresses?: TokenAddress[];
  from?: Date;
  to?: Date;
  side?: 'buy' | 'sell';
  signalTypes?: string[];
}

/**
 * Date range for queries
 */
export interface DateRange {
  from: Date;
  to: Date;
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
 * Simulation event
 */
export interface SimulationEvent {
  type:
    | 'entry'
    | 'stop_moved'
    | 'target_hit'
    | 'stop_loss'
    | 'final_exit'
    | 'trailing_entry_triggered'
    | 're_entry'
    | 'ladder_entry'
    | 'ladder_exit';
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
  createdAt?: DateTime;
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
  mint: string;
  chain: string;
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
  mint: string;
  chain: string;
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

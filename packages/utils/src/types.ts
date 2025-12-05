/**
 * Shared Type Definitions
 * ========================
 * Common types used across the QuantBot application
 */

import { DateTime } from 'luxon';

/**
 * Strategy leg definition (array of target/percent pairs)
 */
export interface StrategyLeg {
  target: number;
  percent: number;
}

export type Strategy = StrategyLeg;

/**
 * Stop loss configuration
 */
export interface StopLossConfig {
  initial: number;
  trailing: number | 'none';
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
 * Candle data structure
 */
export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * Simulation event structure
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
 * Last simulation info for /repeat command
 */
export interface LastSimulation {
  mint: string;
  chain: string;
  datetime: DateTime;
  metadata: TokenMetadata;
  candles: Candle[];
}


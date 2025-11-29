/**
 * Session Type Definitions
 * ========================
 * Type definitions for user session data structures
 */

import { DateTime } from 'luxon';
import { Strategy } from '../simulation/engine';
import { StopLossConfig, EntryConfig, ReEntryConfig } from '../simulation/config';
import type { Candle } from '../simulation/candles';

/**
 * Token metadata from Birdeye API
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
 * Simulation event structure
 */
export interface SimulationEvent {
  type: string;
  timestamp: number;
  price: number;
  description: string;
  remainingPosition: number;
  pnlSoFar: number;
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

/**
 * CA Call structure from database
 */
export interface CACall {
  mint: string;
  chain: string;
  token_name?: string;
  token_symbol?: string;
  call_price?: number;
  call_marketcap?: number;
  call_timestamp?: number;
  caller?: string;
  created_at?: string;
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
  call_timestamp?: number;
  caller?: string;
  created_at?: string;
}

/**
 * Session data structure
 */
export interface SessionData {
  [key: string]: unknown;
  waitingManualInput?: string;
  waitingForRunSelection?: boolean;
  mint?: string;
  chain?: string;
  datetime?: DateTime | string;
  metadata?: TokenMetadata;
  callerInfo?: CallerInfo;
  strategy?: Strategy[];
  stopLossConfig?: StopLossConfig;
  entryConfig?: EntryConfig;
  reEntryConfig?: ReEntryConfig;
  recentRuns?: SimulationRunData[];
}

/**
 * Session type for maintaining user state
 */
export interface Session {
  step?: string;
  type?: string;
  data?: SessionData;
  mint?: string;
  chain?: string;
  datetime?: DateTime;
  metadata?: TokenMetadata;
  callerInfo?: CallerInfo;
  strategy?: Strategy[];
  stopLossConfig?: StopLossConfig;
  entryConfig?: EntryConfig;
  reEntryConfig?: ReEntryConfig;
  lastSimulation?: LastSimulation;
  waitingForRunSelection?: boolean;
  recentRuns?: SimulationRunData[];
  userId?: number;
  strategyName?: string;
  [key: string]: unknown; // Allow additional properties for flexibility
}


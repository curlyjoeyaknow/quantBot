/**
 * Core domain types for Golden Path
 * 
 * These types represent the core entities in the analytics pipeline:
 * - Chain identifiers
 * - Token addresses
 * - Callers (signal sources)
 * - Alerts (raw messages)
 * - Calls (normalized trading signals)
 */

import { DateTime } from 'luxon';

/**
 * Supported blockchain
 */
export type Chain = 'SOL';

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

/**
 * Candle type (re-exported for convenience, matches simulation models)
 */
export interface Candle {
  timestamp: number; // UNIX timestamp (seconds UTC)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}


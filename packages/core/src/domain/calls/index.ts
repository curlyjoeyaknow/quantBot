/**
 * Calls Domain Types
 */

import { DateTime } from 'luxon';
import type { TokenAddress } from '../tokens/index.js';
import type { Chain } from '../../index.js';

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

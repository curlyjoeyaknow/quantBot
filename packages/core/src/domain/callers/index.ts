/**
 * Caller Domain Types
 */

import { DateTime } from 'luxon';

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


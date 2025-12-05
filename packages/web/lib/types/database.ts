/**
 * Database Type Definitions
 * ==========================
 * Types for database rows and queries
 */

export interface CallerAlertRow {
  id: number;
  caller_name: string;
  token_address: string;
  token_symbol?: string | null;
  chain: string;
  alert_timestamp: string;
  price_at_alert?: string | null;
  entry_price?: string | null;
  volume_at_alert?: string | null;
  max_price?: number | null;
  max_gain_percent?: number | null;
  time_to_ath?: number | null;
}

export interface StrategyResultRow {
  id?: number;
  token_address: string;
  caller_name: string;
  alert_timestamp: string;
  max_price?: number | null;
  max_gain_percent?: number | null;
  time_to_ath?: number | null;
  [key: string]: any;
}

export interface DuplicateCheckResult {
  id: number;
  duplicate_count: number;
}

export interface CountResult {
  count: number;
}


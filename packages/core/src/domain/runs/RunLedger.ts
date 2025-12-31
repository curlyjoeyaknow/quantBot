/**
 * Run Ledger Domain Types
 *
 * Pure domain types for simulation run tracking.
 * These are plain data structures with no dependencies on storage or I/O.
 */

import { DateTime } from 'luxon';

/**
 * Run: "what was executed"
 */
export interface Run {
  run_id: string; // UUID
  created_at: DateTime;
  git_sha?: string;
  engine_version?: string;
  strategy_id: string;
  params_json: string; // JSON string of strategy params
  universe_ref?: string; // e.g. "token_set:topN" or "mint_list:hash"
  interval_sec: number;
  time_from: DateTime;
  time_to: DateTime;
  notes?: string;
}

/**
 * RunSliceAudit: "was the input slice sane"
 */
export interface RunSliceAudit {
  run_id: string;
  created_at: DateTime;
  token_count?: number;
  fetched_count: number;
  expected_count: number;
  min_ts: DateTime;
  max_ts: DateTime;
  dup_count: number;
  gap_count: number;
  alignment_ok: boolean; // 0 or 1 in DB, boolean in domain
}

/**
 * RunMetrics: "what happened"
 */
export interface RunMetrics {
  run_id: string;
  created_at: DateTime;
  roi: number;
  pnl_quote: number;
  max_drawdown: number;
  trades: number;
  win_rate: number;
  avg_hold_sec: number;
  fees_paid_quote: number;
  slippage_paid_quote?: number;
}

/**
 * Run status
 */
export type RunStatus = 'running' | 'success' | 'failed';

/**
 * Run with status (for queries)
 */
export interface RunWithStatus extends Run {
  status: RunStatus;
  finished_at?: DateTime;
}

/**
 * Leaderboard entry (run + metrics)
 */
export interface LeaderboardEntry {
  run_id: string;
  created_at: DateTime;
  strategy_id: string;
  interval_sec: number;
  roi: number;
  max_drawdown: number;
  trades: number;
  win_rate: number;
  pnl_quote: number;
}

/**
 * Run list filters
 */
export interface RunListFilters {
  strategy_id?: string;
  status?: RunStatus;
  from?: DateTime;
  to?: DateTime;
  limit?: number;
  offset?: number;
}

/**
 * Leaderboard filters
 */
export interface LeaderboardFilters {
  strategy_id?: string;
  interval_sec?: number;
  from?: DateTime;
  to?: DateTime;
  min_trades?: number;
  limit?: number;
}

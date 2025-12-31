/**
 * Run Orchestrator Interface
 *
 * Coordinates run creation, execution, and status tracking.
 * This is the application service that orchestrates the simulation workflow.
 */

import type { DateTime } from 'luxon';
import type { StrategyConfig } from '@quantbot/simulation/engine';
import type { FilterV1 } from '@quantbot/storage';
import type { SimulatorRunStatus } from '@quantbot/storage';

export interface CreateRunParams {
  strategy_id: string;
  filter_id: string;
  from_ts: DateTime;
  to_ts: DateTime;
  interval?: string; // e.g., '5m', '1m'
}

export interface RunSummary {
  run_id: string;
  strategy_id: string;
  filter_id: string;
  status: SimulatorRunStatus;
  summary_json: Record<string, unknown> | null;
  created_at: DateTime;
  finished_at: DateTime | null;
}

export interface TradeFilters {
  token?: string;
  limit?: number;
  offset?: number;
}

export interface Trade {
  run_id: string;
  token: string;
  trade_id: string;
  entry_ts: DateTime;
  exit_ts: DateTime;
  entry_price: number;
  exit_price: number;
  pnl_pct: number;
  exit_reason: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Run Orchestrator interface
 *
 * Coordinates the full lifecycle of simulation runs:
 * 1. Create run (planning, coverage check, slice materialization)
 * 2. Execute run (simulation execution)
 * 3. Get run status and results
 * 4. List trades
 */
export interface RunOrchestrator {
  /**
   * Create a new run
   * This performs planning, coverage check, and slice materialization.
   * Returns the run_id for the created run.
   */
  createRun(params: CreateRunParams): Promise<string>;

  /**
   * Execute a run
   * This runs the simulation and stores results.
   * Updates run status to 'complete' or 'failed'.
   */
  executeRun(runId: string): Promise<SimulatorRunStatus>;

  /**
   * Get run summary
   */
  getRun(runId: string): Promise<RunSummary>;

  /**
   * List trades for a run
   */
  listTrades(runId: string, filters?: TradeFilters): Promise<Page<Trade>>;
}

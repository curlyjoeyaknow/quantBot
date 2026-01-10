/**
 * RunRepository Port
 *
 * Interface for simulation run tracking.
 * Handlers depend on this port; adapters implement it.
 */

import type {
  Run,
  RunSliceAudit,
  RunMetrics,
  RunStatus,
  RunListFilters,
  LeaderboardFilters,
  LeaderboardEntry,
  RunWithStatus,
} from '@quantbot/core';

/**
 * RunRepository port interface
 */
export interface RunRepository {
  /**
   * Create a new run record
   */
  createRun(run: Run): Promise<void>;

  /**
   * Mark a run as finished (success or failed)
   */
  finishRun(run_id: string, status: RunStatus, finished_at: Date): Promise<void>;

  /**
   * Insert metrics for a run
   */
  insertMetrics(run_id: string, metrics: Omit<RunMetrics, 'run_id' | 'created_at'>): Promise<void>;

  /**
   * Insert slice audit for a run
   */
  insertSliceAudit(
    run_id: string,
    audit: Omit<RunSliceAudit, 'run_id' | 'created_at'>
  ): Promise<void>;

  /**
   * List runs with optional filters
   */
  listRuns(filters?: RunListFilters): Promise<RunWithStatus[]>;

  /**
   * Get leaderboard entries
   */
  leaderboard(filters?: LeaderboardFilters): Promise<LeaderboardEntry[]>;
}

/**
 * RunStatusRepository - DuckDB repository for backtest run status
 *
 * Tracks run status, configuration, and summary for lab API backtests.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type { DuckDbConnection } from '../../adapters/duckdb/duckdbClient.js';

export interface RunStatus {
  runId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  strategyId?: string;
  strategyVersion?: string;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  config?: unknown;
  summary?: {
    runId?: string;
    callsFound?: number;
    callsSucceeded?: number;
    callsFailed?: number;
    trades?: number;
    totalPnl?: number;
    maxDrawdown?: number;
    sharpeRatio?: number;
    winRate?: number;
  };
  error?: string;
}

export interface RunStatusInsertData {
  runId: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  strategyId?: string;
  strategyVersion?: string;
  config?: unknown;
  summary?: RunStatus['summary'];
  error?: string;
}

/**
 * DuckDB RunStatusRepository
 */
export class RunStatusRepository {
  private db: DuckDbConnection;

  constructor(db: DuckDbConnection) {
    this.db = db;
    this.initializeSchema();
  }

  /**
   * Initialize schema for run_status table
   */
  private async initializeSchema(): Promise<void> {
    try {
      await this.db.run(`
        CREATE TABLE IF NOT EXISTS run_status (
          run_id TEXT PRIMARY KEY,
          status TEXT NOT NULL,
          strategy_id TEXT,
          strategy_version TEXT,
          config_json TEXT,
          summary_json TEXT,
          error TEXT,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          started_at TIMESTAMP,
          completed_at TIMESTAMP
        )
      `);

      await this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_run_status_status ON run_status(status)
      `);

      await this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_run_status_strategy ON run_status(strategy_id)
      `);

      await this.db.run(`
        CREATE INDEX IF NOT EXISTS idx_run_status_created_at ON run_status(created_at)
      `);
    } catch (error) {
      logger.error('Failed to initialize run_status schema', error as Error);
      throw error;
    }
  }

  /**
   * Create or update run status
   */
  async upsert(data: RunStatusInsertData): Promise<void> {
    try {
      const configJson = data.config ? JSON.stringify(data.config) : null;
      const summaryJson = data.summary ? JSON.stringify(data.summary) : null;

      await this.db.run(
        `INSERT OR REPLACE INTO run_status 
         (run_id, status, strategy_id, strategy_version, config_json, summary_json, error, created_at, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, 
                 CASE WHEN ? = 'running' AND started_at IS NULL THEN CURRENT_TIMESTAMP ELSE started_at END,
                 CASE WHEN ? IN ('completed', 'failed') THEN CURRENT_TIMESTAMP ELSE completed_at END)`,
        [
          data.runId,
          data.status,
          data.strategyId || null,
          data.strategyVersion || null,
          configJson,
          summaryJson,
          data.error || null,
          data.status,
          data.status,
        ]
      );
    } catch (error) {
      logger.error('Failed to upsert run status', error as Error, { runId: data.runId });
      throw error;
    }
  }

  /**
   * Get run status by ID
   */
  async getById(runId: string): Promise<RunStatus | null> {
    try {
      const rows = await this.db.all<{
        run_id: string;
        status: string;
        strategy_id: string | null;
        strategy_version: string | null;
        config_json: string | null;
        summary_json: string | null;
        error: string | null;
        created_at: string;
        started_at: string | null;
        completed_at: string | null;
      }>(`SELECT * FROM run_status WHERE run_id = ? LIMIT 1`, [runId]);

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0]!;
      return {
        runId: row.run_id,
        status: row.status as RunStatus['status'],
        strategyId: row.strategy_id || undefined,
        strategyVersion: row.strategy_version || undefined,
        createdAt: row.created_at,
        startedAt: row.started_at || undefined,
        completedAt: row.completed_at || undefined,
        config: row.config_json ? JSON.parse(row.config_json) : undefined,
        summary: row.summary_json ? JSON.parse(row.summary_json) : undefined,
        error: row.error || undefined,
      };
    } catch (error) {
      logger.error('Failed to get run status', error as Error, { runId });
      throw error;
    }
  }

  /**
   * List runs with filters and pagination
   */
  async list(options: {
    status?: RunStatus['status'];
    strategyId?: string;
    limit?: number;
    cursor?: string;
  }): Promise<{ runs: RunStatus[]; nextCursor: string | null }> {
    try {
      const limit = options.limit || 50;
      const params: unknown[] = [];
      let sql = 'SELECT * FROM run_status WHERE 1=1';

      if (options.status) {
        sql += ' AND status = ?';
        params.push(options.status);
      }

      if (options.strategyId) {
        sql += ' AND strategy_id = ?';
        params.push(options.strategyId);
      }

      if (options.cursor) {
        sql += ' AND created_at < ?';
        params.push(options.cursor);
      }

      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(limit + 1); // Fetch one extra to check if there's more

      const rows = await this.db.all<{
        run_id: string;
        status: string;
        strategy_id: string | null;
        strategy_version: string | null;
        config_json: string | null;
        summary_json: string | null;
        error: string | null;
        created_at: string;
        started_at: string | null;
        completed_at: string | null;
      }>(sql, params);

      const hasMore = rows.length > limit;
      const runs = (hasMore ? rows.slice(0, limit) : rows).map((row) => ({
        runId: row.run_id,
        status: row.status as RunStatus['status'],
        strategyId: row.strategy_id || undefined,
        strategyVersion: row.strategy_version || undefined,
        createdAt: row.created_at,
        startedAt: row.started_at || undefined,
        completedAt: row.completed_at || undefined,
        config: row.config_json ? JSON.parse(row.config_json) : undefined,
        summary: row.summary_json ? JSON.parse(row.summary_json) : undefined,
        error: row.error || undefined,
      }));

      const nextCursor =
        hasMore && runs.length > 0 ? runs[runs.length - 1]!.createdAt : null;

      return { runs, nextCursor };
    } catch (error) {
      logger.error('Failed to list run statuses', error as Error);
      throw error;
    }
  }

  /**
   * Update run status
   */
  async updateStatus(
    runId: string,
    status: RunStatus['status'],
    summary?: RunStatus['summary'],
    error?: string
  ): Promise<void> {
    try {
      const summaryJson = summary ? JSON.stringify(summary) : null;
      const updates: string[] = ['status = ?'];
      const params: unknown[] = [status];

      if (status === 'running') {
        updates.push('started_at = COALESCE(started_at, CURRENT_TIMESTAMP)');
      }

      if (status === 'completed' || status === 'failed') {
        updates.push('completed_at = CURRENT_TIMESTAMP');
      }

      if (summaryJson !== null) {
        updates.push('summary_json = ?');
        params.push(summaryJson);
      }

      if (error !== undefined) {
        updates.push('error = ?');
        params.push(error);
      }

      params.push(runId);

      await this.db.run(
        `UPDATE run_status SET ${updates.join(', ')} WHERE run_id = ?`,
        params
      );
    } catch (error) {
      logger.error('Failed to update run status', error as Error, { runId, status });
      throw error;
    }
  }
}


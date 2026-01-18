/**
 * RunRepository - ClickHouse implementation
 *
 * Stores simulation run tracking data in ClickHouse.
 */

import { DateTime } from 'luxon';
import { getClickHouseClient } from '../../clickhouse-client.js';
import { logger } from '@quantbot/infra/utils';
import type { RunRepository as IRunRepository } from '../../ports/RunRepositoryPort.js';
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
 * ClickHouse RunRepository implementation
 */
export class RunRepository implements IRunRepository {
  private ch = getClickHouseClient();
  private database = process.env.CLICKHOUSE_DATABASE || 'quantbot';

  /**
   * Initialize schema (call this once on startup)
   */
  async initializeSchema(): Promise<void> {
    // Schema is created by bootstrap script, but we can verify it exists
    // This is a no-op if tables already exist
    logger.debug('RunRepository schema should be initialized via bootstrap script');
  }

  /**
   * Create a new run record
   */
  async createRun(run: Run): Promise<void> {
    try {
      const row = {
        run_id: run.run_id,
        created_at: run.created_at.toISO(),
        git_sha: run.git_sha || '',
        engine_version: run.engine_version || '',
        strategy_id: run.strategy_id,
        params_json: run.params_json,
        interval_sec: run.interval_sec,
        time_from: run.time_from.toISO(),
        time_to: run.time_to.toISO(),
        universe_ref: run.universe_ref || '',
        notes: run.notes || '',
        status: 'running',
        finished_at: '1970-01-01T00:00:00.000Z', // Default zero timestamp
      };

      await this.ch.insert({
        table: `${this.database}.sim_runs`,
        values: [row],
        format: 'JSONEachRow',
      });

      logger.debug('Created run record', { run_id: run.run_id, strategy_id: run.strategy_id });
    } catch (error) {
      logger.error('Failed to create run record', error as Error, { run_id: run.run_id });
      throw error;
    }
  }

  /**
   * Mark a run as finished
   */
  async finishRun(run_id: string, status: RunStatus, finished_at: Date): Promise<void> {
    try {
      await this.ch.exec({
        query: `
          ALTER TABLE ${this.database}.sim_runs
          UPDATE
            status = {status:String},
            finished_at = {finished_at:DateTime64(3, 'UTC')}
          WHERE run_id = {run_id:UUID}
        `,
        query_params: {
          run_id,
          status,
          finished_at: DateTime.fromJSDate(finished_at).toISO(),
        },
      });

      logger.debug('Finished run', { run_id, status });
    } catch (error) {
      logger.error('Failed to finish run', error as Error, { run_id });
      throw error;
    }
  }

  /**
   * Insert metrics for a run
   */
  async insertMetrics(
    run_id: string,
    metrics: Omit<RunMetrics, 'run_id' | 'created_at'>
  ): Promise<void> {
    try {
      const row = {
        run_id,
        created_at: DateTime.utc().toISO(),
        roi: metrics.roi,
        pnl_quote: metrics.pnl_quote,
        max_drawdown: metrics.max_drawdown,
        trades: metrics.trades,
        win_rate: metrics.win_rate,
        avg_hold_sec: metrics.avg_hold_sec,
        fees_paid_quote: metrics.fees_paid_quote,
        slippage_paid_quote: metrics.slippage_paid_quote || 0,
      };

      await this.ch.insert({
        table: `${this.database}.sim_run_metrics`,
        values: [row],
        format: 'JSONEachRow',
      });

      logger.debug('Inserted run metrics', { run_id, trades: metrics.trades, roi: metrics.roi });
    } catch (error) {
      logger.error('Failed to insert run metrics', error as Error, { run_id });
      throw error;
    }
  }

  /**
   * Insert slice audit for a run
   */
  async insertSliceAudit(
    run_id: string,
    audit: Omit<RunSliceAudit, 'run_id' | 'created_at'>
  ): Promise<void> {
    try {
      const row = {
        run_id,
        created_at: DateTime.utc().toISO(),
        token_count: audit.token_count || 0,
        fetched_count: audit.fetched_count,
        expected_count: audit.expected_count,
        min_ts: audit.min_ts.toISO(),
        max_ts: audit.max_ts.toISO(),
        dup_count: audit.dup_count,
        gap_count: audit.gap_count,
        alignment_ok: audit.alignment_ok ? 1 : 0,
      };

      await this.ch.insert({
        table: `${this.database}.sim_run_slice_audit`,
        values: [row],
        format: 'JSONEachRow',
      });

      logger.debug('Inserted slice audit', {
        run_id,
        fetched_count: audit.fetched_count,
        expected_count: audit.expected_count,
      });
    } catch (error) {
      logger.error('Failed to insert slice audit', error as Error, { run_id });
      throw error;
    }
  }

  /**
   * List runs with optional filters
   */
  async listRuns(filters?: RunListFilters): Promise<RunWithStatus[]> {
    try {
      const limit = filters?.limit || 100;
      const offset = filters?.offset || 0;
      const params: Record<string, unknown> = { limit, offset };

      let sql = `
        SELECT
          run_id,
          created_at,
          finished_at,
          status,
          git_sha,
          engine_version,
          strategy_id,
          params_json,
          interval_sec,
          time_from,
          time_to,
          universe_ref,
          notes
        FROM ${this.database}.sim_runs
        WHERE 1=1
      `;

      if (filters?.strategy_id) {
        sql += ' AND strategy_id = {strategy_id:String}';
        params.strategy_id = filters.strategy_id;
      }

      if (filters?.status) {
        sql += ' AND status = {status:String}';
        params.status = filters.status;
      }

      if (filters?.from) {
        sql += " AND created_at >= {from:DateTime64(3, 'UTC')}";
        params.from = filters.from.toISO();
      }

      if (filters?.to) {
        sql += " AND created_at <= {to:DateTime64(3, 'UTC')}";
        params.to = filters.to.toISO();
      }

      sql += ' ORDER BY created_at DESC LIMIT {limit:UInt32} OFFSET {offset:UInt32}';

      const result = await this.ch.query({
        query: sql,
        query_params: params,
        format: 'JSONEachRow',
      });

      const rows = (await result.json()) as Array<{
        run_id: string;
        created_at: string;
        finished_at: string;
        status: string;
        git_sha: string;
        engine_version: string;
        strategy_id: string;
        params_json: string;
        interval_sec: number;
        time_from: string;
        time_to: string;
        universe_ref: string;
        notes: string;
      }>;

      return rows.map((row) => ({
        run_id: row.run_id,
        created_at: DateTime.fromISO(row.created_at),
        finished_at:
          row.finished_at && row.finished_at !== '1970-01-01T00:00:00.000Z'
            ? DateTime.fromISO(row.finished_at)
            : undefined,
        status: row.status as RunStatus,
        git_sha: row.git_sha || undefined,
        engine_version: row.engine_version || undefined,
        strategy_id: row.strategy_id,
        params_json: row.params_json,
        interval_sec: row.interval_sec,
        time_from: DateTime.fromISO(row.time_from),
        time_to: DateTime.fromISO(row.time_to),
        universe_ref: row.universe_ref || undefined,
        notes: row.notes || undefined,
      }));
    } catch (error) {
      logger.error('Failed to list runs', error as Error);
      throw error;
    }
  }

  /**
   * Get leaderboard entries
   */
  async leaderboard(filters?: LeaderboardFilters): Promise<LeaderboardEntry[]> {
    try {
      const limit = filters?.limit || 50;
      const params: Record<string, unknown> = { limit };

      let sql = `
        SELECT
          r.created_at,
          r.run_id,
          r.strategy_id,
          r.interval_sec,
          m.roi,
          m.max_drawdown,
          m.trades,
          m.win_rate,
          m.pnl_quote
        FROM ${this.database}.sim_run_metrics m
        INNER JOIN ${this.database}.sim_runs r USING (run_id)
        WHERE 1=1
      `;

      if (filters?.strategy_id) {
        sql += ' AND r.strategy_id = {strategy_id:String}';
        params.strategy_id = filters.strategy_id;
      }

      if (filters?.interval_sec) {
        sql += ' AND r.interval_sec = {interval_sec:UInt32}';
        params.interval_sec = filters.interval_sec;
      }

      if (filters?.from) {
        sql += " AND r.created_at >= {from:DateTime64(3, 'UTC')}";
        params.from = filters.from.toISO();
      }

      if (filters?.to) {
        sql += " AND r.created_at <= {to:DateTime64(3, 'UTC')}";
        params.to = filters.to.toISO();
      }

      if (filters?.min_trades) {
        sql += ' AND m.trades >= {min_trades:UInt32}';
        params.min_trades = filters.min_trades;
      }

      sql += ' ORDER BY m.roi DESC LIMIT {limit:UInt32}';

      const result = await this.ch.query({
        query: sql,
        query_params: params,
        format: 'JSONEachRow',
      });

      const rows = (await result.json()) as Array<{
        created_at: string;
        run_id: string;
        strategy_id: string;
        interval_sec: number;
        roi: number;
        max_drawdown: number;
        trades: number;
        win_rate: number;
        pnl_quote: number;
      }>;

      return rows.map((row) => ({
        run_id: row.run_id,
        created_at: DateTime.fromISO(row.created_at),
        strategy_id: row.strategy_id,
        interval_sec: row.interval_sec,
        roi: row.roi,
        max_drawdown: row.max_drawdown,
        trades: row.trades,
        win_rate: row.win_rate,
        pnl_quote: row.pnl_quote,
      }));
    } catch (error) {
      logger.error('Failed to get leaderboard', error as Error);
      throw error;
    }
  }
}

/**
 * RunLogRepository - ClickHouse repository for backtest run logs
 *
 * Stores time-series log data for lab API backtests.
 */

import { DateTime } from 'luxon';
import { getClickHouseClient } from '../../clickhouse-client.js';
import { logger } from '@quantbot/utils';

export interface RunLog {
  runId: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  data?: unknown;
}

export interface RunLogInsertData {
  runId: string;
  level: RunLog['level'];
  message: string;
  data?: unknown;
}

/**
 * ClickHouse RunLogRepository
 */
export class RunLogRepository {
  private ch = getClickHouseClient();
  private database = process.env.CLICKHOUSE_DATABASE || 'quantbot';

  /**
   * Initialize schema for run_logs table
   */
  async initializeSchema(): Promise<void> {
    try {
      await this.ch.exec({
        query: `
          CREATE TABLE IF NOT EXISTS ${this.database}.run_logs (
            run_id String,
            timestamp DateTime,
            level LowCardinality(String),
            message String,
            data_json String,
            created_at DateTime DEFAULT now()
          )
          ENGINE = MergeTree()
          PARTITION BY toYYYYMM(timestamp)
          ORDER BY (run_id, timestamp)
          SETTINGS index_granularity = 8192
        `,
      });
    } catch (error) {
      logger.error('Failed to initialize run_logs schema', error as Error);
      throw error;
    }
  }

  /**
   * Insert a log entry
   */
  async insert(data: RunLogInsertData): Promise<void> {
    try {
      const row = {
        run_id: data.runId,
        timestamp: DateTime.utc().toFormat('yyyy-MM-dd HH:mm:ss'),
        level: data.level,
        message: data.message,
        data_json: data.data ? JSON.stringify(data.data) : '',
      };

      await this.ch.insert({
        table: `${this.database}.run_logs`,
        values: [row],
        format: 'JSONEachRow',
      });
    } catch (error) {
      logger.error('Failed to insert run log', error as Error, { runId: data.runId });
      throw error;
    }
  }

  /**
   * Insert multiple log entries
   */
  async insertMany(logs: RunLogInsertData[]): Promise<void> {
    if (logs.length === 0) {
      return;
    }

    try {
      const rows = logs.map((log) => ({
        run_id: log.runId,
        timestamp: DateTime.utc().toFormat('yyyy-MM-dd HH:mm:ss'),
        level: log.level,
        message: log.message,
        data_json: log.data ? JSON.stringify(log.data) : '',
      }));

      await this.ch.insert({
        table: `${this.database}.run_logs`,
        values: rows,
        format: 'JSONEachRow',
      });
    } catch (error) {
      logger.error('Failed to insert run logs', error as Error, { count: logs.length });
      throw error;
    }
  }

  /**
   * Get logs for a run with pagination
   */
  async getByRunId(
    runId: string,
    options?: {
      limit?: number;
      cursor?: string; // timestamp cursor
      level?: RunLog['level'];
    }
  ): Promise<{ logs: RunLog[]; nextCursor: string | null }> {
    try {
      const limit = options?.limit || 100;
      const params: Record<string, unknown> = { runId };
      let sql = `
        SELECT 
          run_id,
          timestamp,
          level,
          message,
          data_json
        FROM ${this.database}.run_logs
        WHERE run_id = {runId:String}
      `;

      if (options?.level) {
        sql += ' AND level = {level:String}';
        params.level = options.level;
      }

      if (options?.cursor) {
        sql += ' AND timestamp < {cursor:DateTime}';
        params.cursor = options.cursor;
      }

      sql += ' ORDER BY timestamp DESC LIMIT {limit:UInt32}';
      params.limit = limit + 1; // Fetch one extra to check if there's more

      const result = await this.ch.query({
        query: sql,
        query_params: params,
        format: 'JSONEachRow',
      });

      const rows = (await result.json()) as Array<{
        run_id: string;
        timestamp: string;
        level: string;
        message: string;
        data_json: string;
      }>;

      const hasMore = rows.length > limit;
      const logs = (hasMore ? rows.slice(0, limit) : rows)
        .map((row) => ({
          runId: row.run_id,
          timestamp: row.timestamp,
          level: row.level as RunLog['level'],
          message: row.message,
          data: row.data_json ? JSON.parse(row.data_json) : undefined,
        }))
        .reverse(); // Reverse to get chronological order (oldest first)

      const nextCursor = hasMore && logs.length > 0 ? logs[logs.length - 1]!.timestamp : null;

      return { logs, nextCursor };
    } catch (error) {
      logger.error('Failed to get run logs', error as Error, { runId });
      throw error;
    }
  }

  /**
   * Get logs for multiple runs
   */
  async getByRunIds(
    runIds: string[],
    options?: {
      limit?: number;
      level?: RunLog['level'];
    }
  ): Promise<RunLog[]> {
    if (runIds.length === 0) {
      return [];
    }

    try {
      const limit = options?.limit || 1000;
      const params: Record<string, unknown> = { runIds };
      let sql = `
        SELECT 
          run_id,
          timestamp,
          level,
          message,
          data_json
        FROM ${this.database}.run_logs
        WHERE run_id IN {runIds:Array(String)}
      `;

      if (options?.level) {
        sql += ' AND level = {level:String}';
        params.level = options.level;
      }

      sql += ' ORDER BY timestamp DESC LIMIT {limit:UInt32}';
      params.limit = limit;

      const result = await this.ch.query({
        query: sql,
        query_params: params,
        format: 'JSONEachRow',
      });

      const rows = (await result.json()) as Array<{
        run_id: string;
        timestamp: string;
        level: string;
        message: string;
        data_json: string;
      }>;

      return rows.map((row) => ({
        runId: row.run_id,
        timestamp: row.timestamp,
        level: row.level as RunLog['level'],
        message: row.message,
        data: row.data_json ? JSON.parse(row.data_json) : undefined,
      }));
    } catch (error) {
      logger.error('Failed to get run logs for multiple runs', error as Error);
      throw error;
    }
  }
}

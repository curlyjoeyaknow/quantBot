/**
 * RunTradesRepository - DuckDB repository for run trades
 *
 * Handles all database operations for run_trades table.
 */

import { DateTime } from 'luxon';
import { logger, DatabaseError, findWorkspaceRoot } from '@quantbot/utils';
import { join } from 'path';
import { z } from 'zod';
import { DuckDBClient } from '../duckdb-client.js';

export interface TradeInsertData {
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

export interface TradeRecord {
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

/**
 * DuckDB RunTradesRepository
 */
export class RunTradesRepository {
  private client: DuckDBClient;
  private scriptPath: string;

  constructor(dbPath: string, client?: DuckDBClient) {
    this.client = client || new DuckDBClient(dbPath);
    const workspaceRoot = findWorkspaceRoot();
    this.scriptPath = join(workspaceRoot, 'tools/storage/duckdb_run_trades.py');
  }

  /**
   * Initialize DuckDB database and schema
   */
  private async initializeDatabase(): Promise<void> {
    try {
      await this.client.initSchema(this.scriptPath);
      logger.info('RunTradesRepository database initialized', { dbPath: this.client.getDbPath() });
    } catch (error) {
      logger.error('Failed to initialize RunTradesRepository database', error as Error, {
        dbPath: this.client.getDbPath(),
      });
      throw new DatabaseError(
        'RunTradesRepository database initialization failed',
        'initializeDatabase',
        {
          dbPath: this.client.getDbPath(),
          originalError: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        }
      );
    }
  }

  /**
   * Insert multiple trades
   */
  async insertMany(trades: TradeInsertData[]): Promise<void> {
    try {
      const resultSchema = z.object({
        success: z.boolean(),
        error: z.string().optional(),
        count: z.number().optional(),
      });

      const tradesData = trades.map((trade) => ({
        run_id: trade.run_id,
        token: trade.token,
        trade_id: trade.trade_id,
        entry_ts: trade.entry_ts.toISO(),
        exit_ts: trade.exit_ts.toISO(),
        entry_price: trade.entry_price,
        exit_price: trade.exit_price,
        pnl_pct: trade.pnl_pct,
        exit_reason: trade.exit_reason,
      }));

      const result = await this.client.execute(
        this.scriptPath,
        'insert_many',
        {
          data: JSON.stringify(tradesData),
        },
        resultSchema
      );

      if (!result.success) {
        throw new DatabaseError(
          `Failed to insert trades: ${result.error || 'Unknown error'}`,
          'insertMany',
          { count: trades.length }
        );
      }
    } catch (error) {
      logger.error('Failed to insert trades', error as Error, { count: trades.length });
      throw error;
    }
  }

  /**
   * List trades for a run
   */
  async listByRunId(runId: string, limit: number = 1000): Promise<TradeRecord[]> {
    try {
      const resultSchema = z.object({
        trades: z.array(
          z.object({
            run_id: z.string(),
            token: z.string(),
            trade_id: z.string(),
            entry_ts: z.string(),
            exit_ts: z.string(),
            entry_price: z.number(),
            exit_price: z.number(),
            pnl_pct: z.number(),
            exit_reason: z.string(),
          })
        ),
      });

      const result = await this.client.execute(
        this.scriptPath,
        'list_by_run_id',
        {
          run_id: runId,
          limit,
        },
        resultSchema
      );

      if (!result || !result.trades) {
        return [];
      }

      return result.trades.map((row) => ({
        run_id: row.run_id,
        token: row.token,
        trade_id: row.trade_id,
        entry_ts: DateTime.fromISO(row.entry_ts),
        exit_ts: DateTime.fromISO(row.exit_ts),
        entry_price: row.entry_price,
        exit_price: row.exit_price,
        pnl_pct: row.pnl_pct,
        exit_reason: row.exit_reason,
      }));
    } catch (error) {
      logger.error('Failed to list trades by run ID', error as Error, { runId });
      throw error;
    }
  }

  /**
   * List trades for a token
   */
  async listByToken(token: string, limit: number = 1000): Promise<TradeRecord[]> {
    try {
      const resultSchema = z.object({
        trades: z.array(
          z.object({
            run_id: z.string(),
            token: z.string(),
            trade_id: z.string(),
            entry_ts: z.string(),
            exit_ts: z.string(),
            entry_price: z.number(),
            exit_price: z.number(),
            pnl_pct: z.number(),
            exit_reason: z.string(),
          })
        ),
      });

      const result = await this.client.execute(
        this.scriptPath,
        'list_by_token',
        {
          token,
          limit,
        },
        resultSchema
      );

      if (!result || !result.trades) {
        return [];
      }

      return result.trades.map((row) => ({
        run_id: row.run_id,
        token: row.token,
        trade_id: row.trade_id,
        entry_ts: DateTime.fromISO(row.entry_ts),
        exit_ts: DateTime.fromISO(row.exit_ts),
        entry_price: row.entry_price,
        exit_price: row.exit_price,
        pnl_pct: row.pnl_pct,
        exit_reason: row.exit_reason,
      }));
    } catch (error) {
      logger.error('Failed to list trades by token', error as Error, { token });
      throw error;
    }
  }
}

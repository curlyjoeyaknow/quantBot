/**
 * RunsRepository - DuckDB repository for backtest runs
 *
 * Handles all database operations for runs table.
 * These runs represent deterministic backtests (replay over historical data).
 */

import { DateTime } from 'luxon';
import { logger, DatabaseError, findWorkspaceRoot } from '@quantbot/utils';
import { join } from 'path';
import { z } from 'zod';
import { DuckDBClient } from '../duckdb-client.js';

export type SimulatorRunStatus =
  | 'pending'
  | 'running'
  | 'complete'
  | 'complete_partial_universe'
  | 'failed_preflight'
  | 'failed';

export interface RunInsertData {
  run_id: string;
  strategy_id: string;
  filter_id: string;
  status?: SimulatorRunStatus;
  summary_json?: Record<string, unknown>;
}

export interface RunUpdateData {
  status?: SimulatorRunStatus;
  summary_json?: Record<string, unknown>;
  finished_at?: DateTime;
}

export interface RunRecord {
  run_id: string;
  strategy_id: string;
  filter_id: string;
  status: SimulatorRunStatus;
  summary_json: Record<string, unknown> | null;
  created_at: DateTime;
  finished_at: DateTime | null;
}

/**
 * DuckDB RunsRepository
 */
export class RunsRepository {
  private client: DuckDBClient;
  private scriptPath: string;

  constructor(dbPath: string, client?: DuckDBClient) {
    this.client = client || new DuckDBClient(dbPath);
    const workspaceRoot = findWorkspaceRoot();
    this.scriptPath = join(workspaceRoot, 'tools/storage/duckdb_runs.py');
  }

  /**
   * Initialize DuckDB database and schema
   */
  private async initializeDatabase(): Promise<void> {
    try {
      await this.client.initSchema(this.scriptPath);
      logger.info('RunsRepository database initialized', { dbPath: this.client.getDbPath() });
    } catch (error) {
      logger.error('Failed to initialize RunsRepository database', error as Error, {
        dbPath: this.client.getDbPath(),
      });
      throw new DatabaseError(
        'RunsRepository database initialization failed',
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
   * Find run by ID
   */
  async findById(runId: string): Promise<RunRecord | null> {
    try {
      const resultSchema = z
        .object({
          run_id: z.string(),
          strategy_id: z.string(),
          filter_id: z.string(),
          status: z.string(),
          summary_json: z.record(z.string(), z.unknown()).nullable(),
          created_at: z.string(),
          finished_at: z.string().nullable(),
        })
        .nullable();

      const result = await this.client.execute(
        this.scriptPath,
        'find_by_id',
        { run_id: runId },
        resultSchema
      );

      if (!result) {
        return null;
      }

      return {
        run_id: result.run_id,
        strategy_id: result.strategy_id,
        filter_id: result.filter_id,
        status: result.status as SimulatorRunStatus,
        summary_json: result.summary_json,
        created_at: DateTime.fromISO(result.created_at),
        finished_at: result.finished_at ? DateTime.fromISO(result.finished_at) : null,
      };
    } catch (error) {
      logger.error('Failed to find run by ID', error as Error, { runId });
      throw error;
    }
  }

  /**
   * List runs with optional filters
   */
  async list(options?: {
    strategy_id?: string;
    status?: SimulatorRunStatus;
    limit?: number;
  }): Promise<RunRecord[]> {
    try {
      const resultSchema = z.object({
        runs: z.array(
          z.object({
            run_id: z.string(),
            strategy_id: z.string(),
            filter_id: z.string(),
            status: z.string(),
            summary_json: z.record(z.string(), z.unknown()).nullable(),
            created_at: z.string(),
            finished_at: z.string().nullable(),
          })
        ),
      });

      const params: Record<string, unknown> = {};
      if (options?.strategy_id) {
        params.strategy_id = options.strategy_id;
      }
      if (options?.status) {
        params.status = options.status;
      }
      params.limit = options?.limit || 100;

      const result = await this.client.execute(this.scriptPath, 'list', params, resultSchema);

      if (!result || !result.runs) {
        return [];
      }

      return result.runs.map((row) => ({
        run_id: row.run_id,
        strategy_id: row.strategy_id,
        filter_id: row.filter_id,
        status: row.status as SimulatorRunStatus,
        summary_json: row.summary_json,
        created_at: DateTime.fromISO(row.created_at),
        finished_at: row.finished_at ? DateTime.fromISO(row.finished_at) : null,
      }));
    } catch (error) {
      logger.error('Failed to list runs', error as Error);
      throw error;
    }
  }

  /**
   * Create a new run
   */
  async create(data: RunInsertData): Promise<void> {
    try {
      const resultSchema = z.object({
        success: z.boolean(),
        error: z.string().optional(),
        run_id: z.string().optional(),
      });

      const result = await this.client.execute(
        this.scriptPath,
        'create',
        {
          data: JSON.stringify({
            run_id: data.run_id,
            strategy_id: data.strategy_id,
            filter_id: data.filter_id,
            status: data.status || 'pending',
            summary_json: data.summary_json,
          }),
        },
        resultSchema
      );

      if (!result.success) {
        throw new DatabaseError(
          `Failed to create run: ${result.error || 'Unknown error'}`,
          'create',
          { runId: data.run_id }
        );
      }
    } catch (error) {
      logger.error('Failed to create run', error as Error, { runId: data.run_id });
      throw error;
    }
  }

  /**
   * Update a run
   */
  async update(runId: string, data: RunUpdateData): Promise<void> {
    try {
      const resultSchema = z.object({
        success: z.boolean(),
        error: z.string().optional(),
        message: z.string().optional(),
      });

      const updateData: Record<string, unknown> = {};
      if (data.status !== undefined) {
        updateData.status = data.status;
      }
      if (data.summary_json !== undefined) {
        updateData.summary_json = data.summary_json;
      }
      if (data.finished_at !== undefined) {
        updateData.finished_at = data.finished_at.toISO();
      }

      const result = await this.client.execute(
        this.scriptPath,
        'update',
        {
          run_id: runId,
          data: JSON.stringify(updateData),
        },
        resultSchema
      );

      if (!result.success) {
        throw new DatabaseError(
          `Failed to update run: ${result.error || 'Unknown error'}`,
          'update',
          { runId }
        );
      }
    } catch (error) {
      logger.error('Failed to update run', error as Error, { runId });
      throw error;
    }
  }
}

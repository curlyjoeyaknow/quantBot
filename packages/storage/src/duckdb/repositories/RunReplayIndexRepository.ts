/**
 * RunReplayIndexRepository - DuckDB repository for replay index
 *
 * Handles all database operations for run_replay_index table.
 */

import { logger, DatabaseError, findWorkspaceRoot } from '@quantbot/utils';
import { join } from 'path';
import { z } from 'zod';
import { DuckDBClient } from '../duckdb-client.js';

export interface ReplayIndexInsertData {
  run_id: string;
  token: string;
  path: string;
  frame_count: number;
}

export interface ReplayIndexRecord {
  run_id: string;
  token: string;
  path: string;
  frame_count: number;
}

/**
 * DuckDB RunReplayIndexRepository
 */
export class RunReplayIndexRepository {
  private client: DuckDBClient;
  private scriptPath: string;

  constructor(dbPath: string, client?: DuckDBClient) {
    this.client = client || new DuckDBClient(dbPath);
    const workspaceRoot = findWorkspaceRoot();
    this.scriptPath = join(workspaceRoot, 'tools/storage/duckdb_run_replay_index.py');
  }

  /**
   * Initialize DuckDB database and schema
   */
  private async initializeDatabase(): Promise<void> {
    try {
      await this.client.initSchema(this.scriptPath);
      logger.info('RunReplayIndexRepository database initialized', {
        dbPath: this.client.getDbPath(),
      });
    } catch (error) {
      logger.error('Failed to initialize RunReplayIndexRepository database', error as Error, {
        dbPath: this.client.getDbPath(),
      });
      throw new DatabaseError(
        'RunReplayIndexRepository database initialization failed',
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
   * Upsert replay index entry
   */
  async upsert(data: ReplayIndexInsertData): Promise<void> {
    try {
      const resultSchema = z.object({
        success: z.boolean(),
        error: z.string().optional(),
      });

      const result = await this.client.execute(
        this.scriptPath,
        'upsert',
        {
          data: JSON.stringify({
            run_id: data.run_id,
            token: data.token,
            path: data.path,
            frame_count: data.frame_count,
          }),
        },
        resultSchema
      );

      if (!result.success) {
        throw new DatabaseError(
          `Failed to upsert replay index: ${result.error || 'Unknown error'}`,
          'upsert',
          { runId: data.run_id, token: data.token }
        );
      }
    } catch (error) {
      logger.error('Failed to upsert replay index', error as Error, {
        runId: data.run_id,
        token: data.token,
      });
      throw error;
    }
  }

  /**
   * Find replay index entry by run_id and token
   */
  async findByRunAndToken(runId: string, token: string): Promise<ReplayIndexRecord | null> {
    try {
      const resultSchema = z
        .object({
          run_id: z.string(),
          token: z.string(),
          path: z.string(),
          frame_count: z.number(),
        })
        .nullable();

      const result = await this.client.execute(
        this.scriptPath,
        'find_by_run_and_token',
        {
          run_id: runId,
          token,
        },
        resultSchema
      );

      if (!result) {
        return null;
      }

      return {
        run_id: result.run_id,
        token: result.token,
        path: result.path,
        frame_count: result.frame_count,
      };
    } catch (error) {
      logger.error('Failed to find replay index by run and token', error as Error, {
        runId,
        token,
      });
      throw error;
    }
  }

  /**
   * List all replay index entries for a run
   */
  async listByRunId(runId: string): Promise<ReplayIndexRecord[]> {
    try {
      const resultSchema = z.object({
        entries: z.array(
          z.object({
            run_id: z.string(),
            token: z.string(),
            path: z.string(),
            frame_count: z.number(),
          })
        ),
      });

      const result = await this.client.execute(
        this.scriptPath,
        'list_by_run_id',
        {
          run_id: runId,
        },
        resultSchema
      );

      if (!result || !result.entries) {
        return [];
      }

      return result.entries;
    } catch (error) {
      logger.error('Failed to list replay index by run ID', error as Error, { runId });
      throw error;
    }
  }
}

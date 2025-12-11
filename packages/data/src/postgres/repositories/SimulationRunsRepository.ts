/**
 * SimulationRunsRepository - Postgres repository for simulation runs
 * 
 * Handles all database operations for simulation_runs table.
 */

import { DateTime } from 'luxon';
import { getPostgresPool } from '../../postgres-client';
import { logger } from '@quantbot/utils';

export interface SimulationRun {
  id: number;
  strategyId?: number;
  tokenId?: number;
  callerId?: number;
  runType: string;
  engineVersion: string;
  configHash: string;
  config: Record<string, unknown>;
  dataSelection: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed';
  startedAt?: DateTime;
  completedAt?: DateTime;
  errorMessage?: string;
  createdAt: DateTime;
}

export interface SimulationRunInsertData {
  strategyId?: number;
  tokenId?: number;
  callerId?: number;
  runType: string;
  engineVersion: string;
  configHash: string;
  config: Record<string, unknown>;
  dataSelection: Record<string, unknown>;
  status?: 'pending' | 'running' | 'completed' | 'failed';
}

export class SimulationRunsRepository {
  /**
   * Create a new simulation run
   */
  async createRun(data: SimulationRunInsertData): Promise<number> {
    const status = data.status || 'pending';
    const result = await getPostgresPool().query<{ id: number }>(
      `INSERT INTO simulation_runs (
        strategy_id, token_id, caller_id, run_type, engine_version,
        config_hash, config_json, data_selection_json, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id`,
      [
        data.strategyId || null,
        data.tokenId || null,
        data.callerId || null,
        data.runType,
        data.engineVersion,
        data.configHash,
        JSON.stringify(data.config),
        JSON.stringify(data.dataSelection),
        status,
      ]
    );

    const runId = result.rows[0].id;
    logger.info('Created simulation run', { runId, runType: data.runType, status });
    return runId;
  }

  /**
   * Update simulation run status
   */
  async updateStatus(
    runId: number,
    status: 'pending' | 'running' | 'completed' | 'failed',
    errorMessage?: string
  ): Promise<void> {
    const updates: string[] = ['status = $2'];
    const params: unknown[] = [runId, status];
    let paramIndex = 3;

    if (status === 'running') {
      updates.push(`started_at = NOW()`);
    }

    if (status === 'completed' || status === 'failed') {
      updates.push(`completed_at = NOW()`);
    }

    if (errorMessage) {
      updates.push(`error_message = $${paramIndex}`);
      params.push(errorMessage);
      paramIndex++;
    }

    await getPostgresPool().query(
      `UPDATE simulation_runs
       SET ${updates.join(', ')}
       WHERE id = $1`,
      params
    );

    logger.debug('Updated simulation run status', { runId, status });
  }

  /**
   * Find simulation run by ID
   */
  async findById(runId: number): Promise<SimulationRun | null> {
    const result = await getPostgresPool().query<{
      id: number;
      strategy_id: number | null;
      token_id: number | null;
      caller_id: number | null;
      run_type: string;
      engine_version: string;
      config_hash: string;
      config_json: Record<string, unknown>;
      data_selection_json: Record<string, unknown>;
      status: string;
      started_at: Date | null;
      completed_at: Date | null;
      error_message: string | null;
      created_at: Date;
    }>(
      `SELECT id, strategy_id, token_id, caller_id, run_type, engine_version,
              config_hash, config_json, data_selection_json, status,
              started_at, completed_at, error_message, created_at
       FROM simulation_runs
       WHERE id = $1`,
      [runId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      strategyId: row.strategy_id || undefined,
      tokenId: row.token_id || undefined,
      callerId: row.caller_id || undefined,
      runType: row.run_type,
      engineVersion: row.engine_version,
      configHash: row.config_hash,
      config: row.config_json,
      dataSelection: row.data_selection_json,
      status: row.status as 'pending' | 'running' | 'completed' | 'failed',
      startedAt: row.started_at ? DateTime.fromJSDate(row.started_at) : undefined,
      completedAt: row.completed_at ? DateTime.fromJSDate(row.completed_at) : undefined,
      errorMessage: row.error_message || undefined,
      createdAt: DateTime.fromJSDate(row.created_at),
    };
  }
}


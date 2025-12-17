/**
 * SimulationRunsRepository - Postgres repository for simulation runs
 *
 * Handles all database operations for simulation_runs table.
 */

import { DateTime } from 'luxon';
import { getPostgresPool } from '../postgres-client';
import { logger, DatabaseError } from '@quantbot/utils';

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
        data.strategyId ?? null,
        data.tokenId ?? null,
        data.callerId ?? null,
        data.runType,
        data.engineVersion,
        data.configHash,
        JSON.stringify(data.config),
        JSON.stringify(data.dataSelection),
        status,
      ]
    );

    if (result.rows.length === 0) {
      throw new DatabaseError('Failed to create simulation run', 'createRun', {
        data,
      });
    }

    return result.rows[0].id;
  }

  /**
   * Get simulation run by ID
   */
  async getRunById(id: number): Promise<SimulationRun | null> {
    const result = await getPostgresPool().query<{
      id: number;
      strategy_id: number | null;
      token_id: number | null;
      caller_id: number | null;
      run_type: string;
      engine_version: string;
      config_hash: string;
      config_json: string;
      data_selection_json: string;
      status: string;
      started_at: Date | null;
      completed_at: Date | null;
      error_message: string | null;
      created_at: Date;
    }>(`SELECT * FROM simulation_runs WHERE id = $1`, [id]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];
    return {
      id: row.id,
      strategyId: row.strategy_id ?? undefined,
      tokenId: row.token_id ?? undefined,
      callerId: row.caller_id ?? undefined,
      runType: row.run_type,
      engineVersion: row.engine_version,
      configHash: row.config_hash,
      config: JSON.parse(row.config_json),
      dataSelection: JSON.parse(row.data_selection_json),
      status: row.status as SimulationRun['status'],
      startedAt: row.started_at ? DateTime.fromJSDate(row.started_at) : undefined,
      completedAt: row.completed_at ? DateTime.fromJSDate(row.completed_at) : undefined,
      errorMessage: row.error_message ?? undefined,
      createdAt: DateTime.fromJSDate(row.created_at),
    };
  }

  /**
   * Update simulation run status
   */
  async updateRunStatus(
    id: number,
    status: 'pending' | 'running' | 'completed' | 'failed',
    errorMessage?: string
  ): Promise<void> {
    const updates: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    updates.push(`status = $${paramIndex++}`);
    params.push(status);

    if (status === 'running') {
      updates.push(`started_at = NOW()`);
    }

    if (status === 'completed' || status === 'failed') {
      updates.push(`completed_at = NOW()`);
    }

    if (errorMessage) {
      updates.push(`error_message = $${paramIndex++}`);
      params.push(errorMessage);
    }

    params.push(id);

    await getPostgresPool().query(
      `UPDATE simulation_runs 
       SET ${updates.join(', ')}
       WHERE id = $${paramIndex}`,
      params
    );
  }

  /**
   * List simulation runs with filters
   */
  async listRuns(
    filters: {
      strategyId?: number;
      tokenId?: number;
      callerId?: number;
      status?: string;
      limit?: number;
      offset?: number;
    } = {}
  ): Promise<SimulationRun[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (filters.strategyId !== undefined) {
      conditions.push(`strategy_id = $${paramIndex++}`);
      params.push(filters.strategyId);
    }

    if (filters.tokenId !== undefined) {
      conditions.push(`token_id = $${paramIndex++}`);
      params.push(filters.tokenId);
    }

    if (filters.callerId !== undefined) {
      conditions.push(`caller_id = $${paramIndex++}`);
      params.push(filters.callerId);
    }

    if (filters.status) {
      conditions.push(`status = $${paramIndex++}`);
      params.push(filters.status);
    }

    let query = `SELECT * FROM simulation_runs`;
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ` ORDER BY created_at DESC`;

    if (filters.limit) {
      query += ` LIMIT $${paramIndex++}`;
      params.push(filters.limit);
    }

    if (filters.offset) {
      query += ` OFFSET $${paramIndex++}`;
      params.push(filters.offset);
    }

    const result = await getPostgresPool().query<{
      id: number;
      strategy_id: number | null;
      token_id: number | null;
      caller_id: number | null;
      run_type: string;
      engine_version: string;
      config_hash: string;
      config_json: string;
      data_selection_json: string;
      status: string;
      started_at: Date | null;
      completed_at: Date | null;
      error_message: string | null;
      created_at: Date;
    }>(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      strategyId: row.strategy_id ?? undefined,
      tokenId: row.token_id ?? undefined,
      callerId: row.caller_id ?? undefined,
      runType: row.run_type,
      engineVersion: row.engine_version,
      configHash: row.config_hash,
      config: JSON.parse(row.config_json),
      dataSelection: JSON.parse(row.data_selection_json),
      status: row.status as SimulationRun['status'],
      startedAt: row.started_at ? DateTime.fromJSDate(row.started_at) : undefined,
      completedAt: row.completed_at ? DateTime.fromJSDate(row.completed_at) : undefined,
      errorMessage: row.error_message ?? undefined,
      createdAt: DateTime.fromJSDate(row.created_at),
    }));
  }
}

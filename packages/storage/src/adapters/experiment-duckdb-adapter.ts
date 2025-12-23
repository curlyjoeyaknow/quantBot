/**
 * DuckDB Experiment Repository Adapter
 *
 * Implements ExperimentRepository port using DuckDB for storage.
 */

import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { z } from 'zod';
import type {
  ExperimentRepository,
  ExperimentMetadata,
  ExperimentQueryFilter,
  ExperimentQueryResult,
} from '@quantbot/core';
import { DateTime } from 'luxon';
import { DuckDBClient } from '../duckdb/duckdb-client.js';
import { logger, NotFoundError, AppError } from '@quantbot/utils';

const ExperimentSchema = z.object({
  run_id: z.string(),
  strategy_id: z.string().optional(),
  mint: z.string().optional(),
  alert_timestamp: z.string().optional(),
  start_time: z.string().optional(),
  end_time: z.string().optional(),
  initial_capital: z.number().optional(),
  final_capital: z.number().optional(),
  total_return_pct: z.number().optional(),
  max_drawdown_pct: z.number().optional(),
  sharpe_ratio: z.number().optional(),
  win_rate: z.number().optional(),
  total_trades: z.number().optional(),
  caller_name: z.string().optional(),
  created_at: z.string().optional(),
  experiment_id: z.string().optional(),
  git_commit_hash: z.string().optional(),
  data_snapshot_hash: z.string().optional(),
  parameter_vector_hash: z.string().optional(),
  random_seed: z.number().optional(),
  contract_version: z.string().optional(),
  strategy_version: z.string().optional(),
  data_version: z.string().optional(),
  status: z.enum(['pending', 'running', 'completed', 'failed']).optional(),
  started_at: z.string().optional(),
  completed_at: z.string().optional(),
  error_message: z.string().optional(),
});

const ExperimentResultSchema = z.object({
  success: z.boolean(),
  experiment: ExperimentSchema.optional(),
  error: z.string().optional(),
});

const ExperimentListResultSchema = z.object({
  success: z.boolean(),
  experiments: z.array(ExperimentSchema),
  total: z.number(),
  error: z.string().optional(),
});

/**
 * DuckDB Experiment Repository Adapter
 */
export class ExperimentDuckDBAdapter implements ExperimentRepository {
  private client: DuckDBClient;
  private scriptPath: string;

  constructor(dbPath: string, client?: DuckDBClient) {
    this.client = client || new DuckDBClient(dbPath);
    const workspaceRoot = this.findWorkspaceRoot();
    this.scriptPath = join(workspaceRoot, 'tools/storage/duckdb_experiments.py');
  }

  /**
   * Find workspace root
   */
  private findWorkspaceRoot(): string {
    let current = process.cwd();
    const path = require('path');

    while (current !== '/' && current !== '') {
      const workspaceFile = join(current, 'pnpm-workspace.yaml');
      if (existsSync(workspaceFile)) {
        return current;
      }
      const parent = dirname(current);
      if (parent === current) break;
      current = parent;
    }

    return process.cwd();
  }

  /**
   * Convert experiment row to ExperimentMetadata
   */
  private rowToMetadata(row: z.infer<typeof ExperimentSchema>): ExperimentMetadata {
    return {
      id: parseInt(row.run_id) || undefined,
      strategyId: row.strategy_id ? parseInt(row.strategy_id) : undefined,
      runType: 'backtest', // Default, could be extracted from row if available
      engineVersion: '1.0', // Default, could be extracted from row if available
      configHash: row.parameter_vector_hash || '',
      config: {}, // Could be loaded from strategy_config table if needed
      dataSelection: {}, // Could be loaded from row if available
      status: (row.status as 'pending' | 'running' | 'completed' | 'failed') || 'completed',
      startedAt: row.started_at ? DateTime.fromISO(row.started_at) : undefined,
      completedAt: row.completed_at ? DateTime.fromISO(row.completed_at) : undefined,
      errorMessage: row.error_message,
      // Experiment tracking fields
      experimentId: row.experiment_id,
      gitCommitHash: row.git_commit_hash,
      dataSnapshotHash: row.data_snapshot_hash,
      parameterVectorHash: row.parameter_vector_hash,
      randomSeed: row.random_seed,
      contractVersion: row.contract_version,
      strategyVersion: row.strategy_version,
      dataVersion: row.data_version,
    };
  }

  async get(experimentId: string): Promise<ExperimentMetadata | null> {
    try {
      const result = await this.client.execute(
        this.scriptPath,
        'get',
        {
          data: JSON.stringify({ experiment_id: experimentId }),
        },
        ExperimentResultSchema
      );

      if (!result.success || !result.experiment) {
        return null;
      }

      return this.rowToMetadata(result.experiment);
    } catch (error) {
      logger.error('Failed to get experiment', error as Error, { experimentId });
      throw error;
    }
  }

  async list(filter?: ExperimentQueryFilter): Promise<ExperimentQueryResult> {
    try {
      const filterData: Record<string, unknown> = {};
      
      if (filter?.experimentId) filterData.experiment_id = filter.experimentId;
      if (filter?.strategyId) filterData.strategy_id = filter.strategyId;
      if (filter?.parameterVectorHash) filterData.parameter_vector_hash = filter.parameterVectorHash;
      if (filter?.gitCommitHash) filterData.git_commit_hash = filter.gitCommitHash;
      if (filter?.dataSnapshotHash) filterData.data_snapshot_hash = filter.dataSnapshotHash;
      if (filter?.status) filterData.status = filter.status;
      if (filter?.startedAfter) filterData.started_after = filter.startedAfter;
      if (filter?.startedBefore) filterData.started_before = filter.startedBefore;

      const result = await this.client.execute(
        this.scriptPath,
        'list',
        {
          data: JSON.stringify({
            filter: filterData,
            limit: filter?.limit,
            offset: filter?.offset,
          }),
        },
        ExperimentListResultSchema
      );

      if (!result.success) {
        throw new AppError(result.error || 'Failed to list experiments');
      }

      return {
        experiments: result.experiments.map((row) => this.rowToMetadata(row)),
        total: result.total,
      };
    } catch (error) {
      logger.error('Failed to list experiments', error as Error, { filter });
      throw error;
    }
  }

  async getByParameterHash(
    parameterVectorHash: string,
    limit?: number
  ): Promise<ExperimentMetadata[]> {
    const result = await this.list({
      parameterVectorHash,
      limit,
    });
    return result.experiments;
  }

  async getByGitCommit(gitCommitHash: string, limit?: number): Promise<ExperimentMetadata[]> {
    const result = await this.list({
      gitCommitHash,
      limit,
    });
    return result.experiments;
  }

  async getByDataSnapshot(
    dataSnapshotHash: string,
    limit?: number
  ): Promise<ExperimentMetadata[]> {
    const result = await this.list({
      dataSnapshotHash,
      limit,
    });
    return result.experiments;
  }
}


/**
 * IngestionRunRepository - Tracks OHLCV ingestion runs with full audit trail.
 *
 * Every ingestion run is recorded with:
 * - Version tracking (script version, git commit, branch, dirty status)
 * - Input tracking (CLI args, env vars, input hash)
 * - Results (candles fetched/inserted/rejected/deduplicated)
 * - Source tier (used for quality score calculation)
 * - Dedup mode and completion status
 */

import { getClickHouseClient } from '../../clickhouse-client.js';
import { logger } from '@quantbot/utils';
import type { IngestionRunManifest, SourceTier } from '../types/quality-score.js';

export interface IngestionRun {
  runId: string;
  startedAt: Date;
  completedAt: Date | null;
  status: 'running' | 'completed' | 'failed' | 'rolled_back';

  // Version tracking
  scriptVersion: string;
  gitCommitHash: string;
  gitBranch: string;
  gitDirty: boolean;

  // Input tracking
  cliArgs: Record<string, unknown>;
  envInfo: Record<string, string>;
  inputHash: string;

  // Source tier for this run
  sourceTier: number;

  // Results
  candlesFetched: number;
  candlesInserted: number;
  candlesRejected: number;
  candlesDeduplicated: number;
  tokensProcessed: number;
  errorsCount: number;
  errorMessage: string | null;

  // Validation stats
  zeroVolumeCount: number;

  // Dedup tracking
  dedupMode: string;
  dedupCompletedAt: Date | null;
}

export interface RunStats {
  candlesFetched: number;
  candlesInserted: number;
  candlesRejected: number;
  candlesDeduplicated: number;
  tokensProcessed: number;
  errorsCount: number;
  zeroVolumeCount: number;
}

export class IngestionRunRepository {
  private readonly CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

  /**
   * Start a new ingestion run.
   */
  async startRun(manifest: IngestionRunManifest): Promise<void> {
    const ch = getClickHouseClient();

    try {
      await ch.insert({
        table: `${this.CLICKHOUSE_DATABASE}.ohlcv_ingestion_runs`,
        values: [
          {
            run_id: manifest.runId,
            started_at: new Date(),
            completed_at: null,
            status: 'running',
            script_version: manifest.scriptVersion,
            git_commit_hash: manifest.gitCommitHash,
            git_branch: manifest.gitBranch,
            git_dirty: manifest.gitDirty ? 1 : 0,
            cli_args: JSON.stringify(manifest.cliArgs),
            env_info: JSON.stringify(manifest.envInfo),
            input_hash: manifest.inputHash,
            source_tier: manifest.sourceTier,
            candles_fetched: 0,
            candles_inserted: 0,
            candles_rejected: 0,
            candles_deduplicated: 0,
            tokens_processed: 0,
            errors_count: 0,
            error_message: null,
            zero_volume_count: 0,
            dedup_mode: manifest.dedupMode,
            dedup_completed_at: null,
          },
        ],
        format: 'JSONEachRow',
      });

      logger.info('Started ingestion run', {
        runId: manifest.runId,
        sourceTier: manifest.sourceTier,
        dedupMode: manifest.dedupMode,
      });
    } catch (error: unknown) {
      logger.error('Failed to start ingestion run', error as Error, {
        runId: manifest.runId,
      });
      throw error;
    }
  }

  /**
   * Complete an ingestion run with final stats.
   */
  async completeRun(runId: string, stats: RunStats): Promise<void> {
    const ch = getClickHouseClient();

    try {
      // ClickHouse doesn't support UPDATE, so we use ALTER TABLE UPDATE
      await ch.query({
        query: `
          ALTER TABLE ${this.CLICKHOUSE_DATABASE}.ohlcv_ingestion_runs
          UPDATE
            completed_at = now(),
            status = 'completed',
            candles_fetched = ${stats.candlesFetched},
            candles_inserted = ${stats.candlesInserted},
            candles_rejected = ${stats.candlesRejected},
            candles_deduplicated = ${stats.candlesDeduplicated},
            tokens_processed = ${stats.tokensProcessed},
            errors_count = ${stats.errorsCount},
            zero_volume_count = ${stats.zeroVolumeCount}
          WHERE run_id = '${runId.replace(/'/g, "''")}'
        `,
      });

      logger.info('Completed ingestion run', { runId, stats });
    } catch (error: unknown) {
      logger.error('Failed to complete ingestion run', error as Error, { runId });
      throw error;
    }
  }

  /**
   * Mark an ingestion run as failed.
   */
  async failRun(runId: string, error: Error): Promise<void> {
    const ch = getClickHouseClient();

    try {
      const errorMessage = error.message.replace(/'/g, "''");

      await ch.query({
        query: `
          ALTER TABLE ${this.CLICKHOUSE_DATABASE}.ohlcv_ingestion_runs
          UPDATE
            completed_at = now(),
            status = 'failed',
            error_message = '${errorMessage}'
          WHERE run_id = '${runId.replace(/'/g, "''")}'
        `,
      });

      logger.error('Failed ingestion run', error, { runId });
    } catch (updateError: unknown) {
      logger.error('Failed to update run status to failed', updateError as Error, { runId });
      throw updateError;
    }
  }

  /**
   * Mark deduplication as completed for a run.
   */
  async markDedupCompleted(runId: string, deduplicated: number): Promise<void> {
    const ch = getClickHouseClient();

    try {
      await ch.query({
        query: `
          ALTER TABLE ${this.CLICKHOUSE_DATABASE}.ohlcv_ingestion_runs
          UPDATE
            dedup_completed_at = now(),
            candles_deduplicated = ${deduplicated}
          WHERE run_id = '${runId.replace(/'/g, "''")}'
        `,
      });

      logger.info('Marked deduplication completed', { runId, deduplicated });
    } catch (error: unknown) {
      logger.error('Failed to mark dedup completed', error as Error, { runId });
      throw error;
    }
  }

  /**
   * Get run history.
   */
  async getRunHistory(options?: {
    status?: string;
    since?: Date;
    limit?: number;
  }): Promise<IngestionRun[]> {
    const ch = getClickHouseClient();
    const limit = options?.limit || 100;

    let whereClause = '';
    const conditions: string[] = [];

    if (options?.status) {
      conditions.push(`status = '${options.status.replace(/'/g, "''")}'`);
    }

    if (options?.since) {
      const sinceUnix = Math.floor(options.since.getTime() / 1000);
      conditions.push(`started_at >= toDateTime(${sinceUnix})`);
    }

    if (conditions.length > 0) {
      whereClause = `WHERE ${conditions.join(' AND ')}`;
    }

    try {
      const result = await ch.query({
        query: `
          SELECT
            run_id,
            started_at,
            completed_at,
            status,
            script_version,
            git_commit_hash,
            git_branch,
            git_dirty,
            cli_args,
            env_info,
            input_hash,
            source_tier,
            candles_fetched,
            candles_inserted,
            candles_rejected,
            candles_deduplicated,
            tokens_processed,
            errors_count,
            error_message,
            zero_volume_count,
            dedup_mode,
            dedup_completed_at
          FROM ${this.CLICKHOUSE_DATABASE}.ohlcv_ingestion_runs
          ${whereClause}
          ORDER BY started_at DESC
          LIMIT ${limit}
        `,
        format: 'JSONEachRow',
      });

      const data = (await result.json()) as Array<{
        run_id: string;
        started_at: string;
        completed_at: string | null;
        status: 'running' | 'completed' | 'failed' | 'rolled_back';
        script_version: string;
        git_commit_hash: string;
        git_branch: string;
        git_dirty: number;
        cli_args: string;
        env_info: string;
        input_hash: string;
        source_tier: number;
        candles_fetched: number;
        candles_inserted: number;
        candles_rejected: number;
        candles_deduplicated: number;
        tokens_processed: number;
        errors_count: number;
        error_message: string | null;
        zero_volume_count: number;
        dedup_mode: string;
        dedup_completed_at: string | null;
      }>;

      return data.map((row) => ({
        runId: row.run_id,
        startedAt: new Date(row.started_at),
        completedAt: row.completed_at ? new Date(row.completed_at) : null,
        status: row.status,
        scriptVersion: row.script_version,
        gitCommitHash: row.git_commit_hash,
        gitBranch: row.git_branch,
        gitDirty: row.git_dirty === 1,
        cliArgs: JSON.parse(row.cli_args),
        envInfo: JSON.parse(row.env_info),
        inputHash: row.input_hash,
        sourceTier: row.source_tier,
        candlesFetched: row.candles_fetched,
        candlesInserted: row.candles_inserted,
        candlesRejected: row.candles_rejected,
        candlesDeduplicated: row.candles_deduplicated,
        tokensProcessed: row.tokens_processed,
        errorsCount: row.errors_count,
        errorMessage: row.error_message,
        zeroVolumeCount: row.zero_volume_count,
        dedupMode: row.dedup_mode,
        dedupCompletedAt: row.dedup_completed_at ? new Date(row.dedup_completed_at) : null,
      }));
    } catch (error: unknown) {
      logger.error('Failed to get run history', error as Error);
      return [];
    }
  }

  /**
   * Get details for a specific run.
   */
  async getRunDetails(runId: string): Promise<IngestionRun | null> {
    const runs = await this.getRunHistory({ limit: 1 });
    if (runs.length === 0) {
      return null;
    }
    return runs[0];
  }
}

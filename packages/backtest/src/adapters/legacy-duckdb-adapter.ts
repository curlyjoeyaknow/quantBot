/**
 * Legacy DuckDB Adapter - Dual mode adapter for legacy DuckDB + event log union queries
 *
 * Provides transparent access to both legacy DuckDB files and event log index.
 * Uses union queries to combine results from both sources.
 */

import type { DuckDbConnection } from '@quantbot/infra/storage';
import { logger, findWorkspaceRoot } from '@quantbot/infra/utils';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * Migration cutover date - runs before this date use legacy DuckDB, after use event log
 */
export const MIGRATION_CUTOVER_DATE = '2026-01-23';

/**
 * Legacy DuckDB Adapter - Combines legacy DuckDB and event log index queries
 */
export class LegacyDuckDBAdapter {
  private readonly legacyRunsDbPath: string;
  private readonly eventLogRunsDbPath: string;
  private readonly workspaceRoot: string;

  constructor(legacyRunsDbPath?: string, eventLogRunsDbPath?: string, workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot ?? findWorkspaceRoot();

    // Default paths
    this.legacyRunsDbPath =
      legacyRunsDbPath ?? join(this.workspaceRoot, 'data', 'baseline_results.duckdb');
    this.eventLogRunsDbPath =
      eventLogRunsDbPath ?? join(this.workspaceRoot, 'data', 'ledger', 'index', 'runs.duckdb');
  }

  /**
   * Check if legacy DuckDB file exists
   */
  private hasLegacyDb(): boolean {
    return existsSync(this.legacyRunsDbPath);
  }

  /**
   * Check if event log index exists
   */
  private hasEventLogIndex(): boolean {
    return existsSync(this.eventLogRunsDbPath);
  }

  /**
   * Query runs from both legacy and event log sources
   *
   * @param connection - DuckDB connection (will attach both databases)
   * @param sinceDate - Optional date filter (YYYY-MM-DD)
   * @returns Combined results from both sources
   */
  async queryRuns(
    connection: DuckDbConnection,
    sinceDate?: string
  ): Promise<Array<Record<string, unknown>>> {
    const queries: string[] = [];
    const hasLegacy = this.hasLegacyDb();
    const hasEventLog = this.hasEventLogIndex();

    if (!hasLegacy && !hasEventLog) {
      logger.warn('No DuckDB sources available (neither legacy nor event log index)');
      return [];
    }

    // Attach legacy database if it exists
    if (hasLegacy) {
      try {
        await connection.run(`ATTACH '${this.legacyRunsDbPath.replace(/'/g, "''")}' AS legacy_db`);
        queries.push(`
          SELECT 
            run_id,
            run_type,
            created_at_ms,
            config,
            data_fingerprint,
            'legacy' AS source
          FROM legacy_db.optimizer.runs_d
          ${sinceDate ? `WHERE DATE(created_at_ms / 1000) >= '${sinceDate}'` : ''}
        `);
      } catch (error) {
        logger.warn('Failed to attach legacy database', {
          path: this.legacyRunsDbPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Attach event log index if it exists
    if (hasEventLog) {
      try {
        await connection.run(
          `ATTACH '${this.eventLogRunsDbPath.replace(/'/g, "''")}' AS event_log_db`
        );
        queries.push(`
          SELECT 
            run_id,
            run_type,
            created_at_ms,
            config,
            data_fingerprint,
            'event_log' AS source
          FROM event_log_db.runs_d
          ${sinceDate ? `WHERE DATE(created_at_ms / 1000) >= '${sinceDate}'` : ''}
        `);
      } catch (error) {
        logger.warn('Failed to attach event log index', {
          path: this.eventLogRunsDbPath,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (queries.length === 0) {
      return [];
    }

    // Union all queries
    const unionQuery = queries.join(' UNION ALL ');
    const results = await connection.all<Record<string, unknown>>(unionQuery);

    return results;
  }

  /**
   * Query run status from both sources
   */
  async queryRunStatus(
    connection: DuckDbConnection,
    runId?: string
  ): Promise<Array<Record<string, unknown>>> {
    const queries: string[] = [];
    const hasLegacy = this.hasLegacyDb();
    const hasEventLog = this.hasEventLogIndex();

    if (!hasLegacy && !hasEventLog) {
      return [];
    }

    // Legacy query (if schema exists)
    if (hasLegacy) {
      try {
        await connection.run(`ATTACH '${this.legacyRunsDbPath.replace(/'/g, "''")}' AS legacy_db`);
        // Try to query legacy status if table exists
        queries.push(`
          SELECT 
            run_id,
            started_at_ms,
            completed_at_ms,
            summary_json,
            'legacy' AS source
          FROM legacy_db.optimizer.runs_status
          ${runId ? `WHERE run_id = '${runId.replace(/'/g, "''")}'` : ''}
        `);
      } catch (error) {
        // Legacy schema might not have runs_status table
        logger.debug('Legacy database does not have runs_status table', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // Event log query
    if (hasEventLog) {
      try {
        await connection.run(
          `ATTACH '${this.eventLogRunsDbPath.replace(/'/g, "''")}' AS event_log_db`
        );
        queries.push(`
          SELECT 
            run_id,
            started_at_ms,
            completed_at_ms,
            summary_json,
            'event_log' AS source
          FROM event_log_db.runs_status
          ${runId ? `WHERE run_id = '${runId.replace(/'/g, "''")}'` : ''}
        `);
      } catch (error) {
        logger.warn('Failed to query event log index', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (queries.length === 0) {
      return [];
    }

    const unionQuery = queries.join(' UNION ALL ');
    const results = await connection.all<Record<string, unknown>>(unionQuery);

    return results;
  }

  /**
   * Determine which source to use for a given run ID based on cutover date
   */
  getSourceForRun(runId: string, runCreatedAtMs?: number): 'legacy' | 'event_log' | 'both' {
    if (runCreatedAtMs) {
      const runDate = new Date(runCreatedAtMs).toISOString().split('T')[0];
      if (runDate < MIGRATION_CUTOVER_DATE) {
        return 'legacy';
      } else {
        return 'event_log';
      }
    }
    // If we don't know the creation date, check both
    return 'both';
  }
}

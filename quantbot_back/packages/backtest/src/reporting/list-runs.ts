import { readdir } from 'fs/promises';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { RunSummaryRow } from './run-list.js';
import { DuckDBClient } from '@quantbot/storage';

/**
 * Metadata structure from metadata.json files
 */
interface BacktestMetadata {
  run_id: string;
  backtest_type: 'path-only' | 'policy' | 'full';
  table_name: string;
  rows: number;
  created_at_utc: string;
  parquet_file?: string;
  parquet_path?: string;
  interval?: string;
  callsProcessed?: number;
  rowsWritten?: number;
  callsExcluded?: number;
  [key: string]: unknown;
}

/**
 * Scan artifacts directory and list all backtest runs
 *
 * @param artifactsBaseDir - Base artifacts directory (default: process.cwd()/artifacts/backtest)
 * @returns Array of run IDs that have metadata.json files
 */
export async function scanBacktestRuns(artifactsBaseDir?: string): Promise<string[]> {
  const baseDir = artifactsBaseDir || join(process.cwd(), 'artifacts', 'backtest');

  if (!existsSync(baseDir)) {
    return [];
  }

  const entries = await readdir(baseDir, { withFileTypes: true });
  const runIds: string[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      const runId = entry.name;
      const metadataPath = join(baseDir, runId, 'metadata.json');

      // Check for metadata.json (new format) or results.duckdb (legacy)
      if (existsSync(metadataPath) || existsSync(join(baseDir, runId, 'results.duckdb'))) {
        runIds.push(runId);
      }
    }
  }

  return runIds.sort((a, b) => b.localeCompare(a)); // Most recent first
}

/**
 * Read metadata.json and compute summary from Parquet if needed
 */
async function getSummaryFromMetadata(
  runId: string,
  baseDir: string,
  metadata: BacktestMetadata
): Promise<RunSummaryRow | null> {
  // For path-only backtests, we don't have trade data, so return basic summary
  if (metadata.backtest_type === 'path-only') {
    return {
      run_id: runId,
      total_trades: 0,
      total_pnl_usd: 0,
      total_pnl_pct: 0,
      avg_return_bps: 0,
      win_rate: 0,
      max_drawdown_bps: 0,
      median_drawdown_bps: 0,
      total_calls: metadata.callsProcessed || 0,
      unique_callers: 0, // Would need to query Parquet to get this
      created_at: metadata.created_at_utc || null,
    };
  }

  // For full/policy backtests, try to read from Parquet
  const parquetPath =
    metadata.parquet_path || join(baseDir, runId, `${metadata.table_name}.parquet`);

  if (!existsSync(parquetPath)) {
    // Fallback to basic metadata
    return {
      run_id: runId,
      total_trades: metadata.rowsWritten || metadata.rows || 0,
      total_pnl_usd: 0,
      total_pnl_pct: 0,
      avg_return_bps: 0,
      win_rate: 0,
      max_drawdown_bps: 0,
      median_drawdown_bps: 0,
      total_calls: metadata.callsProcessed || 0,
      unique_callers: 0,
      created_at: metadata.created_at_utc || null,
    };
  }

  // Query Parquet file for summary stats
  try {
    const db = new DuckDBClient(':memory:');
    try {
      await db.execute('INSTALL parquet;');
      await db.execute('LOAD parquet;');

      // Determine table name from metadata
      const tableName = metadata.table_name || 'backtest_call_results';

      // Create a view from Parquet
      await db.execute(
        `CREATE VIEW data AS SELECT * FROM read_parquet('${parquetPath.replace(/'/g, "''")}')`
      );

      // Query for summary (adapt based on table structure)
      let summarySql: string;
      if (tableName === 'backtest_call_results') {
        summarySql = `
          SELECT
            '${runId}' AS run_id,
            COUNT(*)::INT AS total_trades,
            SUM(pnl_usd) AS total_pnl_usd,
            SUM(return_bps) / 100.0 AS total_pnl_pct,
            AVG(return_bps) AS avg_return_bps,
            AVG(CASE WHEN return_bps > 0 THEN 1.0 ELSE 0.0 END) AS win_rate,
            MIN(COALESCE(dd_bps, return_bps)) AS max_drawdown_bps,
            quantile_cont(COALESCE(dd_bps, return_bps), 0.5) AS median_drawdown_bps,
            COUNT(DISTINCT call_id) AS total_calls,
            COUNT(DISTINCT caller_name) AS unique_callers,
            MIN(created_at) AS created_at
          FROM data
        `;
      } else if (tableName === 'backtest_policy_results') {
        summarySql = `
          SELECT
            '${runId}' AS run_id,
            COUNT(*)::INT AS total_trades,
            0 AS total_pnl_usd,
            AVG(realized_return_bps) / 100.0 AS total_pnl_pct,
            AVG(realized_return_bps) AS avg_return_bps,
            AVG(CASE WHEN realized_return_bps > 0 THEN 1.0 ELSE 0.0 END) AS win_rate,
            MIN(max_adverse_excursion_bps) AS max_drawdown_bps,
            quantile_cont(max_adverse_excursion_bps, 0.5) AS median_drawdown_bps,
            COUNT(DISTINCT call_id) AS total_calls,
            0 AS unique_callers,
            '${metadata.created_at_utc || ''}' AS created_at
          FROM data
        `;
      } else {
        // Unknown table type, return basic summary
        const result = await db.query(`SELECT COUNT(*) as cnt FROM data`);
        const rowCount = result.rows[0]?.[0] ? Number(result.rows[0][0]) : 0;
        return {
          run_id: runId,
          total_trades: rowCount,
          total_pnl_usd: 0,
          total_pnl_pct: 0,
          avg_return_bps: 0,
          win_rate: 0,
          max_drawdown_bps: 0,
          median_drawdown_bps: 0,
          total_calls: metadata.callsProcessed || 0,
          unique_callers: 0,
          created_at: metadata.created_at_utc || null,
        };
      }

      const result = await db.query(summarySql);
      if (result.rows.length > 0) {
        const row = result.rows[0];
        return {
          run_id: row[0] as string,
          total_trades: Number(row[1]) || 0,
          total_pnl_usd: Number(row[2]) || 0,
          total_pnl_pct: Number(row[3]) || 0,
          avg_return_bps: Number(row[4]) || 0,
          win_rate: Number(row[5]) || 0,
          max_drawdown_bps: Number(row[6]) || 0,
          median_drawdown_bps: Number(row[7]) || 0,
          total_calls: Number(row[8]) || 0,
          unique_callers: Number(row[9]) || 0,
          created_at: (row[10] as string) || metadata.created_at_utc || null,
        };
      }
    } finally {
      await db.close();
    }
  } catch (error) {
    // If Parquet query fails, return basic summary from metadata
    console.warn(
      `Warning: Could not query Parquet for run ${runId}: ${error instanceof Error ? error.message : String(error)}`
    );
  }

  // Fallback to metadata-only summary
  return {
    run_id: runId,
    total_trades: metadata.rowsWritten || metadata.rows || 0,
    total_pnl_usd: 0,
    total_pnl_pct: 0,
    avg_return_bps: 0,
    win_rate: 0,
    max_drawdown_bps: 0,
    median_drawdown_bps: 0,
    total_calls: metadata.callsProcessed || 0,
    unique_callers: 0,
    created_at: metadata.created_at_utc || null,
  };
}

/**
 * Get summaries for all runs
 *
 * @param artifactsBaseDir - Base artifacts directory
 * @returns Array of run summaries
 */
export async function getAllRunSummaries(
  artifactsBaseDir?: string
): Promise<Array<RunSummaryRow & { parquet_path?: string }>> {
  const runIds = await scanBacktestRuns(artifactsBaseDir);
  const baseDir = artifactsBaseDir || join(process.cwd(), 'artifacts', 'backtest');

  const summaries: Array<RunSummaryRow & { parquet_path?: string }> = [];

  for (const runId of runIds) {
    const metadataPath = join(baseDir, runId, 'metadata.json');
    const legacyDuckdbPath = join(baseDir, runId, 'results.duckdb');

    try {
      // Try new format first (metadata.json)
      if (existsSync(metadataPath)) {
        const metadataContent = await readFile(metadataPath, 'utf-8');
        const metadata: BacktestMetadata = JSON.parse(metadataContent);
        const summary = await getSummaryFromMetadata(runId, baseDir, metadata);

        if (summary) {
          summaries.push({
            ...summary,
            parquet_path:
              metadata.parquet_path || join(baseDir, runId, `${metadata.table_name}.parquet`),
          });
        }
      } else if (existsSync(legacyDuckdbPath)) {
        // Legacy format: read from DuckDB (backward compatibility)
        const duckdb = await import('duckdb');
        const database = new duckdb.Database(legacyDuckdbPath);
        const db = database.connect();

        try {
          const { getRunSummary } = await import('./run-list.js');
          type DuckDbConnection = {
            all<T = any>(sql: string, params: any[], callback: (err: any, rows: T[]) => void): void;
          };
          const adapter: DuckDbConnection = {
            all<T = any>(
              sql: string,
              params: any[],
              callback: (err: any, rows: T[]) => void
            ): void {
              (db.all as any)(sql, params, (err: any, rows: any) => {
                if (err) {
                  callback(err, []);
                } else {
                  callback(null, rows as T[]);
                }
              });
            },
          };
          const summary = await getRunSummary(adapter, runId);
          if (summary) {
            summaries.push({
              ...summary,
              parquet_path: undefined, // Legacy format doesn't have Parquet
            });
          }
        } finally {
          database.close();
        }
      }
    } catch (error) {
      // Skip runs that can't be read
      console.warn(
        `Warning: Could not read run ${runId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return summaries;
}

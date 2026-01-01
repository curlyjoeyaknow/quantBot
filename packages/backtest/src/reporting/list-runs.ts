import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';
import type { RunSummaryRow } from './run-list.js';
import { getRunSummary } from './run-list.js';

// DuckDB connection type (callback-based API)
type DuckDbConnection = {
  all<T = any>(sql: string, params: any[], callback: (err: any, rows: T[]) => void): void;
};

/**
 * Scan artifacts directory and list all backtest runs
 *
 * @param artifactsBaseDir - Base artifacts directory (default: process.cwd()/artifacts/backtest)
 * @returns Array of run IDs that have results.duckdb files
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
      const duckdbPath = join(baseDir, runId, 'results.duckdb');

      if (existsSync(duckdbPath)) {
        runIds.push(runId);
      }
    }
  }

  return runIds.sort((a, b) => b.localeCompare(a)); // Most recent first
}

/**
 * Get summaries for all runs
 *
 * @param artifactsBaseDir - Base artifacts directory
 * @returns Array of run summaries
 */
export async function getAllRunSummaries(
  artifactsBaseDir?: string
): Promise<Array<RunSummaryRow & { duckdb_path: string }>> {
  const runIds = await scanBacktestRuns(artifactsBaseDir);
  const baseDir = artifactsBaseDir || join(process.cwd(), 'artifacts', 'backtest');

  const duckdb = await import('duckdb');
  const summaries: Array<RunSummaryRow & { duckdb_path: string }> = [];

  for (const runId of runIds) {
    const duckdbPath = join(baseDir, runId, 'results.duckdb');

    try {
      const database = new duckdb.Database(duckdbPath);
      const db = database.connect();

      try {
        // Create adapter for DuckDB Connection
        const adapter: DuckDbConnection = {
          all<T = any>(sql: string, params: any[], callback: (err: any, rows: T[]) => void): void {
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
            duckdb_path: duckdbPath,
          });
        }
      } finally {
        database.close();
      }
    } catch (error) {
      // Skip runs that can't be opened (corrupted, etc.)
      console.warn(
        `Warning: Could not read run ${runId}: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return summaries;
}

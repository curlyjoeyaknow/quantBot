/**
 * Central DuckDB Persistence Service
 *
 * Ensures ALL backtest runs are recorded in a central DuckDB database
 * for auditability and replayability. This is the single source of truth
 * for all simulation/backtest runs.
 *
 * Uses Python via DuckDBClient for all database operations.
 */

import { getDuckDBPath } from '@quantbot/utils';
import { DuckDBClient, getDuckDBClient } from '@quantbot/storage';
import type { DuckDbConnection, CallResultRow } from './backtest-results-duckdb.js';
import type { PathMetricsRow, PolicyResultRow } from '../types.js';
import {
  ensureBacktestSchema,
  ensurePathMetricsSchema,
  ensurePolicyResultsSchema,
  insertCallResults,
  insertPathMetrics,
  insertPolicyResults,
} from './backtest-results-duckdb.js';
import { logger } from '@quantbot/utils';
import { createDuckDbConnectionAdapter } from './duckdb-connection-adapter.js';

export interface BacktestRunMetadata {
  run_id: string;
  strategy_id?: string;
  run_mode: 'path-only' | 'exit-optimizer' | 'exit-stack' | 'policy' | 'optimize' | 'baseline';
  status: 'pending' | 'running' | 'completed' | 'failed';
  params_json: string;
  interval?: string;
  time_from?: Date | string;
  time_to?: Date | string;
  created_at?: Date | string;
  started_at?: Date | string;
  finished_at?: Date | string;
  error_text?: string;
  // Summary metrics (optional, for quick queries)
  total_calls?: number;
  total_trades?: number;
  total_pnl_usd?: number;
  avg_return_bps?: number;
}

/**
 * Get the central DuckDB database path
 */
export function getCentralDuckDbPath(): string {
  // Use the same central DB as the rest of the system
  return getDuckDBPath('data/tele.duckdb');
}

/**
 * Get DuckDB client for central persistence
 */
function getCentralDuckDbClient(): DuckDBClient {
  return getDuckDBClient(getCentralDuckDbPath());
}

/**
 * Ensure central backtest schema exists
 */
export async function ensureCentralBacktestSchema(client: DuckDBClient): Promise<void> {
  // Ensure backtest_runs table exists
  await client.execute(`
    CREATE TABLE IF NOT EXISTS backtest_runs (
      run_id TEXT PRIMARY KEY,
      strategy_id TEXT,
      run_mode TEXT NOT NULL DEFAULT 'exit-optimizer',
      status TEXT NOT NULL DEFAULT 'pending',
      params_json TEXT NOT NULL,
      interval TEXT,
      time_from TIMESTAMP,
      time_to TIMESTAMP,
      created_at TIMESTAMP DEFAULT now(),
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      error_text TEXT,
      -- Summary metrics (for quick queries)
      total_calls INTEGER,
      total_trades INTEGER,
      total_pnl_usd DOUBLE,
      avg_return_bps DOUBLE
    );
    
    CREATE INDEX IF NOT EXISTS idx_backtest_runs_created ON backtest_runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_backtest_runs_status ON backtest_runs(status);
    CREATE INDEX IF NOT EXISTS idx_backtest_runs_mode ON backtest_runs(run_mode);
    CREATE INDEX IF NOT EXISTS idx_backtest_runs_strategy ON backtest_runs(strategy_id);
  `);

  // Ensure all result tables exist using adapter
  const adapter = createDuckDbConnectionAdapter(client);
  await ensureBacktestSchema(adapter);
  await ensurePathMetricsSchema(adapter);
  await ensurePolicyResultsSchema(adapter);
}

/**
 * Insert or update run metadata in central DuckDB
 */
export async function upsertRunMetadata(metadata: BacktestRunMetadata): Promise<void> {
  const client = getCentralDuckDbClient();
  await ensureCentralBacktestSchema(client);

  // Escape values for SQL
  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
    if (val instanceof Date) return `'${val.toISOString()}'`;
    return String(val);
  };

  const sql = `
    INSERT INTO backtest_runs (
      run_id, strategy_id, run_mode, status, params_json,
      interval, time_from, time_to,
      created_at, started_at, finished_at, error_text,
      total_calls, total_trades, total_pnl_usd, avg_return_bps
    ) VALUES (
      ${escape(metadata.run_id)},
      ${escape(metadata.strategy_id ?? null)},
      ${escape(metadata.run_mode)},
      ${escape(metadata.status)},
      ${escape(metadata.params_json)},
      ${escape(metadata.interval ?? null)},
      ${escape(metadata.time_from ? new Date(metadata.time_from).toISOString() : null)},
      ${escape(metadata.time_to ? new Date(metadata.time_to).toISOString() : null)},
      ${escape(metadata.created_at ? new Date(metadata.created_at).toISOString() : null)},
      ${escape(metadata.started_at ? new Date(metadata.started_at).toISOString() : null)},
      ${escape(metadata.finished_at ? new Date(metadata.finished_at).toISOString() : null)},
      ${escape(metadata.error_text ?? null)},
      ${escape(metadata.total_calls ?? null)},
      ${escape(metadata.total_trades ?? null)},
      ${escape(metadata.total_pnl_usd ?? null)},
      ${escape(metadata.avg_return_bps ?? null)}
    )
    ON CONFLICT (run_id) DO UPDATE SET
      status = excluded.status,
      started_at = COALESCE(excluded.started_at, backtest_runs.started_at),
      finished_at = COALESCE(excluded.finished_at, backtest_runs.finished_at),
      error_text = COALESCE(excluded.error_text, backtest_runs.error_text),
      total_calls = COALESCE(excluded.total_calls, backtest_runs.total_calls),
      total_trades = COALESCE(excluded.total_trades, backtest_runs.total_trades),
      total_pnl_usd = COALESCE(excluded.total_pnl_usd, backtest_runs.total_pnl_usd),
      avg_return_bps = COALESCE(excluded.avg_return_bps, backtest_runs.avg_return_bps)
  `;

  await client.execute(sql);

  logger.info('Run metadata persisted to central DuckDB', {
    runId: metadata.run_id,
    status: metadata.status,
  });
}

/**
 * Persist call results to central DuckDB
 */
export async function persistCallResultsToCentral(rows: CallResultRow[]): Promise<void> {
  if (rows.length === 0) return;

  const client = getCentralDuckDbClient();
  await ensureCentralBacktestSchema(client);

  const adapter = createDuckDbConnectionAdapter(client);
  await insertCallResults(adapter, rows);
  logger.info('Call results persisted to central DuckDB', { rows: rows.length });
}

/**
 * Persist path metrics to central DuckDB
 */
export async function persistPathMetricsToCentral(rows: PathMetricsRow[]): Promise<void> {
  if (rows.length === 0) return;

  const client = getCentralDuckDbClient();
  await ensureCentralBacktestSchema(client);

  const adapter = createDuckDbConnectionAdapter(client);
  await insertPathMetrics(adapter, rows);
  logger.info('Path metrics persisted to central DuckDB', { rows: rows.length });
}

/**
 * Persist policy results to central DuckDB
 */
export async function persistPolicyResultsToCentral(rows: PolicyResultRow[]): Promise<void> {
  if (rows.length === 0) return;

  const client = getCentralDuckDbClient();
  await ensureCentralBacktestSchema(client);

  const adapter = createDuckDbConnectionAdapter(client);
  await insertPolicyResults(adapter, rows);
  logger.info('Policy results persisted to central DuckDB', { rows: rows.length });
}

/**
 * Get all runs from central DuckDB
 */
export async function getAllRunsFromCentral(): Promise<BacktestRunMetadata[]> {
  const client = getCentralDuckDbClient();
  await ensureCentralBacktestSchema(client);

  const result = await client.query(`SELECT * FROM backtest_runs ORDER BY created_at DESC`);

  if (result.error) {
    throw new Error(`Failed to query runs: ${result.error}`);
  }

  // Convert rows from array of arrays to array of objects
  const columns = result.columns.map((col) => col.name);
  return result.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]] = row[i];
    }
    return obj as unknown as BacktestRunMetadata;
  });
}

/**
 * Central DuckDB Persistence Service
 *
 * Ensures ALL backtest runs are recorded in a central DuckDB database
 * for auditability and replayability. This is the single source of truth
 * for all simulation/backtest runs.
 */

import duckdb from 'duckdb';
import { getDuckDBPath } from '@quantbot/utils';
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
 * Open connection to central DuckDB
 */
export function openCentralDuckDb(): duckdb.Database {
  const path = getCentralDuckDbPath();
  return new duckdb.Database(path);
}

/**
 * Create adapter from DuckDB connection to DuckDbConnection interface
 */
function createAdapter(db: duckdb.Connection): DuckDbConnection {
  return {
    run(sql: string, params: any[], callback: (err: any) => void): void {
      db.run(sql, params, callback);
    },
    all<T = any>(sql: string, params: any[], callback: (err: any, rows: T[]) => void): void {
      (db.all as any)(sql, params, (err: any, rows: any) => {
        if (err) {
          callback(err, []);
        } else {
          callback(null, rows as T[]);
        }
      });
    },
    prepare(sql: string, callback: (err: any, stmt: any) => void): void {
      db.prepare(sql, callback);
    },
  };
}

/**
 * Ensure central backtest schema exists
 */
export async function ensureCentralBacktestSchema(db: duckdb.Database): Promise<void> {
  const conn = db.connect();
  try {
    // Ensure backtest_runs table exists
    await new Promise<void>((resolve, reject) => {
      conn.run(
        `
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
        `,
        [],
        (err: any) => (err ? reject(err) : resolve())
      );
    });

    // Ensure all result tables exist
    const adapter = createAdapter(conn);
    await ensureBacktestSchema(adapter);
    await ensurePathMetricsSchema(adapter);
    await ensurePolicyResultsSchema(adapter);
  } finally {
    conn.close();
  }
}

/**
 * Insert or update run metadata in central DuckDB
 */
export async function upsertRunMetadata(metadata: BacktestRunMetadata): Promise<void> {
  const db = openCentralDuckDb();
  await ensureCentralBacktestSchema(db);

  const conn = db.connect();
  try {
    await new Promise<void>((resolve, reject) => {
      conn.run(
        `
        INSERT INTO backtest_runs (
          run_id, strategy_id, run_mode, status, params_json,
          interval, time_from, time_to,
          created_at, started_at, finished_at, error_text,
          total_calls, total_trades, total_pnl_usd, avg_return_bps
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (run_id) DO UPDATE SET
          status = excluded.status,
          started_at = COALESCE(excluded.started_at, backtest_runs.started_at),
          finished_at = COALESCE(excluded.finished_at, backtest_runs.finished_at),
          error_text = COALESCE(excluded.error_text, backtest_runs.error_text),
          total_calls = COALESCE(excluded.total_calls, backtest_runs.total_calls),
          total_trades = COALESCE(excluded.total_trades, backtest_runs.total_trades),
          total_pnl_usd = COALESCE(excluded.total_pnl_usd, backtest_runs.total_pnl_usd),
          avg_return_bps = COALESCE(excluded.avg_return_bps, backtest_runs.avg_return_bps)
        `,
        [
          metadata.run_id,
          metadata.strategy_id ?? null,
          metadata.run_mode,
          metadata.status,
          metadata.params_json,
          metadata.interval ?? null,
          metadata.time_from ? new Date(metadata.time_from).toISOString() : null,
          metadata.time_to ? new Date(metadata.time_to).toISOString() : null,
          metadata.created_at ? new Date(metadata.created_at).toISOString() : null,
          metadata.started_at ? new Date(metadata.started_at).toISOString() : null,
          metadata.finished_at ? new Date(metadata.finished_at).toISOString() : null,
          metadata.error_text ?? null,
          metadata.total_calls ?? null,
          metadata.total_trades ?? null,
          metadata.total_pnl_usd ?? null,
          metadata.avg_return_bps ?? null,
        ],
        (err: any) => (err ? reject(err) : resolve())
      );
    });

    logger.info('Run metadata persisted to central DuckDB', {
      runId: metadata.run_id,
      status: metadata.status,
    });
  } finally {
    conn.close();
    db.close();
  }
}

/**
 * Persist call results to central DuckDB
 */
export async function persistCallResultsToCentral(rows: CallResultRow[]): Promise<void> {
  if (rows.length === 0) return;

  const db = openCentralDuckDb();
  await ensureCentralBacktestSchema(db);

  const conn = db.connect();
  try {
    const adapter = createAdapter(conn);
    await insertCallResults(adapter, rows);
    logger.info('Call results persisted to central DuckDB', { rows: rows.length });
  } finally {
    conn.close();
    db.close();
  }
}

/**
 * Persist path metrics to central DuckDB
 */
export async function persistPathMetricsToCentral(rows: PathMetricsRow[]): Promise<void> {
  if (rows.length === 0) return;

  const db = openCentralDuckDb();
  await ensureCentralBacktestSchema(db);

  const conn = db.connect();
  try {
    const adapter = createAdapter(conn);
    await insertPathMetrics(adapter, rows);
    logger.info('Path metrics persisted to central DuckDB', { rows: rows.length });
  } finally {
    conn.close();
    db.close();
  }
}

/**
 * Persist policy results to central DuckDB
 */
export async function persistPolicyResultsToCentral(rows: PolicyResultRow[]): Promise<void> {
  if (rows.length === 0) return;

  const db = openCentralDuckDb();
  await ensureCentralBacktestSchema(db);

  const conn = db.connect();
  try {
    const adapter = createAdapter(conn);
    await insertPolicyResults(adapter, rows);
    logger.info('Policy results persisted to central DuckDB', { rows: rows.length });
  } finally {
    conn.close();
    db.close();
  }
}

/**
 * Get all runs from central DuckDB
 */
export async function getAllRunsFromCentral(): Promise<BacktestRunMetadata[]> {
  const db = openCentralDuckDb();
  await ensureCentralBacktestSchema(db);

  const conn = db.connect();
  try {
    return new Promise<BacktestRunMetadata[]>((resolve, reject) => {
      (conn.all as any)(
        `SELECT * FROM backtest_runs ORDER BY created_at DESC`,
        [],
        (err: any, rows: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows as BacktestRunMetadata[]);
          }
        }
      );
    });
  } finally {
    conn.close();
    db.close();
  }
}

/**
 * Backtest Results Adapter
 *
 * Implements BacktestResultsPort using DuckDB and filesystem access.
 * This adapter handles all I/O operations, allowing handlers to be pure.
 */

import type {
  BacktestResultsPort,
  RunSummary,
  CallerPathRow,
  TradeResultRow,
  RunSummaryQuery,
  ExportOptions,
} from '@quantbot/core';
import { join, dirname } from 'path';
import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import { DateTime } from 'luxon';

/**
 * DuckDB connection type (callback-based API)
 */
type DuckDbConnection = {
  all<T = unknown>(sql: string, params: unknown[], callback: (err: unknown, rows: T[]) => void): void;
  run(sql: string, params: unknown[], callback: (err: unknown) => void): void;
};

/**
 * Create DuckDB connection adapter
 */
function createDuckDbAdapter(db: {
  all: (sql: string, params: unknown[], callback: (err: unknown, rows: unknown[]) => void) => void;
  run?: (sql: string, params: unknown[], callback: (err: unknown) => void) => void;
}): DuckDbConnection {
  return {
    all<T = unknown>(sql: string, params: unknown[], callback: (err: unknown, rows: T[]) => void): void {
      db.all(sql, params, (err: unknown, rows: unknown) => {
        if (err) {
          callback(err, []);
        } else {
          callback(null, (rows || []) as T[]);
        }
      });
    },
    run(sql: string, params: unknown[], callback: (err: unknown) => void): void {
      if (db.run) {
        db.run(sql, params, callback);
      } else {
        callback(new Error('run method not available'));
      }
    },
  };
}

/**
 * Helper to query DuckDB
 */
function queryDuckDB<T>(
  db: DuckDbConnection,
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    db.all<T>(sql, params, (err: unknown, rows: T[]) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows);
      }
    });
  });
}

/**
 * Backtest Results Adapter
 *
 * Provides access to backtest results via DuckDB and filesystem.
 */
export class BacktestResultsAdapter implements BacktestResultsPort {
  private readonly artifactsBaseDir: string;

  constructor(artifactsBaseDir?: string) {
    this.artifactsBaseDir = artifactsBaseDir || join(process.cwd(), 'artifacts', 'backtest');
  }

  async getRunSummary(runId: string): Promise<RunSummary | null> {
    const duckdbPath = join(this.artifactsBaseDir, runId, 'results.duckdb');

    if (!existsSync(duckdbPath)) {
      return null;
    }

    const duckdb = await import('duckdb');
    const database = new duckdb.Database(duckdbPath);
    const db = database.connect();

    try {
      const adapter = createDuckDbAdapter(db);
      const sql = `
        SELECT
          run_id,
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
        FROM backtest_call_results
        WHERE run_id = $1
        GROUP BY run_id
      `;

      const rows = await queryDuckDB<{
        run_id: string;
        total_trades: number;
        total_pnl_usd: number;
        total_pnl_pct: number;
        avg_return_bps: number;
        win_rate: number;
        max_drawdown_bps: number;
        median_drawdown_bps: number | null;
        total_calls: number;
        unique_callers: number;
        created_at: string | null;
      }>(adapter, sql, [runId]);

      if (rows.length === 0) {
        return null;
      }

      const row = rows[0]!;
      return {
        runId: row.run_id,
        totalTrades: row.total_trades,
        totalPnlUsd: row.total_pnl_usd,
        totalPnlPct: row.total_pnl_pct,
        avgReturnBps: row.avg_return_bps,
        winRate: row.win_rate,
        maxDrawdownBps: row.max_drawdown_bps,
        medianDrawdownBps: row.median_drawdown_bps,
        totalCalls: row.total_calls,
        uniqueCallers: row.unique_callers,
        createdAt: row.created_at,
      };
    } finally {
      database.close();
    }
  }

  async getCallerPathReport(runId: string): Promise<CallerPathRow[]> {
    const duckdbPath = join(this.artifactsBaseDir, runId, 'results.duckdb');

    if (!existsSync(duckdbPath)) {
      return [];
    }

    const duckdb = await import('duckdb');
    const database = new duckdb.Database(duckdbPath);
    const db = database.connect();

    try {
      const adapter = createDuckDbAdapter(db);
      // Use dynamic import - backtest package re-exports from simulation
      // @ts-expect-error - Dynamic import may not resolve at compile time
      const backtestModule = await import('@quantbot/backtest');
      if ('getCallerPathReport' in backtestModule && typeof backtestModule.getCallerPathReport === 'function') {
        return backtestModule.getCallerPathReport(adapter, runId);
      }
      throw new Error('getCallerPathReport not available in @quantbot/backtest');
    } finally {
      database.close();
    }
  }

  async getTradeResults(runId: string): Promise<TradeResultRow[]> {
    const duckdbPath = join(this.artifactsBaseDir, runId, 'results.duckdb');

    if (!existsSync(duckdbPath)) {
      return [];
    }

    const duckdb = await import('duckdb');
    const database = new duckdb.Database(duckdbPath);
    const db = database.connect();

    try {
      const adapter = createDuckDbAdapter(db);
      const sql = `
        SELECT *
        FROM backtest_call_results
        WHERE run_id = $1
        ORDER BY created_at
      `;

      return queryDuckDB<TradeResultRow>(adapter, sql, [runId]);
    } finally {
      database.close();
    }
  }

  async listRunSummaries(query?: RunSummaryQuery): Promise<RunSummary[]> {
    // Use dynamic import - backtest package re-exports from simulation
    // @ts-expect-error - Dynamic import may not resolve at compile time
    const backtestModule = await import('@quantbot/backtest');
    if (!('getAllRunSummaries' in backtestModule) || typeof backtestModule.getAllRunSummaries !== 'function') {
      throw new Error('getAllRunSummaries not available in @quantbot/backtest');
    }
    const summaries = await backtestModule.getAllRunSummaries(this.artifactsBaseDir);

    let filtered = summaries.map((s: {
      run_id: string;
      total_trades: number;
      total_pnl_usd: number;
      total_pnl_pct: number;
      avg_return_bps: number;
      win_rate: number;
      max_drawdown_bps: number;
      median_drawdown_bps: number | null;
      total_calls: number;
      unique_callers: number;
      created_at: string | null;
    }) => ({
      runId: s.run_id,
      totalTrades: s.total_trades,
      totalPnlUsd: s.total_pnl_usd,
      totalPnlPct: s.total_pnl_pct,
      avgReturnBps: s.avg_return_bps,
      winRate: s.win_rate,
      maxDrawdownBps: s.max_drawdown_bps,
      medianDrawdownBps: s.median_drawdown_bps,
      totalCalls: s.total_calls,
      uniqueCallers: s.unique_callers,
      createdAt: s.created_at,
    }));

    // Apply filters
    if (query?.runId) {
      filtered = filtered.filter((s: RunSummary) => s.runId === query.runId);
    }

    if (query?.fromDate) {
      const from = DateTime.fromISO(query.fromDate);
      if (from.isValid) {
        filtered = filtered.filter((s: RunSummary) => {
          if (!s.createdAt) return false;
          const created = DateTime.fromISO(s.createdAt);
          return created.isValid && created >= from;
        });
      }
    }

    if (query?.toDate) {
      const to = DateTime.fromISO(query.toDate);
      if (to.isValid) {
        filtered = filtered.filter((s: RunSummary) => {
          if (!s.createdAt) return false;
          const created = DateTime.fromISO(s.createdAt);
          return created.isValid && created <= to;
        });
      }
    }

    // Sort by created_at descending
    filtered.sort((a: RunSummary, b: RunSummary) => {
      if (!a.createdAt && !b.createdAt) return 0;
      if (!a.createdAt) return 1;
      if (!b.createdAt) return -1;
      return DateTime.fromISO(b.createdAt).toMillis() - DateTime.fromISO(a.createdAt).toMillis();
    });

    // Apply limit
    if (query?.limit) {
      filtered = filtered.slice(0, query.limit);
    }

    return filtered;
  }

  async exportResults(
    runId: string,
    outputPath: string,
    options: ExportOptions
  ): Promise<{ outputPath: string; recordsExported: number }> {
    const { format, includeTrades = false, includeMetrics = true } = options;

    // Ensure output directory exists
    const outputDir = dirname(outputPath);
    if (outputDir !== '.') {
      await mkdir(outputDir, { recursive: true });
    }

    const duckdbPath = join(this.artifactsBaseDir, runId, 'results.duckdb');

    if (!existsSync(duckdbPath)) {
      throw new Error(`Backtest results not found for run ID: ${runId}`);
    }

    const duckdb = await import('duckdb');
    const database = new duckdb.Database(duckdbPath);
    const db = database.connect();

    try {
      const adapter = createDuckDbAdapter(db);

      if (format === 'parquet') {
        // Use DuckDB's native Parquet export
        const exportSql = `
          COPY (
            SELECT *
            FROM backtest_call_results
            WHERE run_id = $1
          )
          TO '${outputPath}'
          (FORMAT PARQUET)
        `;

        await new Promise<void>((resolve, reject) => {
          adapter.run(exportSql, [runId], (err: unknown) => {
            if (err) reject(err);
            else resolve();
          });
        });

        // Count records for return value
        const countRows = await queryDuckDB<{ count: number }>(
          adapter,
          'SELECT COUNT(*)::INT AS count FROM backtest_call_results WHERE run_id = $1',
          [runId]
        );
        const recordsExported = countRows[0]?.count || 0;

        return { outputPath, recordsExported };
      } else if (format === 'json') {
        // Export as JSON
        const exportData: Record<string, unknown> = {
          runId,
          exportedAt: new Date().toISOString(),
        };

        if (includeMetrics) {
          const summary = await this.getRunSummary(runId);
          exportData.metrics = summary;
        }

        if (includeTrades) {
          const trades = await this.getTradeResults(runId);
          exportData.trades = trades;
        }

        const callers = await this.getCallerPathReport(runId);
        exportData.callers = callers;

        await writeFile(outputPath, JSON.stringify(exportData, null, 2), 'utf-8');

        return { outputPath, recordsExported: callers.length };
      } else {
        // CSV format
        const callers = await this.getCallerPathReport(runId);

        if (callers.length === 0) {
          throw new Error('No data to export');
        }

        const columns = Object.keys(callers[0]!);
        const csvLines = [columns.join(',')];

        for (const row of callers) {
          const values = columns.map((col) => {
            const val = (row as unknown as Record<string, unknown>)[col];
            if (val === null || val === undefined) return '';
            const str = String(val);
            if (str.includes(',') || str.includes('"') || str.includes('\n')) {
              return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
          });
          csvLines.push(values.join(','));
        }

        await writeFile(outputPath, csvLines.join('\n'), 'utf-8');

        return { outputPath, recordsExported: callers.length };
      }
    } finally {
      database.close();
    }
  }

  async isAvailable(): Promise<boolean> {
    try {
      return existsSync(this.artifactsBaseDir);
    } catch {
      return false;
    }
  }
}



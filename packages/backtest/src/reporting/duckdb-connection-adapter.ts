/**
 * DuckDB Connection Adapter
 *
 * Adapts DuckDBClient (Python-based) to DuckDbConnection interface (callback-based)
 * This allows existing code using DuckDbConnection to work with Python-based DuckDB access.
 */

import type { DuckDbConnection } from './backtest-results-duckdb.js';
import { DuckDBClient } from '@quantbot/storage';

/**
 * Escape SQL string value for safe interpolation
 */
function escapeSqlString(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'string') {
    // Escape single quotes by doubling them
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  if (value instanceof Date) {
    return `'${value.toISOString()}'`;
  }
  // For other types, convert to string and escape
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Convert parameterized query to SQL with escaped parameters
 * DuckDB uses $1, $2, etc. for parameters
 */
function parameterizeSql(sql: string, params: any[]): string {
  let result = sql;
  for (let i = 0; i < params.length; i++) {
    const placeholder = `$${i + 1}`;
    const value = escapeSqlString(params[i]);
    // Replace $1, $2, etc. with escaped values
    result = result.replace(new RegExp(`\\$${i + 1}(?![0-9])`, 'g'), value);
  }
  return result;
}

/**
 * Create a DuckDbConnection adapter from DuckDBClient
 */
export function createDuckDbConnectionAdapter(client: DuckDBClient): DuckDbConnection {
  return {
    run(sql: string, params: any[], callback: (err: any) => void): void {
      const parameterizedSql = params.length > 0 ? parameterizeSql(sql, params) : sql;
      client
        .execute(parameterizedSql)
        .then(() => callback(null))
        .catch((err) => callback(err));
    },

    all<T = any>(sql: string, params: any[], callback: (err: any, rows: T[]) => void): void {
      const parameterizedSql = params.length > 0 ? parameterizeSql(sql, params) : sql;
      client
        .query(parameterizedSql)
        .then((result) => {
          if (result.error) {
            callback(new Error(result.error), []);
            return;
          }
          // Convert rows from array of arrays to array of objects
          const columns = result.columns.map((col) => col.name);
          const rows: T[] = result.rows.map((row) => {
            const obj: Record<string, unknown> = {};
            for (let i = 0; i < columns.length; i++) {
              obj[columns[i]] = row[i];
            }
            return obj as T;
          });
          callback(null, rows);
        })
        .catch((err) => callback(err, []));
    },

    prepare(sql: string, callback: (err: any, stmt: any) => void): void {
      // For prepared statements, we create a simple wrapper
      // that stores the SQL and applies parameters when run is called
      const stmt = {
        sql,
        run: (params: any[], runCallback: (err: any) => void) => {
          const parameterizedSql = parameterizeSql(sql, params);
          client
            .execute(parameterizedSql)
            .then(() => runCallback(null))
            .catch((err) => runCallback(err));
        },
        finalize: (callback: () => void) => {
          // No-op for Python-based client
          callback();
        },
      };
      callback(null, stmt);
    },
  };
}


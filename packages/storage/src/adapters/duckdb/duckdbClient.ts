/**
 * DuckDB Client Adapter
 *
 * This is an ADAPTER that wraps the duckdb SDK for use by handlers and apps.
 *
 * Architecture:
 * - Adapters implement ports and depend on external SDKs
 * - Handlers depend on ports, not adapters directly
 * - Apps wire adapters to handlers
 *
 * Design:
 * - READ-ONLY by default to prevent lock conflicts
 * - Write connections require explicit opt-in via { readOnly: false }
 * - Connections must be closed to prevent WAL files
 *
 * @module
 */

import fs from 'node:fs';
import path from 'node:path';

export type DuckDbConnection = {
  run(sql: string, params?: any[]): Promise<void>;
  all<T = any>(sql: string, params?: any[]): Promise<T[]>;
  close(): Promise<void>;
};

export interface OpenDuckDbOptions {
  /** Open in read-only mode (default: true for safety) */
  readOnly?: boolean;
}

/**
 * Open a DuckDB connection.
 *
 * By default opens in read-only mode to prevent lock conflicts.
 * Use { readOnly: false } explicitly when you need to write.
 *
 * @example
 * // Read-only (default, safe for concurrent access)
 * const db = await openDuckDb('data/alerts.duckdb');
 * const rows = await db.all('SELECT * FROM table');
 * await db.close();
 *
 * @example
 * // Writable (use only at end of runs)
 * const db = await openDuckDb('data/alerts.duckdb', { readOnly: false });
 * await db.run('INSERT INTO table VALUES (?)', [value]);
 * await db.close();
 */
export async function openDuckDb(
  dbPath: string,
  options: OpenDuckDbOptions = {}
): Promise<DuckDbConnection> {
  const { readOnly = true } = options;

  const duckdbModule = await import('duckdb');
  // Handle both ESM default export and CommonJS module.exports
  const duckdb = duckdbModule.default || duckdbModule;

  if (!readOnly) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  // DuckDB access mode: DUCKDB_READONLY = 1
  const accessMode = readOnly ? 1 : undefined;
  const db = new duckdb.Database(dbPath, accessMode);
  const conn = db.connect();

  const run = (sql: string, params?: any[]) =>
    new Promise<void>((resolve, reject) => {
      if (params && params.length > 0) {
        // DuckDB Node.js requires prepared statements for parameterized queries
        // Parameters must be passed as individual arguments, not as an array
        const stmt = conn.prepare(sql);
        stmt.run(...params, (err: any) => {
          stmt.finalize(() => {
            if (err) reject(err);
            else resolve();
          });
        });
      } else {
        // No params - run directly
        conn.run(sql, (err: any) => (err ? reject(err) : resolve()));
      }
    });

  const all = <T = any>(sql: string, params?: any[]) =>
    new Promise<T[]>((resolve, reject) => {
      // DuckDB's all method callback signature: (err, rows) where rows is TableData
      // We cast to T[] since we know the structure matches
      // Type assertion needed because DuckDB's callback types don't match our generic Promise interface
      if (params && params.length > 0) {
        (conn.all as any)(sql, params, (err: any, rows: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows as T[]);
          }
        });
      } else {
        // Don't pass params if empty - DuckDB doesn't like empty param arrays
        (conn.all as any)(sql, (err: any, rows: any) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows as T[]);
          }
        });
      }
    });

  const close = () =>
    new Promise<void>((resolve, reject) => {
      try {
        db.close((err: any) => {
          if (err) reject(err);
          else resolve();
        });
      } catch {
        // Sync close fallback
        resolve();
      }
    });

  return { run, all, close };
}

export async function runSqlFile(conn: DuckDbConnection, filePath: string): Promise<void> {
  const sql = fs.readFileSync(filePath, 'utf8');
  // DuckDB can run multiple statements separated by semicolons.
  await conn.run(sql);
}

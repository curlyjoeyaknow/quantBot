import fs from 'node:fs';
import path from 'node:path';

export type DuckDbConnection = {
  run(sql: string, params?: any[]): Promise<void>;
  all<T = any>(sql: string, params?: any[]): Promise<T[]>;
};

export interface OpenDuckDbOptions {
  /**
   * If true, open in read-only mode (prevents locks).
   * Note: Node.js DuckDB bindings may not support read-only mode directly.
   * For true read-only access, prefer using Python adapter via DuckDBClient.
   */
  readOnly?: boolean;
}

/**
 * Open a DuckDB connection.
 *
 * Rule: Only ONE writer process should open the DB in write mode.
 * Everyone else should use READ_ONLY connections or query Parquet.
 *
 * Note: DuckDB handles locking automatically (no SQLite-style busy_timeout needed).
 *
 * @param dbPath - Path to DuckDB file
 * @param options - Connection options
 * @returns DuckDB connection
 */
export async function openDuckDb(
  dbPath: string,
  options?: OpenDuckDbOptions
): Promise<DuckDbConnection> {
  const duckdbModule = await import('duckdb');
  // Handle both ESM default export and CommonJS module.exports
  const duckdb = duckdbModule.default || duckdbModule;
  
  // Only create directory if not read-only and not in-memory
  const isReadOnly = options?.readOnly === true;
  const isInMemory = dbPath === ':memory:' || dbPath === '';
  
  if (!isReadOnly && !isInMemory) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  // Note: DuckDB Node.js bindings may not support read-only mode in constructor options.
  // For read-only access, we avoid creating directories and rely on DuckDB's automatic locking.
  // DuckDB handles locking automatically - no need for busy_timeout (SQLite-specific pragma)
  // If read-only is requested and file doesn't exist, this will fail gracefully.
  const db = new duckdb.Database(dbPath);
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

  return { run, all };
}

export async function runSqlFile(conn: DuckDbConnection, filePath: string): Promise<void> {
  const sql = fs.readFileSync(filePath, 'utf8');
  // DuckDB can run multiple statements separated by semicolons.
  await conn.run(sql);
}

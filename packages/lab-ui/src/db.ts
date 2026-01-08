import fs from 'node:fs';
import path from 'node:path';

/**
 * Inline DuckDB connection to avoid broken @quantbot/storage dependency chain.
 * This is a temporary workaround until the storage package type issues are resolved.
 */
export type DuckDbConnection = {
  run(sql: string, params?: any[]): Promise<void>;
  all<T = any>(sql: string, params?: any[]): Promise<T[]>;
  close(): Promise<void>;
};

export type DuckDb = DuckDbConnection;

async function openDuckDbImpl(
  dbPath: string,
  options: { readOnly?: boolean } = {}
): Promise<DuckDbConnection> {
  const { readOnly = true } = options;

  const duckdbModule = await import('duckdb');
  const duckdb = (duckdbModule as any).default || duckdbModule;

  if (!readOnly) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const accessMode = readOnly ? 1 : undefined;
  const db = new duckdb.Database(dbPath, accessMode);
  const conn = db.connect();

  const run = (sql: string, params?: any[]) =>
    new Promise<void>((resolve, reject) => {
      if (params && params.length > 0) {
        const stmt = conn.prepare(sql);
        stmt.run(...params, (err: any) => {
          stmt.finalize(() => {
            if (err) reject(err);
            else resolve();
          });
        });
      } else {
        conn.run(sql, (err: any) => (err ? reject(err) : resolve()));
      }
    });

  const all = <T = any>(sql: string, params?: any[]) =>
    new Promise<T[]>((resolve, reject) => {
      if (params && params.length > 0) {
        // DuckDB Node.js requires prepared statements for parameterized queries
        const stmt = conn.prepare(sql);
        stmt.all(...params, (err: any, rows: any) => {
          stmt.finalize(() => {
            if (err) reject(err);
            else resolve(rows as T[]);
          });
        });
      } else {
        (conn.all as any)(sql, (err: any, rows: any) => {
          if (err) reject(err);
          else resolve(rows as T[]);
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
        resolve();
      }
    });

  return { run, all, close };
}

export async function openDuckDb(): Promise<DuckDb> {
  const dbPath = process.env.DUCKDB_PATH ?? './data/tele.duckdb';

  if (process.env.LAB_UI_DEBUG_DB) {
    console.log(`[lab-ui] DuckDB path: ${dbPath}`);
    console.log(`[lab-ui] Node: ${process.version}`);
  }

  // Open in write mode to allow schema creation
  return await openDuckDbImpl(dbPath, { readOnly: false });
}

// Re-export helpers that match the storage adapter interface
export async function run(db: DuckDb, sql: string, params: any[] = []) {
  return db.run(sql, params);
}

export async function all<T>(db: DuckDb, sql: string, params: any[] = []) {
  return db.all<T>(sql, params);
}

export async function get<T>(db: DuckDb, sql: string, params: any[] = []) {
  const rows = await all<T>(db, sql, params);
  return rows[0];
}

// exec() for multi-statement DDL - use run() with empty params
export async function exec(db: DuckDb, sql: string) {
  return db.run(sql, []);
}

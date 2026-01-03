import { openDuckDb as storageOpenDuckDb } from '@quantbot/storage';
import type { DuckDbConnection } from '@quantbot/storage';

// Re-export the working storage adapter
export type DuckDb = DuckDbConnection;

export async function openDuckDb(): Promise<DuckDb> {
  const dbPath = process.env.DUCKDB_PATH ?? './data/tele.duckdb';

  if (process.env.LAB_UI_DEBUG_DB) {
     
    console.log(`[lab-ui] DuckDB path: ${dbPath}`);
     
    console.log(`[lab-ui] Node: ${process.version}`);
  }

  return await storageOpenDuckDb(dbPath);
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

import fs from 'node:fs';
import path from 'node:path';

export type DuckDbConnection = {
  run(sql: string, params?: any[]): Promise<void>;
  all<T = any>(sql: string, params?: any[]): Promise<T[]>;
};

export async function openDuckDb(dbPath: string): Promise<DuckDbConnection> {
  const duckdb = await import('duckdb');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new duckdb.Database(dbPath);
  const conn = db.connect();

  const run = (sql: string, params: any[] = []) =>
    new Promise<void>((resolve, reject) => {
      conn.run(sql, params, (err: any) => (err ? reject(err) : resolve()));
    });

  const all = <T = any>(sql: string, params: any[] = []) =>
    new Promise<T[]>((resolve, reject) => {
      // DuckDB's all method callback signature: (err, rows) where rows is TableData
      // We cast to T[] since we know the structure matches
      // Type assertion needed because DuckDB's callback types don't match our generic Promise interface
      (conn.all as any)(sql, params, (err: any, rows: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows as T[]);
        }
      });
    });

  return { run, all };
}

export async function runSqlFile(conn: DuckDbConnection, filePath: string): Promise<void> {
  const sql = fs.readFileSync(filePath, 'utf8');
  // DuckDB can run multiple statements separated by semicolons.
  await conn.run(sql);
}

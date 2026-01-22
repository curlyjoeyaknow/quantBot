// Lazy import to avoid loading native bindings at module load time
let duckdbModule: typeof import('duckdb') | null = null;

async function getDuckdbModule() {
  if (!duckdbModule) {
    duckdbModule = await import('duckdb');
  }
  // DuckDB module doesn't have default export, it's a namespace
  return duckdbModule;
}

type DuckDbModule = Awaited<ReturnType<typeof getDuckdbModule>>;
export type DuckDb = InstanceType<DuckDbModule['Database']>;

function run(db: DuckDb, sql: string, params: any[] = []) {
  return new Promise<void>((resolve, reject) => {
    const conn = db.connect();
    conn.run(sql, params, (err: any) => (err ? reject(err) : resolve()));
  });
}

function all<T>(db: DuckDb, sql: string, params: any[] = []) {
  return new Promise<T[]>((resolve, reject) => {
    const conn = db.connect();
    (conn.all as any)(sql, params, (err: any, rows: any) => {
      if (err) {
        reject(err);
      } else {
        resolve(rows as T[]);
      }
    });
  });
}

/**
 * Open DuckDB database from path
 *
 * Pure function: accepts path as parameter instead of reading from env.
 * Config resolution happens in composition roots (CLI handlers).
 */
export async function openDuckDb(path: string): Promise<DuckDb> {
  if (!path) {
    throw new Error('DuckDB path is required');
  }
  const duckdb = await getDuckdbModule();
  return new duckdb.Database(path) as DuckDb;
}

/**
 * @deprecated Use openDuckDb(path) instead. This function reads from env and violates handler purity.
 * Kept for backward compatibility during migration.
 */
export async function openDuckDbFromEnv(): Promise<DuckDb> {
  const path = process.env.DUCKDB_PATH;
  if (!path) throw new Error('DUCKDB_PATH env var is required (same file used by calls + UI).');
  const duckdb = await getDuckdbModule();
  return new duckdb.Database(path) as DuckDb;
}

export async function ensureBacktestStrategyTables(db: DuckDb) {
  await run(
    db,
    `
    CREATE TABLE IF NOT EXISTS backtest_strategies (
      strategy_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      config_json TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS backtest_runs (
      run_id TEXT PRIMARY KEY,
      strategy_id TEXT NOT NULL,
      status TEXT NOT NULL,
      params_json TEXT NOT NULL,
      created_at TIMESTAMP DEFAULT now(),
      started_at TIMESTAMP,
      finished_at TIMESTAMP,
      error_text TEXT
    );
    `
  );
}

export async function loadStrategyConfigJson(db: DuckDb, strategyId: string): Promise<string> {
  await ensureBacktestStrategyTables(db);
  const rows = await all<{ config_json: string }>(
    db,
    `SELECT config_json FROM backtest_strategies WHERE strategy_id=$1`,
    [strategyId]
  );
  if (rows.length === 0) throw new Error(`Strategy not found: ${strategyId}`);
  return rows[0].config_json;
}

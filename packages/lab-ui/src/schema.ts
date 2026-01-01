import type { DuckDb } from "./db";
import { exec } from "./db";

export async function ensureUiSchema(db: DuckDb) {
  // Use exec(): it can execute multiple DDL statements in one call (no params).
  await exec(
    db,
    `CREATE TABLE IF NOT EXISTS backtest_strategies (
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

    CREATE INDEX IF NOT EXISTS idx_runs_created ON backtest_runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON backtest_runs(status);`
  );
}

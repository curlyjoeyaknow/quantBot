/**
 * DuckDB Strategy Store
 *
 * Stores and retrieves backtest strategy configurations from DuckDB.
 * Uses Python via DuckDBClient for all database operations.
 */

import { DuckDBClient, getDuckDBClient } from '@quantbot/storage';
import { getDuckDBPath } from '@quantbot/utils';

/**
 * Get DuckDB client for strategy storage
 */
function getStrategyDbClient(): DuckDBClient {
  const path = process.env.DUCKDB_PATH;
  if (!path) throw new Error('DUCKDB_PATH env var is required (same file used by calls + UI).');
  return getDuckDBClient(path);
}

/**
 * Ensure backtest strategy tables exist
 */
export async function ensureBacktestStrategyTables(client: DuckDBClient): Promise<void> {
  await client.execute(`
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
  `);
}

/**
 * Load strategy configuration JSON from DuckDB
 */
export async function loadStrategyConfigJson(strategyId: string): Promise<string> {
  const client = getStrategyDbClient();
  await ensureBacktestStrategyTables(client);

  const result = await client.query(
    `SELECT config_json FROM backtest_strategies WHERE strategy_id = '${strategyId.replace(/'/g, "''")}'`
  );

  if (result.error) {
    throw new Error(`Failed to query strategy: ${result.error}`);
  }

  if (result.rows.length === 0) {
    throw new Error(`Strategy not found: ${strategyId}`);
  }

  // Extract config_json from first row, first column
  const configJson = result.rows[0]?.[0];
  if (typeof configJson !== 'string') {
    throw new Error(`Invalid config_json format for strategy: ${strategyId}`);
  }

  return configJson;
}

/**
 * Open DuckDB from environment (for backward compatibility)
 * Returns a DuckDBClient instance
 */
export async function openDuckDbFromEnv(): Promise<DuckDBClient> {
  return getStrategyDbClient();
}

/**
 * Test Helper: Create DuckDB with Test Data
 *
 * Creates a real DuckDB file with the schema and test data needed for OHLCV ingestion tests.
 * Uses PythonEngine to execute Python scripts, ensuring we test the real integration boundary.
 */

import { join } from 'path';
import { existsSync, unlinkSync } from 'fs';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { writeFileSync, rmSync } from 'fs';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { tmpdir } from 'os';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { getPythonEngine } from '@quantbot/utils';
import type { PythonEngine } from '@quantbot/utils';
import { z } from 'zod';

export interface TestCall {
  mint: string;
  chain?: string;
  triggerTsMs: number;
  chatId?: string;
  messageId?: number;
}

const CreateDuckDBResultSchema = z.object({
  success: z.boolean(),
  message: z.string(),
});

/**
 * Create a DuckDB file with test data for OHLCV ingestion
 *
 * Uses execa to run Python directly (setup operation, not part of integration boundary).
 * The real integration test uses PythonEngine.runOhlcvWorklist() which calls the actual Python script.
 */
export async function createTestDuckDB(
  dbPath: string,
  calls: TestCall[],
  _pythonEngine?: PythonEngine
): Promise<void> {
  // Use execa directly for DuckDB creation (setup step)
  const { execa } = await import('execa');
  const { resolve } = await import('path');

  // Resolve to absolute path to ensure Python script can find it
  const absoluteDbPath = resolve(dbPath);

  const pythonScript = `
import duckdb
import sys
import json

import os
db_path = os.path.abspath(sys.argv[1])
calls_json = sys.argv[2]

# Connect to DuckDB
con = duckdb.connect(db_path)

# Create schema (use caller_links_d - normalized schema)
con.execute("""
CREATE TABLE IF NOT EXISTS caller_links_d (
  trigger_chat_id TEXT,
  trigger_message_id BIGINT,
  trigger_ts_ms BIGINT,
  trigger_from_id TEXT,
  trigger_from_name TEXT,
  trigger_text TEXT,
  bot_message_id BIGINT,
  bot_ts_ms BIGINT,
  bot_from_name TEXT,
  bot_type TEXT,
  token_name TEXT,
  ticker TEXT,
  mint TEXT,
  mint_raw TEXT,
  mint_validation_status TEXT,
  mint_validation_reason TEXT,
  chain TEXT,
  platform TEXT,
  token_age_s BIGINT,
  token_created_ts_ms BIGINT,
  views BIGINT,
  price_usd DOUBLE,
  price_move_pct DOUBLE,
  mcap_usd DOUBLE,
  mcap_change_pct DOUBLE,
  vol_usd DOUBLE,
  liquidity_usd DOUBLE,
  zero_liquidity BOOLEAN DEFAULT FALSE,
  chg_1h_pct DOUBLE,
  buys_1h BIGINT,
  sells_1h BIGINT,
  ath_mcap_usd DOUBLE,
  ath_drawdown_pct DOUBLE,
  ath_age_s BIGINT,
  fresh_1d_pct DOUBLE,
  fresh_7d_pct DOUBLE,
  top10_pct DOUBLE,
  holders_total BIGINT,
  top5_holders_pct_json TEXT,
  dev_sold BOOLEAN,
  dex_paid BOOLEAN,
  card_json TEXT,
  validation_passed BOOLEAN,
  run_id TEXT NOT NULL DEFAULT 'test',
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
""")

# Parse calls JSON
calls = json.loads(calls_json)

# Insert test calls
for i, call in enumerate(calls):
    chat_id = call.get('chatId') or 'test_chat'
    message_id = call.get('messageId') or (i + 1)
    trigger_ts_ms = call.get('triggerTsMs') or 0
    mint = call.get('mint') or ''
    chain = call.get('chain') or 'solana'
    
    # Ensure trigger_ts_ms is an integer
    if trigger_ts_ms is None:
        trigger_ts_ms = 0
    trigger_ts_ms = int(trigger_ts_ms)
    
    con.execute("""
        INSERT INTO caller_links_d (
            trigger_chat_id, trigger_message_id, trigger_ts_ms,
            trigger_from_id, trigger_from_name, trigger_text,
            bot_message_id, bot_ts_ms, bot_from_name, bot_type,
            mint, chain, run_id, price_usd, mcap_usd
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        chat_id,
        message_id,
        trigger_ts_ms,
        'test_caller_id',
        'Test Caller',
        f"Call for {mint}",
        i + 1000,  # bot_message_id
        trigger_ts_ms + 1000,  # bot_ts_ms (1 second after trigger)
        'Rick',
        'call',
        mint,
        chain,
        'test',
        None,  # price_usd (nullable)
        None   # mcap_usd (nullable)
    ])

con.close()
print("DuckDB created successfully")
`;

  // Execute Python script directly (setup operation)
  const result = await execa(
    'python3',
    ['-c', pythonScript, absoluteDbPath, JSON.stringify(calls)],
    {
      cwd: process.cwd(),
    }
  );

  if (result.exitCode !== 0) {
    throw new Error(`Failed to create test DuckDB: ${result.stderr}`);
  }
}

/**
 * Clean up test DuckDB file
 */
export function cleanupTestDuckDB(dbPath: string): void {
  if (existsSync(dbPath)) {
    unlinkSync(dbPath);
  }
}

/**
 * Create a temporary DuckDB path for testing
 */
export function createTempDuckDBPath(prefix: string = 'test'): string {
  return join(
    process.cwd(),
    `${prefix}_${Date.now()}_${Math.random().toString(36).substring(7)}.duckdb`
  );
}

/**
 * Copy the real DuckDB database for testing (protects original data)
 * Also ensures the schema exists (creates tables if they don't exist)
 */
export async function copyRealDuckDB(sourcePath: string, targetPath: string): Promise<void> {
  const { copyFile } = await import('fs/promises');
  const { existsSync } = await import('fs');
  const { execa } = await import('execa');
  const { resolve } = await import('path');

  if (existsSync(sourcePath)) {
    // Copy existing database
    await copyFile(sourcePath, targetPath);
  }

  // Ensure schema exists (create tables if they don't exist)
  // This ensures tests work even if the source DB doesn't have the schema
  const absoluteDbPath = resolve(targetPath);
  const pythonScript = `
import duckdb
import sys
import os

db_path = os.path.abspath(sys.argv[1])
con = duckdb.connect(db_path)

# Create caller_links_d table if it doesn't exist
con.execute("""
CREATE TABLE IF NOT EXISTS caller_links_d (
  trigger_chat_id TEXT,
  trigger_message_id BIGINT,
  trigger_ts_ms BIGINT,
  trigger_from_id TEXT,
  trigger_from_name TEXT,
  trigger_text TEXT,
  bot_message_id BIGINT,
  bot_ts_ms BIGINT,
  bot_from_name TEXT,
  bot_type TEXT,
  token_name TEXT,
  ticker TEXT,
  mint TEXT,
  mint_raw TEXT,
  mint_validation_status TEXT,
  mint_validation_reason TEXT,
  chain TEXT,
  platform TEXT,
  token_age_s BIGINT,
  token_created_ts_ms BIGINT,
  views BIGINT,
  price_usd DOUBLE,
  price_move_pct DOUBLE,
  mcap_usd DOUBLE,
  mcap_change_pct DOUBLE,
  vol_usd DOUBLE,
  liquidity_usd DOUBLE,
  zero_liquidity BOOLEAN DEFAULT FALSE,
  chg_1h_pct DOUBLE,
  buys_1h BIGINT,
  sells_1h BIGINT,
  ath_mcap_usd DOUBLE,
  ath_drawdown_pct DOUBLE,
  ath_age_s BIGINT,
  fresh_1d_pct DOUBLE,
  fresh_7d_pct DOUBLE,
  top10_pct DOUBLE,
  holders_total BIGINT,
  top5_holders_pct_json TEXT,
  dev_sold BOOLEAN,
  dex_paid BOOLEAN,
  card_json TEXT,
  validation_passed BOOLEAN,
  run_id TEXT NOT NULL DEFAULT 'test',
  inserted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
""")

# Create user_calls_d table as fallback
con.execute("""
CREATE TABLE IF NOT EXISTS user_calls_d (
  chat_id TEXT,
  message_id BIGINT,
  trigger_ts_ms BIGINT,
  mint TEXT,
  chain TEXT,
  price_usd DOUBLE,
  mcap_usd DOUBLE
);
""")

con.close()
print("Schema ensured")
`;

  await execa('python3', ['-c', pythonScript, absoluteDbPath]);
}

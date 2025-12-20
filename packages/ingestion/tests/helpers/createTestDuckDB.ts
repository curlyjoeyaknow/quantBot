/**
 * Test Helper: Create DuckDB with Test Data
 *
 * Creates a real DuckDB file with the schema and test data needed for OHLCV ingestion tests.
 * Uses PythonEngine to execute Python scripts, ensuring we test the real integration boundary.
 */

import { join } from 'path';
import { existsSync, unlinkSync, writeFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
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
  pythonEngine?: PythonEngine
): Promise<void> {
  // Use execa directly for DuckDB creation (setup step)
  const { execa } = await import('execa');

  const pythonScript = `
import duckdb
import sys
import json

db_path = sys.argv[1]
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
            mint, chain, run_id
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        'test'
    ])

con.close()
print("DuckDB created successfully")
`;

  // Execute Python script directly (setup operation)
  const result = await execa('python3', ['-c', pythonScript, dbPath, JSON.stringify(calls)], {
    cwd: process.cwd(),
  });

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

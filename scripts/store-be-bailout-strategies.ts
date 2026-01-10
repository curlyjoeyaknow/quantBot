#!/usr/bin/env tsx
/**
 * Store Break-Even Bailout Exit Plans in DuckDB
 *
 * Stores all exit plan configurations from optimize-be-bailout-configs.json
 * into DuckDB's backtest_strategies table for use with exit-stack mode.
 *
 * Each configuration includes TP/SL values in the configId.
 */

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
// Dynamic imports to avoid rootDir issues
type ExitPlan = any; // Will be resolved at runtime
type DuckDb = any;

async function run(db: DuckDb, sql: string, params: any[] = []): Promise<void> {
  return new Promise((resolve, reject) => {
    const conn = db.connect();
    conn.run(sql, params, (err: any) => (err ? reject(err) : resolve()));
  });
}

async function storeStrategy(
  db: DuckDb,
  strategyId: string,
  name: string,
  exitPlan: ExitPlan
): Promise<void> {
  await run(
    db,
    `INSERT OR REPLACE INTO backtest_strategies (strategy_id, name, config_json) VALUES (?, ?, ?)`,
    [strategyId, name, JSON.stringify(exitPlan)]
  );
}

async function main() {
  // Check for DUCKDB_PATH or use default
  const duckdbPath = process.env.DUCKDB_PATH || 'data/alerts.duckdb';

  if (!duckdbPath) {
    console.error('❌ DUCKDB_PATH environment variable is required');
    console.error('   Set it with: export DUCKDB_PATH=data/alerts.duckdb');
    process.exit(1);
  }

  // Dynamic imports
  const { ensureBacktestStrategyTables } =
    await import('../packages/backtest/src/strategy/duckdb-strategy-store.js');
  const duckdbModule = await import('duckdb');

  // Load configs
  const configsPath = resolve(process.cwd(), 'optimize-be-bailout-configs.json');
  if (!existsSync(configsPath)) {
    console.error(`❌ Config file not found: ${configsPath}`);
    console.error('   Run: pnpm exec tsx scripts/optimize-be-bailout.ts');
    process.exit(1);
  }
  const configsData = JSON.parse(readFileSync(configsPath, 'utf-8'));

  // Open DuckDB
  console.log(`Opening DuckDB: ${duckdbPath}`);
  const db = new duckdbModule.Database(duckdbPath);
  await ensureBacktestStrategyTables(db);

  console.log(`Storing ${configsData.configs.length} exit plan strategies...\n`);

  // Store each config
  for (const config of configsData.configs) {
    const strategyId = `be_bailout_${config.configId}`;
    const name = `BE Bailout: ${config.configId.replace(/_/g, ' ')}`;

    await storeStrategy(db, strategyId, name, config.exitPlan);
    console.log(`✓ Stored: ${strategyId}`);
  }

  console.log(`\n✅ Successfully stored ${configsData.configs.length} strategies in ${duckdbPath}`);
  console.log('\nTo run a backtest with a specific strategy:');
  console.log('  quantbot backtest run \\');
  console.log('    --strategy exit-stack \\');
  console.log('    --strategy-id be_bailout_tp_5p2x_sl_25pct_be_10pct_hold_30min_ladder_none \\');
  console.log('    --interval 5m \\');
  console.log('    --from 2024-01-01 \\');
  console.log('    --to 2024-12-31 \\');
  console.log('    --run-id <your-run-id>');

  // Close database
  db.close();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

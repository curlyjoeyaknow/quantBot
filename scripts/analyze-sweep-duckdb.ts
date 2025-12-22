#!/usr/bin/env node
/**
 * Sweep Analysis Script
 * =====================
 *
 * Analyzes sweep results by importing JSONL files into DuckDB and running queries.
 * Outputs CSV files for easy inspection and further analysis.
 *
 * Usage:
 *   tsx scripts/analyze-sweep-duckdb.ts <sweep-output-dir>
 *
 * Example:
 *   tsx scripts/analyze-sweep-duckdb.ts out/sweep-001/
 *
 * Outputs:
 *   - <sweep-output-dir>/analysis/leaderboard_by_overlay.csv
 *   - <sweep-output-dir>/analysis/leaderboard_by_lag_interval.csv
 *   - <sweep-output-dir>/analysis/caller_robustness.csv
 *   - <sweep-output-dir>/analysis/sweep.duckdb (DuckDB database)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PythonEngine } from '@quantbot/utils';

interface PerCallRow {
  sweepId: string;
  lagMs: number;
  interval: string;
  overlaySetId: string;
  overlayIndex: number;
  callTsMs: number;
  callerFromId: string;
  callerName: string;
  tokenAddress: string;
  tokenChain: string;
  overlay: unknown; // ExitOverlay
  entry: { tsMs: number; px: number };
  exit: { tsMs: number; px: number; reason: string };
  pnl: {
    grossReturnPct: number;
    netReturnPct: number;
    feesUsd: number;
    slippageUsd: number;
  };
  diagnostics: {
    candlesUsed: number;
    tradeable: boolean;
    skippedReason?: string;
  };
}

interface PerCallerRow {
  sweepId: string;
  lagMs: number;
  interval: string;
  overlaySetId: string;
  callerFromId: string;
  callerName: string;
  calls: number;
  tradeableCalls: number;
  medianNetReturnPct: number;
  winRate: number;
  bestOverlay?: unknown; // ExitOverlay
}

async function analyzeSweep(sweepDir: string): Promise<void> {
  const perCallPath = join(sweepDir, 'per_call.jsonl');
  const perCallerPath = join(sweepDir, 'per_caller.jsonl');
  const analysisDir = join(sweepDir, 'analysis');
  const duckdbPath = join(analysisDir, 'sweep.duckdb');

  // Check inputs exist
  if (!existsSync(perCallPath)) {
    throw new Error(`per_call.jsonl not found at ${perCallPath}`);
  }
  if (!existsSync(perCallerPath)) {
    throw new Error(`per_caller.jsonl not found at ${perCallerPath}`);
  }

  // Create analysis directory
  mkdirSync(analysisDir, { recursive: true });

  // Read JSONL files
  console.log('Reading JSONL files...');
  const perCallLines = readFileSync(perCallPath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as PerCallRow);

  const perCallerLines = readFileSync(perCallerPath, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as PerCallerRow);

  console.log(`Loaded ${perCallLines.length} per-call rows`);
  console.log(`Loaded ${perCallerLines.length} per-caller rows`);

  // Create DuckDB database and import data
  const engine = new PythonEngine();
  const pythonScript = `
import duckdb
import json
import os

sweep_dir = ${JSON.stringify(sweepDir)}
analysis_dir = ${JSON.stringify(analysisDir)}
duckdb_path = ${JSON.stringify(duckdbPath)}

# Connect to DuckDB
conn = duckdb.connect(duckdb_path)

# Create per_call table
conn.execute("""
CREATE TABLE IF NOT EXISTS per_call (
  sweep_id VARCHAR,
  lag_ms INTEGER,
  interval VARCHAR,
  overlay_set_id VARCHAR,
  overlay_index INTEGER,
  call_ts_ms BIGINT,
  caller_from_id VARCHAR,
  caller_name VARCHAR,
  token_address VARCHAR,
  token_chain VARCHAR,
  overlay_config JSON,
  entry_ts_ms BIGINT,
  entry_px DOUBLE,
  exit_ts_ms BIGINT,
  exit_px DOUBLE,
  exit_reason VARCHAR,
  gross_return_pct DOUBLE,
  net_return_pct DOUBLE,
  fees_usd DOUBLE,
  slippage_usd DOUBLE,
  candles_used INTEGER,
  tradeable BOOLEAN,
  skipped_reason VARCHAR
)
""")

# Create per_caller table
conn.execute("""
CREATE TABLE IF NOT EXISTS per_caller (
  sweep_id VARCHAR,
  lag_ms INTEGER,
  interval VARCHAR,
  overlay_set_id VARCHAR,
  caller_from_id VARCHAR,
  caller_name VARCHAR,
  calls INTEGER,
  tradeable_calls INTEGER,
  median_net_return_pct DOUBLE,
  win_rate DOUBLE,
  best_overlay JSON
)
""")

# Import per_call data
per_call_data = ${JSON.stringify(perCallLines)}
if per_call_data:
    conn.executemany("""
        INSERT INTO per_call VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        (
            row.get('sweepId', ''),
            row.get('lagMs', 0),
            row.get('interval', ''),
            row.get('overlaySetId', ''),
            row.get('overlayIndex', 0),
            row.get('callTsMs', 0),
            row.get('callerFromId', ''),
            row.get('callerName', ''),
            row.get('tokenAddress', ''),
            row.get('tokenChain', ''),
            json.dumps(row.get('overlay', {})),
            row.get('entry', {}).get('tsMs', 0),
            row.get('entry', {}).get('px', 0.0),
            row.get('exit', {}).get('tsMs', 0),
            row.get('exit', {}).get('px', 0.0),
            row.get('exit', {}).get('reason', ''),
            row.get('pnl', {}).get('grossReturnPct', 0.0),
            row.get('pnl', {}).get('netReturnPct', 0.0),
            row.get('pnl', {}).get('feesUsd', 0.0),
            row.get('pnl', {}).get('slippageUsd', 0.0),
            row.get('diagnostics', {}).get('candlesUsed', 0),
            row.get('diagnostics', {}).get('tradeable', False),
            row.get('diagnostics', {}).get('skippedReason')
        )
        for row in per_call_data
    ])

# Import per_caller data
per_caller_data = ${JSON.stringify(perCallerLines)}
if per_caller_data:
    conn.executemany("""
        INSERT INTO per_caller VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, [
        (
            row.get('sweepId', ''),
            row.get('lagMs', 0),
            row.get('interval', ''),
            row.get('overlaySetId', ''),
            row.get('callerFromId', ''),
            row.get('callerName', ''),
            row.get('calls', 0),
            row.get('tradeableCalls', 0),
            row.get('medianNetReturnPct', 0.0),
            row.get('winRate', 0.0),
            json.dumps(row.get('bestOverlay')) if row.get('bestOverlay') else None
        )
        for row in per_caller_data
    ])

# Query 1: Leaderboard by overlay
leaderboard_overlay = conn.execute("""
    SELECT
        overlay_set_id,
        overlay_index,
        overlay_config->>'kind' as overlay_kind,
        COUNT(*) as total_calls,
        SUM(CASE WHEN tradeable THEN 1 ELSE 0 END) as tradeable_calls,
        AVG(CASE WHEN tradeable THEN net_return_pct END) as avg_net_return_pct,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CASE WHEN tradeable THEN net_return_pct END) as median_net_return_pct,
        SUM(CASE WHEN tradeable AND net_return_pct > 0 THEN 1 ELSE 0 END)::DOUBLE / NULLIF(SUM(CASE WHEN tradeable THEN 1 ELSE 0 END), 0) as win_rate,
        PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY CASE WHEN tradeable THEN net_return_pct END) as p5_return_pct,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY CASE WHEN tradeable THEN net_return_pct END) as p95_return_pct
    FROM per_call
    WHERE tradeable = true
    GROUP BY overlay_set_id, overlay_index, overlay_config->>'kind'
    ORDER BY median_net_return_pct DESC NULLS LAST
""").fetchdf()

leaderboard_overlay_path = os.path.join(analysis_dir, 'leaderboard_by_overlay.csv')
leaderboard_overlay.to_csv(leaderboard_overlay_path, index=False)
print(f"✅ Wrote {leaderboard_overlay_path}")

# Query 2: Leaderboard by lag/interval
leaderboard_lag_interval = conn.execute("""
    SELECT
        interval,
        lag_ms,
        COUNT(*) as total_calls,
        SUM(CASE WHEN tradeable THEN 1 ELSE 0 END) as tradeable_calls,
        AVG(CASE WHEN tradeable THEN net_return_pct END) as avg_net_return_pct,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY CASE WHEN tradeable THEN net_return_pct END) as median_net_return_pct,
        SUM(CASE WHEN tradeable AND net_return_pct > 0 THEN 1 ELSE 0 END)::DOUBLE / NULLIF(SUM(CASE WHEN tradeable THEN 1 ELSE 0 END), 0) as win_rate,
        PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY CASE WHEN tradeable THEN net_return_pct END) as p5_return_pct,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY CASE WHEN tradeable THEN net_return_pct END) as p95_return_pct
    FROM per_call
    WHERE tradeable = true
    GROUP BY interval, lag_ms
    ORDER BY median_net_return_pct DESC NULLS LAST
""").fetchdf()

leaderboard_lag_interval_path = os.path.join(analysis_dir, 'leaderboard_by_lag_interval.csv')
leaderboard_lag_interval.to_csv(leaderboard_lag_interval_path, index=False)
print(f"✅ Wrote {leaderboard_lag_interval_path}")

# Query 3: Caller robustness (variance / drawdown tails)
caller_robustness = conn.execute("""
    SELECT
        caller_from_id,
        caller_name,
        COUNT(*) as total_configs,
        AVG(median_net_return_pct) as avg_median_return,
        STDDEV(median_net_return_pct) as stddev_median_return,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY median_net_return_pct) as median_of_medians,
        PERCENTILE_CONT(0.05) WITHIN GROUP (ORDER BY median_net_return_pct) as p5_median_return,
        PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY median_net_return_pct) as p95_median_return,
        AVG(win_rate) as avg_win_rate,
        SUM(tradeable_calls) as total_tradeable_calls
    FROM per_caller
    GROUP BY caller_from_id, caller_name
    HAVING total_tradeable_calls > 0
    ORDER BY median_of_medians DESC NULLS LAST
""").fetchdf()

caller_robustness_path = os.path.join(analysis_dir, 'caller_robustness.csv')
caller_robustness.to_csv(caller_robustness_path, index=False)
print(f"✅ Wrote {caller_robustness_path}")

# Query 4: Coverage summary
coverage_summary = conn.execute("""
    SELECT
        COUNT(*) as total_calls,
        SUM(CASE WHEN tradeable THEN 1 ELSE 0 END) as tradeable_calls,
        SUM(CASE WHEN NOT tradeable THEN 1 ELSE 0 END) as skipped_calls,
        SUM(CASE WHEN NOT tradeable THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) as skip_rate,
        COUNT(DISTINCT skipped_reason) as unique_skip_reasons
    FROM per_call
""").fetchdf()

coverage_summary_path = os.path.join(analysis_dir, 'coverage_summary.csv')
coverage_summary.to_csv(coverage_summary_path, index=False)
print(f"✅ Wrote {coverage_summary_path}")

# Query 5: Skip reasons breakdown
skip_reasons = conn.execute("""
    SELECT
        skipped_reason,
        COUNT(*) as count,
        COUNT(*)::DOUBLE / SUM(COUNT(*)) OVER () as pct
    FROM per_call
    WHERE NOT tradeable
    GROUP BY skipped_reason
    ORDER BY count DESC
""").fetchdf()

skip_reasons_path = os.path.join(analysis_dir, 'skip_reasons.csv')
skip_reasons.to_csv(skip_reasons_path, index=False)
print(f"✅ Wrote {skip_reasons_path}")

conn.close()

print(f"\\n✅ Analysis complete! Database: {duckdb_path}")
print(f"📊 CSV files written to: {analysis_dir}")
`;

  console.log('Running DuckDB analysis...');
  await engine.runScript(pythonScript, {
    cwd: sweepDir,
  });

  console.log('\n✅ Analysis complete!');
}

// Main
const sweepDir = process.argv[2];
if (!sweepDir) {
  console.error('Usage: tsx scripts/analyze-sweep-duckdb.ts <sweep-output-dir>');
  process.exit(1);
}

analyzeSweep(sweepDir).catch((error) => {
  console.error('Analysis failed:', error);
  process.exit(1);
});


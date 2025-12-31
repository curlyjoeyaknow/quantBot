#!/usr/bin/env bash
set -euo pipefail

mkdir -p sql/clickhouse

cat > sql/clickhouse/001_sim_runs.sql <<'SQL'
-- Run ledger: one row per simulation run
CREATE TABLE IF NOT EXISTS quantbot.sim_runs
(
  run_id UUID,
  created_at DateTime64(3, 'UTC') DEFAULT now64(3),
  finished_at DateTime64(3, 'UTC') DEFAULT toDateTime64(0, 3, 'UTC'),
  status LowCardinality(String) DEFAULT 'running', -- running|success|failed

  git_sha LowCardinality(String) DEFAULT '',
  engine_version LowCardinality(String) DEFAULT '',

  strategy_id LowCardinality(String),
  params_json String DEFAULT '{}',

  interval_sec UInt32,
  time_from DateTime64(3, 'UTC'),
  time_to   DateTime64(3, 'UTC'),

  universe_ref String DEFAULT '', -- e.g. "token_set:topN" or "mint_list:hash"
  notes String DEFAULT ''
)
ENGINE = MergeTree
ORDER BY (created_at, strategy_id, interval_sec, run_id);
SQL

cat > sql/clickhouse/002_sim_run_metrics.sql <<'SQL'
-- Metrics: one row per run (keep it wide-ish, evolve as needed)
CREATE TABLE IF NOT EXISTS quantbot.sim_run_metrics
(
  run_id UUID,
  created_at DateTime64(3, 'UTC') DEFAULT now64(3),

  roi Float64,
  pnl_quote Float64,
  max_drawdown Float64,

  trades UInt32,
  win_rate Float64,

  avg_hold_sec Float64,
  fees_paid_quote Float64,
  slippage_paid_quote Float64 DEFAULT 0
)
ENGINE = MergeTree
ORDER BY (created_at, run_id);
SQL

cat > sql/clickhouse/003_sim_run_slice_audit.sql <<'SQL'
-- Input slice audit: one row per run (so you can trust results)
CREATE TABLE IF NOT EXISTS quantbot.sim_run_slice_audit
(
  run_id UUID,
  created_at DateTime64(3, 'UTC') DEFAULT now64(3),

  token_count UInt32 DEFAULT 0,

  fetched_count UInt32,
  expected_count UInt32,

  min_ts DateTime64(3, 'UTC'),
  max_ts DateTime64(3, 'UTC'),

  dup_count UInt32,
  gap_count UInt32,
  alignment_ok UInt8
)
ENGINE = MergeTree
ORDER BY (created_at, run_id);
SQL

cat > sql/clickhouse/004_useful_queries.sql <<'SQL'
-- Latest runs
-- SELECT run_id, created_at, status, strategy_id, interval_sec, time_from, time_to
-- FROM quantbot.sim_runs ORDER BY created_at DESC LIMIT 25;

-- Leaderboard (simple ROI)
-- SELECT
--   r.created_at,
--   r.run_id,
--   r.strategy_id,
--   r.interval_sec,
--   m.roi,
--   m.max_drawdown,
--   m.trades,
--   m.win_rate
-- FROM quantbot.sim_run_metrics m
-- INNER JOIN quantbot.sim_runs r USING (run_id)
-- ORDER BY m.roi DESC
-- LIMIT 50;

-- Find cursed inputs
-- SELECT r.run_id, r.strategy_id, a.fetched_count, a.expected_count, a.dup_count, a.gap_count, a.alignment_ok
-- FROM quantbot.sim_runs r
-- INNER JOIN quantbot.sim_run_slice_audit a USING (run_id)
-- WHERE a.gap_count > 0 OR a.dup_count > 0 OR a.alignment_ok = 0
-- ORDER BY r.created_at DESC;
SQL

echo "Wrote ClickHouse DDL to sql/clickhouse/00*_*.sql"
echo
echo "Apply with something like:"
echo "  clickhouse-client --multiquery < sql/clickhouse/001_sim_runs.sql"
echo "  clickhouse-client --multiquery < sql/clickhouse/002_sim_run_metrics.sql"
echo "  clickhouse-client --multiquery < sql/clickhouse/003_sim_run_slice_audit.sql"
echo
echo "Then use sql/clickhouse/004_useful_queries.sql as your quick toolbox."

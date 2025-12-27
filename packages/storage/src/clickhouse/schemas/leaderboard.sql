-- Leaderboard Schema for QuantBot Lab
-- 
-- Stores simulation results for ranking and comparison.
-- Phase 6.1: Leaderboard table and materialized views.

CREATE TABLE IF NOT EXISTS quantbot.strategy_leaderboard
(
    strategy_id String,
    feature_set_id String,
    config_hash String,
    window_id String,
    preset_name String,
    run_id String,
    pnl Double,
    pnl_percent Double,
    drawdown Double,
    drawdown_percent Double,
    sharpe Double,
    stability_score Double,
    total_trades Int32,
    win_rate Double,
    total_exposure_time Int64, -- seconds
    avg_hold_time Double, -- seconds
    created_at DateTime DEFAULT now()
)
ENGINE = MergeTree()
ORDER BY (strategy_id, feature_set_id, config_hash, window_id, created_at)
PARTITION BY toYYYYMM(created_at);

-- Materialized view: Top by PnL
CREATE MATERIALIZED VIEW IF NOT EXISTS quantbot.mv_leaderboard_top_pnl
ENGINE = SummingMergeTree()
ORDER BY (strategy_id, feature_set_id, config_hash)
AS
SELECT
    strategy_id,
    feature_set_id,
    config_hash,
    argMax(preset_name, created_at) as preset_name,
    max(pnl) as max_pnl,
    max(pnl_percent) as max_pnl_percent,
    avg(pnl) as avg_pnl,
    avg(pnl_percent) as avg_pnl_percent,
    count() as run_count
FROM quantbot.strategy_leaderboard
GROUP BY strategy_id, feature_set_id, config_hash;

-- Materialized view: Top by stability
CREATE MATERIALIZED VIEW IF NOT EXISTS quantbot.mv_leaderboard_top_stability
ENGINE = SummingMergeTree()
ORDER BY (strategy_id, feature_set_id, config_hash)
AS
SELECT
    strategy_id,
    feature_set_id,
    config_hash,
    argMax(preset_name, created_at) as preset_name,
    max(stability_score) as max_stability,
    avg(stability_score) as avg_stability,
    avg(pnl_percent) as avg_pnl_percent,
    count() as run_count
FROM quantbot.strategy_leaderboard
WHERE stability_score IS NOT NULL
GROUP BY strategy_id, feature_set_id, config_hash;

-- Materialized view: Pareto frontier (best PnL for each stability level)
CREATE MATERIALIZED VIEW IF NOT EXISTS quantbot.mv_leaderboard_pareto
ENGINE = SummingMergeTree()
ORDER BY (stability_bucket, strategy_id, feature_set_id, config_hash)
AS
SELECT
    toInt32(stability_score * 10) as stability_bucket, -- Bucket by 0.1 increments
    strategy_id,
    feature_set_id,
    config_hash,
    argMax(preset_name, created_at) as preset_name,
    max(pnl_percent) as max_pnl_percent,
    avg(stability_score) as avg_stability,
    count() as run_count
FROM quantbot.strategy_leaderboard
WHERE stability_score IS NOT NULL
GROUP BY stability_bucket, strategy_id, feature_set_id, config_hash;

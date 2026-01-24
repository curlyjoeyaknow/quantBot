"""
Trial Ledger - Persistent storage for all optimization and walk-forward runs.

EVERY run must be recorded. This is non-negotiable for:
- Experiment tracking and reproducibility
- Walk-forward validation history
- Preventing re-running the same experiments
- Building an "experiment brain" for meta-analysis
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import duckdb

UTC = timezone.utc


# =============================================================================
# Schema
# =============================================================================

SCHEMA_SQL = """
-- Optimizer schema for trial tracking
CREATE SCHEMA IF NOT EXISTS optimizer;

-- Main runs table - one row per optimization run
CREATE TABLE IF NOT EXISTS optimizer.runs_d (
    run_id TEXT PRIMARY KEY,
    run_type TEXT NOT NULL,  -- 'grid_search', 'walk_forward', 'random_search'
    created_at TIMESTAMP NOT NULL,
    name TEXT,
    
    -- Date range
    date_from DATE,
    date_to DATE,
    
    -- Alerts
    alerts_total INTEGER,
    alerts_ok INTEGER,
    
    -- Config and results
    config_json TEXT,
    timing_json TEXT,
    summary_json TEXT,
    
    -- =========================================================================
    -- RUN MODE CONTRACT (reproducibility backbone)
    -- =========================================================================
    mode TEXT,                    -- 'cheap', 'serious', 'war_room', 'custom'
    config_hash TEXT,             -- SHA256 of canonical config JSON (first 16 chars)
    data_fingerprint TEXT,        -- SHA256 of data state (alerts count, range)
    code_fingerprint TEXT,        -- Git commit hash (short)
    code_dirty BOOLEAN,           -- True if uncommitted changes
    
    -- Full signature for reproducibility
    -- Format: "SERIOUS@sha256:abc... on data@sha256:def... at commit f84f5ed0"
    signature TEXT,
    
    -- Metadata
    notes TEXT
);

-- Trials table - one row per parameter combination tested
-- This is your "experiment brain" - every trial writes here
CREATE TABLE IF NOT EXISTS optimizer.trials_f (
    trial_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    
    -- Strategy identification
    strategy_name TEXT,
    
    -- Parameters
    tp_mult DOUBLE,
    sl_mult DOUBLE,
    intrabar_order TEXT,
    params_json TEXT,
    
    -- Dataset info
    date_from DATE,
    date_to DATE,
    entry_mode TEXT,  -- 'immediate', 'delayed', etc.
    horizon_hours INTEGER,
    alerts_total INTEGER,
    alerts_ok INTEGER,
    
    -- R-multiple metrics (THE KEY)
    total_r DOUBLE,
    avg_r DOUBLE,
    avg_r_win DOUBLE,
    avg_r_loss DOUBLE,
    r_profit_factor DOUBLE,
    
    -- Traditional metrics
    win_rate DOUBLE,
    profit_factor DOUBLE,
    expectancy_pct DOUBLE,
    total_return_pct DOUBLE,
    risk_adj_total_return_pct DOUBLE,
    
    -- === NEW: Path metrics (for scoring function) ===
    -- Hit rates
    hit2x_pct DOUBLE,           -- % of alerts that hit 2x
    hit3x_pct DOUBLE,           -- % of alerts that hit 3x
    hit4x_pct DOUBLE,           -- % of alerts that hit 4x
    
    -- ATH metrics
    median_ath_mult DOUBLE,     -- Median all-time-high multiple
    p75_ath_mult DOUBLE,        -- 75th percentile ATH
    p95_ath_mult DOUBLE,        -- 95th percentile ATH (fat tail check)
    
    -- Time-to-X metrics (minutes)
    median_time_to_2x_min DOUBLE,
    median_time_to_3x_min DOUBLE,
    
    -- Drawdown metrics (as decimals, e.g., 0.30 = 30%)
    median_dd_pre2x DOUBLE,     -- Median drawdown before hitting 2x
    p95_dd_pre2x DOUBLE,        -- 95th percentile DD pre-2x
    p75_dd_pre2x DOUBLE,        -- 75th percentile DD pre-2x
    median_dd_overall DOUBLE,   -- Median overall drawdown
    
    -- Objective function score (THE NUMBER TO OPTIMIZE)
    objective_score DOUBLE,
    
    -- === Robust mode metrics ===
    -- Anti-overfit ratio (TestR / TrainR)
    test_train_ratio DOUBLE,    -- TestR / TrainR (scale-free generalization measure)
    
    -- Stress lane results
    robust_score DOUBLE,        -- Score after DD and stress penalties
    stress_penalty DOUBLE,      -- Penalty from stress lane testing
    worst_lane TEXT,            -- Which lane caused the worst score
    worst_lane_score DOUBLE,    -- Score from worst lane
    
    -- Gate check results
    gate_check_json TEXT,       -- JSON with pass/fail per gate
    passes_gates BOOLEAN,       -- True if all gates passed
    
    -- Timing
    duration_ms INTEGER,
    
    -- Full summary
    summary_json TEXT,
    
    FOREIGN KEY (run_id) REFERENCES optimizer.runs_d(run_id)
);

-- Walk-forward folds table
CREATE TABLE IF NOT EXISTS optimizer.walk_forward_f (
    fold_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    fold_num INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL,
    
    -- Train window
    train_from DATE,
    train_to DATE,
    train_alerts INTEGER,
    
    -- Test window  
    test_from DATE,
    test_to DATE,
    test_alerts INTEGER,
    
    -- Best params from training
    best_tp_mult DOUBLE,
    best_sl_mult DOUBLE,
    best_params_json TEXT,
    
    -- Train performance (in-sample)
    train_win_rate DOUBLE,
    train_avg_r DOUBLE,
    train_total_r DOUBLE,
    
    -- Test performance (out-of-sample)
    test_win_rate DOUBLE,
    test_avg_r DOUBLE,
    test_total_r DOUBLE,
    
    -- Delta R (test - train): positive = test outperformed, negative = test underperformed
    delta_avg_r DOUBLE,
    delta_total_r DOUBLE,
    
    notes TEXT,
    
    FOREIGN KEY (run_id) REFERENCES optimizer.runs_d(run_id)
);

-- =============================================================================
-- TWO-PASS PIPELINE TABLES (audit trail + resume support)
-- =============================================================================

-- Pipeline phases - one row per phase execution
-- Enables: audit trail, resume from any phase, replay
CREATE TABLE IF NOT EXISTS optimizer.pipeline_phases_f (
    phase_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    phase_name TEXT NOT NULL,         -- 'discovery', 'clustering', 'champion_selection', 'stress_validation', 'final_selection'
    phase_order INTEGER NOT NULL,     -- 1, 2, 3, 4, 5
    status TEXT NOT NULL,             -- 'pending', 'running', 'completed', 'failed', 'skipped'
    
    -- Timing
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    duration_ms INTEGER,
    
    -- Input/output references (for replay)
    input_phase_id TEXT,              -- Which phase's output is this phase's input?
    input_summary_json TEXT,          -- Summary of input data
    output_summary_json TEXT,         -- Summary of output data
    
    -- Config snapshot (for reproducibility)
    config_json TEXT,
    
    -- Error handling
    error_message TEXT,
    retry_count INTEGER DEFAULT 0,
    
    -- Metadata
    notes TEXT,
    
    FOREIGN KEY (run_id) REFERENCES optimizer.runs_d(run_id)
);

-- Island clusters - one row per island discovered
CREATE TABLE IF NOT EXISTS optimizer.islands_f (
    island_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    phase_id TEXT NOT NULL,           -- Which clustering phase created this
    cluster_num INTEGER NOT NULL,     -- 0, 1, 2, ...
    created_at TIMESTAMP NOT NULL,
    
    -- Centroid
    centroid_tp_mult DOUBLE,
    centroid_sl_mult DOUBLE,
    centroid_json TEXT,               -- Full centroid params
    
    -- Spread (cluster tightness)
    spread_tp_mult DOUBLE,
    spread_sl_mult DOUBLE,
    
    -- Aggregate scores
    n_members INTEGER,
    mean_robust_score DOUBLE,
    median_robust_score DOUBLE,
    best_robust_score DOUBLE,
    mean_median_test_r DOUBLE,
    mean_ratio DOUBLE,
    pct_pass_gates DOUBLE,
    
    -- Members (JSON array of trial_ids or param snapshots)
    members_json TEXT,
    
    FOREIGN KEY (run_id) REFERENCES optimizer.runs_d(run_id),
    FOREIGN KEY (phase_id) REFERENCES optimizer.pipeline_phases_f(phase_id)
);

-- Island champions - one per island, selected for validation
CREATE TABLE IF NOT EXISTS optimizer.island_champions_f (
    champion_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    phase_id TEXT NOT NULL,           -- Which selection phase
    island_id TEXT NOT NULL,          -- Which island
    created_at TIMESTAMP NOT NULL,
    
    -- Parameters
    tp_mult DOUBLE,
    sl_mult DOUBLE,
    params_json TEXT,
    
    -- Discovery phase score
    discovery_score DOUBLE,
    median_test_r DOUBLE,
    passes_gates BOOLEAN,
    
    -- Island context
    island_size INTEGER,
    island_centroid_json TEXT,
    
    -- Validation status
    validation_status TEXT DEFAULT 'pending',  -- 'pending', 'validated', 'failed'
    
    FOREIGN KEY (run_id) REFERENCES optimizer.runs_d(run_id),
    FOREIGN KEY (phase_id) REFERENCES optimizer.pipeline_phases_f(phase_id),
    FOREIGN KEY (island_id) REFERENCES optimizer.islands_f(island_id)
);

-- Stress lane validation results - one row per (champion, lane)
CREATE TABLE IF NOT EXISTS optimizer.stress_lane_results_f (
    result_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    phase_id TEXT NOT NULL,           -- Which validation phase
    champion_id TEXT NOT NULL,
    lane_name TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    
    -- Lane config snapshot
    fee_bps DOUBLE,
    slippage_bps DOUBLE,
    latency_candles INTEGER,
    stop_gap_prob DOUBLE,
    stop_gap_mult DOUBLE,
    lane_config_json TEXT,
    
    -- Results
    test_r DOUBLE,
    ratio DOUBLE,
    passes_gates BOOLEAN,
    
    -- Timing
    duration_ms INTEGER,
    
    -- Full summary
    summary_json TEXT,
    
    FOREIGN KEY (run_id) REFERENCES optimizer.runs_d(run_id),
    FOREIGN KEY (phase_id) REFERENCES optimizer.pipeline_phases_f(phase_id),
    FOREIGN KEY (champion_id) REFERENCES optimizer.island_champions_f(champion_id)
);

-- Champion validation summary - one row per champion after all lanes
CREATE TABLE IF NOT EXISTS optimizer.champion_validation_f (
    validation_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    phase_id TEXT NOT NULL,
    champion_id TEXT NOT NULL,
    island_id TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    
    -- Lane scores
    n_lanes INTEGER,
    lane_scores_json TEXT,            -- {lane_name: score}
    
    -- Aggregate scores (THE KEY: maximin)
    robust_score DOUBLE,              -- min(lane_scores) - MAXIMIN
    median_score DOUBLE,
    p25_score DOUBLE,
    mean_score DOUBLE,
    
    -- Worst lane
    worst_lane TEXT,
    worst_lane_score DOUBLE,
    
    -- How many lanes passed gates?
    lanes_passing INTEGER,
    
    -- Final ranking
    validation_rank INTEGER,          -- 1 = winner
    
    -- Delta from discovery
    score_delta DOUBLE,               -- validation_score - discovery_score
    
    FOREIGN KEY (run_id) REFERENCES optimizer.runs_d(run_id),
    FOREIGN KEY (phase_id) REFERENCES optimizer.pipeline_phases_f(phase_id),
    FOREIGN KEY (champion_id) REFERENCES optimizer.island_champions_f(champion_id),
    FOREIGN KEY (island_id) REFERENCES optimizer.islands_f(island_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_trials_run_id ON optimizer.trials_f(run_id);
CREATE INDEX IF NOT EXISTS idx_trials_total_r ON optimizer.trials_f(total_r DESC);
CREATE INDEX IF NOT EXISTS idx_wf_run_id ON optimizer.walk_forward_f(run_id);
CREATE INDEX IF NOT EXISTS idx_phases_run_id ON optimizer.pipeline_phases_f(run_id);
CREATE INDEX IF NOT EXISTS idx_phases_status ON optimizer.pipeline_phases_f(status);
CREATE INDEX IF NOT EXISTS idx_islands_run_id ON optimizer.islands_f(run_id);
CREATE INDEX IF NOT EXISTS idx_champions_run_id ON optimizer.island_champions_f(run_id);
CREATE INDEX IF NOT EXISTS idx_lane_results_run_id ON optimizer.stress_lane_results_f(run_id);
CREATE INDEX IF NOT EXISTS idx_lane_results_champion ON optimizer.stress_lane_results_f(champion_id);
CREATE INDEX IF NOT EXISTS idx_validation_run_id ON optimizer.champion_validation_f(run_id);

-- View for pipeline status overview
CREATE OR REPLACE VIEW optimizer.pipeline_status_v AS
SELECT
    r.run_id,
    r.run_type,
    r.name,
    r.created_at,
    p.phase_name,
    p.phase_order,
    p.status AS phase_status,
    p.started_at,
    p.completed_at,
    p.duration_ms,
    p.error_message
FROM optimizer.runs_d r
LEFT JOIN optimizer.pipeline_phases_f p ON p.run_id = r.run_id
ORDER BY r.created_at DESC, p.phase_order;

-- View for validation results summary
CREATE OR REPLACE VIEW optimizer.validation_summary_v AS
SELECT
    v.run_id,
    v.champion_id,
    c.island_id,
    c.tp_mult,
    c.sl_mult,
    c.discovery_score,
    v.robust_score AS validation_score,
    v.score_delta,
    v.worst_lane,
    v.worst_lane_score,
    v.lanes_passing,
    v.n_lanes,
    v.validation_rank,
    CASE WHEN v.validation_rank = 1 THEN 'WINNER' ELSE '' END AS status
FROM optimizer.champion_validation_f v
JOIN optimizer.island_champions_f c ON c.champion_id = v.champion_id
ORDER BY v.run_id, v.validation_rank;

-- Views for quick analysis
CREATE OR REPLACE VIEW optimizer.recent_runs_v AS
SELECT
    run_id,
    run_type,
    created_at,
    name,
    date_from,
    date_to,
    alerts_total,
    (SELECT COUNT(*) FROM optimizer.trials_f t WHERE t.run_id = r.run_id) AS n_trials,
    (SELECT COUNT(*) FROM optimizer.walk_forward_f w WHERE w.run_id = r.run_id) AS n_folds,
    json_extract_string(timing_json, '$.total_ms')::INTEGER AS total_ms
FROM optimizer.runs_d r
ORDER BY created_at DESC
LIMIT 100;

CREATE OR REPLACE VIEW optimizer.best_trials_v AS
SELECT
    t.run_id,
    t.trial_id,
    t.strategy_name,
    t.tp_mult,
    t.sl_mult,
    t.total_r,
    t.avg_r,
    t.win_rate,
    t.hit2x_pct,
    t.median_ath_mult,
    t.median_dd_pre2x,
    t.median_time_to_2x_min,
    t.objective_score,
    t.risk_adj_total_return_pct,
    t.duration_ms,
    row_number() OVER (PARTITION BY t.run_id ORDER BY t.objective_score DESC NULLS LAST) AS rank_by_objective,
    row_number() OVER (PARTITION BY t.run_id ORDER BY t.total_r DESC) AS rank_by_total_r
FROM optimizer.trials_f t
ORDER BY t.run_id, t.objective_score DESC NULLS LAST;

-- View for quick anti-overfit analysis: compare train vs test performance
CREATE OR REPLACE VIEW optimizer.overfit_check_v AS
SELECT
    r.run_id,
    r.run_type,
    r.name,
    COUNT(DISTINCT t.trial_id) AS n_trials,
    AVG(t.objective_score) AS avg_objective,
    MAX(t.objective_score) AS best_objective,
    AVG(t.hit2x_pct) AS avg_hit2x,
    AVG(t.median_dd_pre2x) AS avg_dd_pre2x,
    AVG(t.median_time_to_2x_min) AS avg_time_to_2x,
    r.created_at
FROM optimizer.runs_d r
LEFT JOIN optimizer.trials_f t ON t.run_id = r.run_id
GROUP BY r.run_id, r.run_type, r.name, r.created_at
ORDER BY r.created_at DESC;

CREATE OR REPLACE VIEW optimizer.walk_forward_summary_v AS
SELECT
    run_id,
    COUNT(*) AS n_folds,
    AVG(train_total_r) AS avg_train_r,
    AVG(test_total_r) AS avg_test_r,
    MEDIAN(test_total_r) AS median_test_r,
    AVG(delta_total_r) AS avg_delta_r,
    SUM(CASE WHEN test_total_r > 0 THEN 1 ELSE 0 END) AS folds_profitable,
    SUM(CASE WHEN delta_total_r > 0 THEN 1 ELSE 0 END) AS folds_improved,
    MIN(test_total_r) AS worst_fold_r
FROM optimizer.walk_forward_f
GROUP BY run_id;
"""


def ensure_trial_schema(duckdb_path: str) -> None:
    """Create the trial ledger schema if it doesn't exist."""
    from tools.shared.duckdb_adapter import get_write_connection
    with get_write_connection(duckdb_path) as con:
        for stmt in SCHEMA_SQL.split(";"):
            stmt = stmt.strip()
            if stmt:
                con.execute(stmt)


# =============================================================================
# Storage Functions
# =============================================================================

def init_optimizer_run(
    duckdb_path: str,
    run_id: str,
    run_type: str,
    name: str,
    date_from: str,
    date_to: str,
    config: Dict[str, Any],
    mode: Optional[str] = None,
    config_hash: Optional[str] = None,
    data_fingerprint: Optional[str] = None,
    code_fingerprint: Optional[str] = None,
    code_dirty: bool = False,
    signature: Optional[str] = None,
) -> None:
    """
    Initialize an optimizer run record (create early, update later with results).
    
    This is called before phases start to ensure the run exists for foreign key constraints.
    """
    from tools.shared.duckdb_adapter import get_write_connection
    ensure_trial_schema(duckdb_path)
    
    with get_write_connection(duckdb_path) as con:
        created_at = datetime.now(UTC).replace(tzinfo=None)
        
        # Check which columns exist (for backward compatibility)
        try:
            existing_cols = [r[1].lower() for r in con.execute("PRAGMA table_info('optimizer.runs_d')").fetchall()]
            has_mode = "mode" in existing_cols
        except Exception:
            has_mode = False
        
        if has_mode:
            # Full schema with mode contract fields
            con.execute("""
                INSERT OR IGNORE INTO optimizer.runs_d (
                    run_id, run_type, created_at, name, date_from, date_to,
                    alerts_total, alerts_ok, config_json, timing_json, summary_json,
                    mode, config_hash, data_fingerprint, code_fingerprint, code_dirty, signature,
                    notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                run_id,
                run_type,
                created_at,
                name,
                date_from,
                date_to,
                0,  # Will be updated later
                0,  # Will be updated later
                json.dumps(config, separators=(",", ":"), default=str),
                None,  # Will be updated later
                json.dumps({}, separators=(",", ":")),  # Empty summary for now
                mode,
                config_hash,
                data_fingerprint,
                code_fingerprint,
                code_dirty,
                signature,
                None,
            ])
        else:
            # Legacy schema without mode contract fields
            con.execute("""
                INSERT OR IGNORE INTO optimizer.runs_d (
                    run_id, run_type, created_at, name, date_from, date_to,
                    alerts_total, alerts_ok, config_json, timing_json, summary_json, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                run_id,
                run_type,
                created_at,
                name,
                date_from,
                date_to,
                0,  # Will be updated later
                0,  # Will be updated later
                json.dumps(config, separators=(",", ":"), default=str),
                None,  # Will be updated later
                json.dumps({}, separators=(",", ":")),  # Empty summary for now
                None,
            ])


def store_optimizer_run(
    duckdb_path: str,
    run_id: str,
    run_type: str,
    name: str,
    date_from: str,
    date_to: str,
    config: Dict[str, Any],
    results: List[Dict[str, Any]],
    timing: Optional[Dict[str, Any]] = None,
    notes: Optional[str] = None,
    # Run Mode Contract fields
    mode: Optional[str] = None,
    config_hash: Optional[str] = None,
    data_fingerprint: Optional[str] = None,
    code_fingerprint: Optional[str] = None,
    code_dirty: bool = False,
    signature: Optional[str] = None,
) -> None:
    """
    Store an optimization run and all its trials.
    
    Args:
        duckdb_path: Path to DuckDB database
        run_id: Unique run identifier
        run_type: Type of run ('grid_search', 'walk_forward', etc.)
        name: Human-readable name
        date_from/to: Date range
        config: Optimizer config dict
        results: List of trial result dicts
        timing: Optional timing dict
        notes: Optional notes
        mode: Run mode ('cheap', 'serious', 'war_room', 'custom')
        config_hash: SHA256 of canonical config JSON
        data_fingerprint: SHA256 of data state
        code_fingerprint: Git commit hash
        code_dirty: True if uncommitted changes
        signature: Full reproducibility signature
    """
    from tools.shared.duckdb_adapter import get_write_connection
    ensure_trial_schema(duckdb_path)
    
    with get_write_connection(duckdb_path) as con:
        created_at = datetime.now(UTC).replace(tzinfo=None)
        
        # Compute totals from results
        alerts_total = results[0].get("alerts_total", 0) if results else 0
        alerts_ok = results[0].get("alerts_ok", 0) if results else 0
        
        # Summary of best result
        best_result = max(results, key=lambda r: r.get("summary", {}).get("total_r", 0)) if results else {}
        summary = best_result.get("summary", {})
        
        # Insert or update run (preserve created_at if already exists from init_optimizer_run)
        existing = con.execute("SELECT created_at FROM optimizer.runs_d WHERE run_id = ?", [run_id]).fetchone()
        final_created_at = existing[0] if existing else created_at
        
        # Check which columns exist (for backward compatibility)
        try:
            existing_cols = [r[1].lower() for r in con.execute("PRAGMA table_info('optimizer.runs_d')").fetchall()]
            has_mode = "mode" in existing_cols
        except Exception:
            has_mode = False
        
        if has_mode:
            # Full schema with mode contract fields
            con.execute("""
                INSERT OR REPLACE INTO optimizer.runs_d (
                    run_id, run_type, created_at, name, date_from, date_to,
                    alerts_total, alerts_ok, config_json, timing_json, summary_json,
                    mode, config_hash, data_fingerprint, code_fingerprint, code_dirty, signature,
                    notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                run_id,
                run_type,
                final_created_at,
                name,
                date_from,
                date_to,
                alerts_total,
                alerts_ok,
                json.dumps(config, separators=(",", ":"), default=str),
                json.dumps(timing, separators=(",", ":"), default=str) if timing else None,
                json.dumps(summary, separators=(",", ":"), default=str),
                mode,
                config_hash,
                data_fingerprint,
                code_fingerprint,
                code_dirty,
                signature,
                notes,
            ])
        else:
            # Legacy schema without mode contract fields
            con.execute("""
                INSERT OR REPLACE INTO optimizer.runs_d (
                    run_id, run_type, created_at, name, date_from, date_to,
                    alerts_total, alerts_ok, config_json, timing_json, summary_json, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                run_id,
                run_type,
                final_created_at,
                name,
                date_from,
                date_to,
                alerts_total,
                alerts_ok,
                json.dumps(config, separators=(",", ":"), default=str),
                json.dumps(timing, separators=(",", ":"), default=str) if timing else None,
                json.dumps(summary, separators=(",", ":"), default=str),
                notes,
            ])
        
        # Delete existing trials for this run (in case of rerun)
        con.execute("DELETE FROM optimizer.trials_f WHERE run_id = ?", [run_id])
        
        # Insert trials
        for i, r in enumerate(results):
            trial_id = f"{run_id}_{i:04d}"
            params = r.get("params", {})
            s = r.get("summary", {})
            obj = r.get("objective", {})
            
            # Extract robust mode metrics if present
            test_train_ratio = r.get("ratio") or obj.get("median_ratio") if isinstance(obj, dict) else None
            robust_score = obj.get("robust_score") if isinstance(obj, dict) else None
            stress_penalty = obj.get("stress_penalty") if isinstance(obj, dict) else None
            worst_lane = obj.get("worst_lane") if isinstance(obj, dict) else None
            worst_lane_score = obj.get("worst_lane_score") if isinstance(obj, dict) else None
            passes_gates = r.get("passes_gates", True)
            gate_check = r.get("gate_check")
            
            con.execute("""
                INSERT INTO optimizer.trials_f (
                    trial_id, run_id, created_at,
                    strategy_name,
                    tp_mult, sl_mult, intrabar_order, params_json,
                    date_from, date_to, entry_mode, horizon_hours, alerts_total, alerts_ok,
                    total_r, avg_r, avg_r_win, avg_r_loss, r_profit_factor,
                    win_rate, profit_factor, expectancy_pct,
                    total_return_pct, risk_adj_total_return_pct,
                    hit2x_pct, hit3x_pct, hit4x_pct,
                    median_ath_mult, p75_ath_mult, p95_ath_mult,
                    median_time_to_2x_min, median_time_to_3x_min,
                    median_dd_pre2x, p95_dd_pre2x, p75_dd_pre2x, median_dd_overall,
                    objective_score,
                    test_train_ratio, robust_score, stress_penalty,
                    worst_lane, worst_lane_score,
                    gate_check_json, passes_gates,
                    duration_ms, summary_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                trial_id,
                run_id,
                created_at,
                params.get("strategy_name") or config.get("name"),
                params.get("tp_mult"),
                params.get("sl_mult"),
                params.get("intrabar_order", "sl_first"),
                json.dumps(params, separators=(",", ":"), default=str),
                date_from,
                date_to,
                config.get("entry_mode", "immediate"),
                config.get("horizon_hours", 48),
                r.get("alerts_total", 0),
                r.get("alerts_ok", 0),
                s.get("total_r"),
                s.get("avg_r"),
                s.get("avg_r_win"),
                s.get("avg_r_loss"),
                s.get("r_profit_factor"),
                s.get("tp_sl_win_rate"),
                s.get("tp_sl_profit_factor"),
                s.get("tp_sl_expectancy_pct"),
                s.get("tp_sl_total_return_pct"),
                s.get("risk_adj_total_return_pct"),
                # Path metrics
                s.get("pct_hit_2x"),
                s.get("pct_hit_3x"),
                s.get("pct_hit_4x"),
                s.get("median_ath_mult"),
                s.get("p75_ath"),
                s.get("p95_ath"),
                s.get("time_to_2x_median_min"),
                s.get("time_to_3x_median_min"),
                s.get("dd_pre2x_median"),
                s.get("dd_pre2x_p95"),
                s.get("dd_pre2x_p75"),
                s.get("dd_overall_median"),
                # Objective score
                obj.get("final_score") if isinstance(obj, dict) else None,
                # Robust mode metrics
                test_train_ratio,
                robust_score,
                stress_penalty,
                worst_lane,
                worst_lane_score,
                json.dumps(gate_check, separators=(",", ":"), default=str) if gate_check else None,
                passes_gates,
                int(r.get("duration_s", 0) * 1000),
                json.dumps(s, separators=(",", ":"), default=str),
            ])
        


def store_walk_forward_run(
    duckdb_path: str,
    run_id: str,
    name: str,
    config: Dict[str, Any],
    folds: List[Dict[str, Any]],
    timing: Optional[Dict[str, Any]] = None,
    notes: Optional[str] = None,
) -> None:
    """
    Store a walk-forward validation run and all its folds.
    
    Args:
        duckdb_path: Path to DuckDB database
        run_id: Unique run identifier
        name: Human-readable name
        config: Config dict
        folds: List of fold result dicts
        timing: Optional timing dict
        notes: Optional notes
    """
    from tools.shared.duckdb_adapter import get_write_connection
    ensure_trial_schema(duckdb_path)
    
    with get_write_connection(duckdb_path) as con:
        created_at = datetime.now(UTC).replace(tzinfo=None)
        
        # Compute summary
        if folds:
            date_from = min(f.get("train_from", "") for f in folds)
            date_to = max(f.get("test_to", "") for f in folds)
            alerts_total = sum(f.get("train_alerts", 0) + f.get("test_alerts", 0) for f in folds)
            avg_test_r = sum(f.get("test_total_r", 0) for f in folds) / len(folds)
            avg_delta_r = sum(f.get("delta_total_r", 0) for f in folds) / len(folds)
            pct_profitable = sum(1 for f in folds if f.get("test_total_r", 0) > 0) / len(folds) * 100
            worst_fold = min(f.get("test_total_r", 0) for f in folds)
            summary = {
                "n_folds": len(folds),
                "avg_test_total_r": avg_test_r,
                "avg_delta_r": avg_delta_r,
                "pct_profitable": pct_profitable,
                "worst_fold_r": worst_fold,
            }
        else:
            date_from = date_to = ""
            alerts_total = 0
            summary = {}
        
        # Insert run
        con.execute("""
            INSERT OR REPLACE INTO optimizer.runs_d (
                run_id, run_type, created_at, name, date_from, date_to,
                alerts_total, alerts_ok, config_json, timing_json, summary_json, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            run_id,
            "walk_forward",
            created_at,
            name,
            date_from,
            date_to,
            alerts_total,
            alerts_total,  # For WF, all alerts are used
            json.dumps(config, separators=(",", ":"), default=str),
            json.dumps(timing, separators=(",", ":"), default=str) if timing else None,
            json.dumps(summary, separators=(",", ":"), default=str),
            notes,
        ])
        
        # Delete existing folds for this run
        con.execute("DELETE FROM optimizer.walk_forward_f WHERE run_id = ?", [run_id])
        
        # Insert folds
        for i, f in enumerate(folds, 1):
            fold_id = f.get("fold_id", f"{run_id}_fold{i:02d}")
            params = f.get("best_params", {})
            
            con.execute("""
                INSERT INTO optimizer.walk_forward_f (
                    fold_id, run_id, fold_num, created_at,
                    train_from, train_to, train_alerts,
                    test_from, test_to, test_alerts,
                    best_tp_mult, best_sl_mult, best_params_json,
                    train_win_rate, train_avg_r, train_total_r,
                    test_win_rate, test_avg_r, test_total_r,
                    delta_avg_r, delta_total_r, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                fold_id,
                run_id,
                i,
                created_at,
                f.get("train_from"),
                f.get("train_to"),
                f.get("train_alerts"),
                f.get("test_from"),
                f.get("test_to"),
                f.get("test_alerts"),
                params.get("tp_mult"),
                params.get("sl_mult"),
                json.dumps(params, separators=(",", ":"), default=str),
                f.get("train_win_rate"),
                f.get("train_avg_r"),
                f.get("train_total_r"),
                f.get("test_win_rate"),
                f.get("test_avg_r"),
                f.get("test_total_r"),
                f.get("delta_avg_r"),
                f.get("delta_total_r"),
                None,
            ])
        


# =============================================================================
# Query Functions
# =============================================================================

def list_runs(duckdb_path: str, limit: int = 50) -> List[Dict[str, Any]]:
    """List recent optimization runs."""
    from tools.shared.duckdb_adapter import get_readonly_connection
    ensure_trial_schema(duckdb_path)
    with get_readonly_connection(duckdb_path) as con:
        rows = con.execute(f"SELECT * FROM optimizer.recent_runs_v LIMIT {limit}").fetchall()
        cols = [d[0] for d in con.description]
        return [dict(zip(cols, r)) for r in rows]


def load_trials_for_resume(duckdb_path: str, run_id: str) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Load trials from DuckDB for resume mode.
    
    Returns:
        (results, robust_candidates) - List of TrialResult dicts and robust_candidates for clustering
    """
    import json
    from tools.shared.duckdb_adapter import get_readonly_connection
    
    results: List[Dict[str, Any]] = []
    robust_candidates: List[Dict[str, Any]] = []
    
    with get_readonly_connection(duckdb_path) as con:
        # Load all trials for this run_id
        rows = con.execute("""
            SELECT 
                trial_id,
                params_json,
                summary_json,
                total_r,
                avg_r,
                alerts_ok,
                alerts_total,
                test_train_ratio,
                robust_score,
                stress_penalty,
                worst_lane,
                worst_lane_score,
                gate_check_json,
                passes_gates,
                duration_ms,
                median_dd_pre2x,
                p75_dd_pre2x,
                hit2x_pct,
                median_time_to_2x_min,
                objective_score
            FROM optimizer.trials_f
            WHERE run_id = ?
            ORDER BY created_at
        """, [run_id]).fetchall()
        
        for row in rows:
            trial_id = row[0]
            params_json = row[1]
            summary_json = row[2]
            
            # Parse JSON fields
            params = json.loads(params_json) if params_json else {}
            summary = json.loads(summary_json) if summary_json else {}
            gate_check = json.loads(row[12]) if row[12] else {}
            
            # Extract robust metrics (if available)
            # Column indices: 0=trial_id, 1=params_json, 2=summary_json, 3=total_r, 4=avg_r,
            # 5=alerts_ok, 6=alerts_total, 7=test_train_ratio, 8=robust_score, 9=stress_penalty,
            # 10=worst_lane, 11=worst_lane_score, 12=gate_check_json, 13=passes_gates,
            # 14=duration_ms, 15=median_dd_pre2x, 16=p75_dd_pre2x, 17=hit2x_pct,
            # 18=median_time_to_2x_min, 19=objective_score
            
            test_train_ratio = row[7]  # Column 7
            robust_score = row[8]  # Column 8
            stress_penalty = row[9]  # Column 9
            worst_lane = row[10]  # Column 10
            worst_lane_score = row[11]  # Column 11
            passes_gates = row[13] if len(row) > 13 else False  # Column 13
            total_r = row[3] or 0.0  # Column 3
            
            robust_result = {}
            median_test_r = None
            median_train_r = None
            
            if test_train_ratio is not None:
                # Estimate: use total_r as proxy for test_r, back-calculate train_r
                median_test_r = total_r
                median_train_r = median_test_r / test_train_ratio if test_train_ratio > 0 else 0.0
                
                robust_result = {
                    "robust_score": robust_score or 0.0,
                    "median_test_r": median_test_r,
                    "median_train_r": median_train_r,
                    "median_ratio": test_train_ratio,
                    "stress_penalty": stress_penalty or 0.0,
                    "worst_lane": worst_lane,
                    "worst_lane_score": worst_lane_score,
                    "passes_gates": passes_gates,
                }
            
            # Build objective dict
            objective = {
                "final_score": row[19] if len(row) > 19 else (row[3] or 0.0),  # objective_score or total_r
                "robust_score": robust_score,
                "test_train_ratio": test_train_ratio,
            }
            if robust_result:
                objective.update(robust_result)
            
            # Build TrialResult dict
            trial_result = {
                "trial_id": trial_id,
                "params": params,
                "summary": summary,
                "objective": objective,
                "duration_ms": row[14] if len(row) > 14 else 0,  # Column 14
                "alerts_ok": row[5] or 0,  # Column 5
                "alerts_total": row[6] or 0,  # Column 6
                "test_r": median_test_r,
                "train_r": median_train_r,
                "ratio": test_train_ratio,
                "median_dd_pre2x": row[15] if len(row) > 15 else None,  # Column 15
                "p75_dd_pre2x": row[16] if len(row) > 16 else None,  # Column 16
                "hit2x_pct": row[17] if len(row) > 17 else None,  # Column 17
                "median_t2x_min": row[18] if len(row) > 18 else None,  # Column 18
                "passes_gates": passes_gates,
            }
            
            results.append(trial_result)
            
            # Add to robust_candidates if robust mode
            if robust_result:
                robust_candidates.append({
                    "params": params,
                    "robust_result": robust_result,
                })
    
    return results, robust_candidates


def get_best_trials(duckdb_path: str, run_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    """Get best trials from a run."""
    from tools.shared.duckdb_adapter import get_readonly_connection
    ensure_trial_schema(duckdb_path)
    with get_readonly_connection(duckdb_path) as con:
        rows = con.execute("""
            SELECT * FROM optimizer.best_trials_v
            WHERE run_id = ?
            LIMIT ?
        """, [run_id, limit]).fetchall()
        cols = [d[0] for d in con.description]
        return [dict(zip(cols, r)) for r in rows]


def get_walk_forward_summary(duckdb_path: str, run_id: str) -> Optional[Dict[str, Any]]:
    """Get walk-forward summary for a run."""
    from tools.shared.duckdb_adapter import get_readonly_connection
    ensure_trial_schema(duckdb_path)
    with get_readonly_connection(duckdb_path) as con:
        row = con.execute("""
            SELECT * FROM optimizer.walk_forward_summary_v
            WHERE run_id = ?
        """, [run_id]).fetchone()
        if row is None:
            return None
        cols = [d[0] for d in con.description]
        return dict(zip(cols, row))


def print_recent_runs(duckdb_path: str, limit: int = 20) -> None:
    """Print recent runs in a nice format."""
    runs = list_runs(duckdb_path, limit)
    if not runs:
        print("No runs found.")
        return
    
    print(f"{'Run ID':<14} {'Type':<12} {'Name':<25} {'Trials':>7} {'Folds':>6} {'Created':<20}")
    print("-" * 90)
    for r in runs:
        created = r.get("created_at", "")
        if hasattr(created, "strftime"):
            created = created.strftime("%Y-%m-%d %H:%M")
        print(
            f"{r['run_id'][:12]:<14} "
            f"{r['run_type']:<12} "
            f"{(r.get('name') or '-')[:24]:<25} "
            f"{r.get('n_trials', 0):>7} "
            f"{r.get('n_folds', 0):>6} "
            f"{str(created):<20}"
        )


# =============================================================================
# PIPELINE PHASE STORAGE (two-pass audit trail)
# =============================================================================

# Phase names and order
PIPELINE_PHASES = {
    "discovery": 1,
    "clustering": 2,
    "champion_selection": 3,
    "stress_validation": 4,
    "final_selection": 5,
}


def store_phase_start(
    duckdb_path: str,
    run_id: str,
    phase_name: str,
    config: Dict[str, Any],
    input_phase_id: Optional[str] = None,
    input_summary: Optional[Dict[str, Any]] = None,
) -> str:
    """
    Record the start of a pipeline phase.
    
    Returns:
        phase_id for this phase
    """
    ensure_trial_schema(duckdb_path)
    
    from tools.shared.duckdb_adapter import get_write_connection
    phase_order = PIPELINE_PHASES.get(phase_name, 99)
    phase_id = f"{run_id}_{phase_name}"
    
    with get_write_connection(duckdb_path) as con:
        now = datetime.now(UTC).replace(tzinfo=None)
        
        con.execute("""
            INSERT OR REPLACE INTO optimizer.pipeline_phases_f (
                phase_id, run_id, phase_name, phase_order, status,
                started_at, input_phase_id, input_summary_json, config_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            phase_id,
            run_id,
            phase_name,
            phase_order,
            "running",
            now,
            input_phase_id,
            json.dumps(input_summary, separators=(",", ":"), default=str) if input_summary else None,
            json.dumps(config, separators=(",", ":"), default=str),
        ])
        
        return phase_id


def store_phase_complete(
    duckdb_path: str,
    phase_id: str,
    output_summary: Dict[str, Any],
    notes: Optional[str] = None,
) -> None:
    """Mark a pipeline phase as complete with output summary."""
    from tools.shared.duckdb_adapter import get_write_connection
    with get_write_connection(duckdb_path) as con:
        now = datetime.now(UTC).replace(tzinfo=None)
        
        # Get start time to compute duration
        row = con.execute(
            "SELECT started_at FROM optimizer.pipeline_phases_f WHERE phase_id = ?",
            [phase_id]
        ).fetchone()
        
        duration_ms = None
        if row and row[0]:
            start = row[0]
            duration_ms = int((now - start).total_seconds() * 1000)
        
        # Try to update phase status
        # If foreign key constraint fails, just log and continue (phase data is still useful)
        try:
            con.execute("""
                UPDATE optimizer.pipeline_phases_f
                SET status = 'completed',
                    completed_at = ?,
                    duration_ms = ?,
                    output_summary_json = ?,
                    notes = ?
                WHERE phase_id = ?
            """, [
                now,
                duration_ms,
                json.dumps(output_summary, separators=(",", ":"), default=str) if output_summary else None,
                notes,
                phase_id,
            ])
        except Exception as e:
            # If foreign key constraint fails (e.g., due to DuckDB strictness), 
            # log but don't fail - the phase data is still useful
            import sys
            print(f"⚠️  Warning: Could not update phase status (non-fatal): {e}", file=sys.stderr)
            # Try to at least mark as completed with a simpler update
            try:
                con.execute("""
                    UPDATE optimizer.pipeline_phases_f
                    SET status = 'completed',
                        completed_at = ?
                    WHERE phase_id = ?
                """, [now, phase_id])
            except Exception:
                pass  # Ignore if even this fails


def store_phase_failed(
    duckdb_path: str,
    phase_id: str,
    error_message: str,
) -> None:
    """Mark a pipeline phase as failed."""
    from tools.shared.duckdb_adapter import get_write_connection
    with get_write_connection(duckdb_path) as con:
        now = datetime.now(UTC).replace(tzinfo=None)
        
        con.execute("""
            UPDATE optimizer.pipeline_phases_f
            SET status = 'failed',
                completed_at = ?,
                error_message = ?,
                retry_count = retry_count + 1
            WHERE phase_id = ?
        """, [now, error_message, phase_id])


def get_phase_status(duckdb_path: str, run_id: str, phase_name: str) -> Optional[Dict[str, Any]]:
    """Get status of a specific phase for a run."""
    from tools.shared.duckdb_adapter import get_readonly_connection
    ensure_trial_schema(duckdb_path)
    with get_readonly_connection(duckdb_path) as con:
        phase_id = f"{run_id}_{phase_name}"
        row = con.execute(
            "SELECT * FROM optimizer.pipeline_phases_f WHERE phase_id = ?",
            [phase_id]
        ).fetchone()
        
        if row is None:
            return None
        
        cols = [d[0] for d in con.description]
        return dict(zip(cols, row))


def get_run_phases(duckdb_path: str, run_id: str) -> List[Dict[str, Any]]:
    """Get all phases for a run, ordered by phase_order."""
    from tools.shared.duckdb_adapter import get_readonly_connection
    ensure_trial_schema(duckdb_path)
    with get_readonly_connection(duckdb_path) as con:
        rows = con.execute("""
            SELECT * FROM optimizer.pipeline_phases_f
            WHERE run_id = ?
            ORDER BY phase_order
        """, [run_id]).fetchall()
        
        cols = [d[0] for d in con.description]
        return [dict(zip(cols, r)) for r in rows]


def can_resume_from_phase(duckdb_path: str, run_id: str, phase_name: str) -> bool:
    """
    Check if we can resume from a given phase.
    
    Returns True if the previous phase completed successfully.
    """
    phase_order = PIPELINE_PHASES.get(phase_name, 99)
    
    if phase_order == 1:
        # First phase can always run
        return True
    
    # Find the previous phase
    prev_phase_name = None
    for name, order in PIPELINE_PHASES.items():
        if order == phase_order - 1:
            prev_phase_name = name
            break
    
    if prev_phase_name is None:
        return True
    
    prev_status = get_phase_status(duckdb_path, run_id, prev_phase_name)
    return prev_status is not None and prev_status.get("status") == "completed"


def get_last_completed_phase(duckdb_path: str, run_id: str) -> Optional[str]:
    """Get the name of the last completed phase for a run."""
    phases = get_run_phases(duckdb_path, run_id)
    
    last_completed = None
    for phase in phases:
        if phase.get("status") == "completed":
            last_completed = phase.get("phase_name")
    
    return last_completed


# =============================================================================
# ISLAND STORAGE
# =============================================================================

def store_islands(
    duckdb_path: str,
    run_id: str,
    phase_id: str,
    islands: List[Dict[str, Any]],
) -> List[str]:
    """
    Store island clustering results.
    
    Args:
        islands: List of island dicts with centroid, members, scores
    
    Returns:
        List of island_ids
    """
    from tools.shared.duckdb_adapter import get_write_connection
    ensure_trial_schema(duckdb_path)
    
    with get_write_connection(duckdb_path) as con:
        now = datetime.now(UTC).replace(tzinfo=None)
        island_ids = []
        
        # Delete existing islands for this phase
        con.execute("DELETE FROM optimizer.islands_f WHERE phase_id = ?", [phase_id])
        
        for island in islands:
            island_id = f"{run_id}_island_{island.get('island_id', 0)}"
            centroid = island.get("centroid", {})
            param_spread = island.get("param_spread", {})
            
            con.execute("""
                INSERT INTO optimizer.islands_f (
                    island_id, run_id, phase_id, cluster_num, created_at,
                    centroid_tp_mult, centroid_sl_mult, centroid_json,
                    spread_tp_mult, spread_sl_mult,
                    n_members, mean_robust_score, median_robust_score, best_robust_score,
                    mean_median_test_r, mean_ratio, pct_pass_gates,
                    members_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                island_id,
                run_id,
                phase_id,
                island.get("island_id", 0),
                now,
                centroid.get("tp_mult"),
                centroid.get("sl_mult"),
                json.dumps(centroid, separators=(",", ":"), default=str),
                param_spread.get("tp_mult"),
                param_spread.get("sl_mult"),
                island.get("n_members", len(island.get("members", []))),
                island.get("mean_robust_score"),
                island.get("median_robust_score"),
                island.get("best_robust_score"),
                island.get("mean_median_test_r"),
                island.get("mean_ratio"),
                island.get("pct_pass_gates"),
                json.dumps(island.get("members", []), separators=(",", ":"), default=str),
            ])
            island_ids.append(island_id)
        
        return island_ids


def load_islands(duckdb_path: str, run_id: str) -> List[Dict[str, Any]]:
    """Load islands from a previous run."""
    from tools.shared.duckdb_adapter import get_readonly_connection
    ensure_trial_schema(duckdb_path)
    with get_readonly_connection(duckdb_path) as con:
        rows = con.execute("""
            SELECT * FROM optimizer.islands_f
            WHERE run_id = ?
            ORDER BY cluster_num
        """, [run_id]).fetchall()
        
        cols = [d[0] for d in con.description]
        islands = []
        for row in rows:
            island = dict(zip(cols, row))
            # Parse JSON fields
            if island.get("centroid_json"):
                island["centroid"] = json.loads(island["centroid_json"])
            if island.get("members_json"):
                island["members"] = json.loads(island["members_json"])
            islands.append(island)
        
        return islands


# =============================================================================
# ISLAND CHAMPION STORAGE
# =============================================================================

def store_island_champions(
    duckdb_path: str,
    run_id: str,
    phase_id: str,
    champions: List[Dict[str, Any]],
) -> List[str]:
    """
    Store island champion selections.
    
    Returns:
        List of champion_ids
    """
    from tools.shared.duckdb_adapter import get_write_connection
    ensure_trial_schema(duckdb_path)
    
    with get_write_connection(duckdb_path) as con:
        now = datetime.now(UTC).replace(tzinfo=None)
        champion_ids = []
        
        # Delete existing champions for this phase
        con.execute("DELETE FROM optimizer.island_champions_f WHERE phase_id = ?", [phase_id])
        
        for champ in champions:
            island_id = f"{run_id}_island_{champ.get('island_id', 0)}"
            champion_id = f"{run_id}_champ_{champ.get('island_id', 0)}"
            params = champ.get("params", {})
            
            con.execute("""
                INSERT INTO optimizer.island_champions_f (
                    champion_id, run_id, phase_id, island_id, created_at,
                    tp_mult, sl_mult, params_json,
                    discovery_score, median_test_r, passes_gates,
                    island_size, island_centroid_json,
                    validation_status
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                champion_id,
                run_id,
                phase_id,
                island_id,
                now,
                params.get("tp_mult"),
                params.get("sl_mult"),
                json.dumps(params, separators=(",", ":"), default=str),
                champ.get("discovery_score"),
                champ.get("median_test_r"),
                champ.get("passes_gates", False),
                champ.get("island_size"),
                json.dumps(champ.get("island_centroid", {}), separators=(",", ":"), default=str),
                "pending",
            ])
            champion_ids.append(champion_id)
        
        return champion_ids


def load_island_champions(duckdb_path: str, run_id: str) -> List[Dict[str, Any]]:
    """Load island champions from a previous run."""
    from tools.shared.duckdb_adapter import get_readonly_connection
    ensure_trial_schema(duckdb_path)
    with get_readonly_connection(duckdb_path) as con:
        rows = con.execute("""
            SELECT * FROM optimizer.island_champions_f
            WHERE run_id = ?
            ORDER BY island_id
        """, [run_id]).fetchall()
        
        cols = [d[0] for d in con.description]
        champions = []
        for row in rows:
            champ = dict(zip(cols, row))
            if champ.get("params_json"):
                champ["params"] = json.loads(champ["params_json"])
            if champ.get("island_centroid_json"):
                champ["island_centroid"] = json.loads(champ["island_centroid_json"])
            champions.append(champ)
        
        return champions


# =============================================================================
# STRESS LANE VALIDATION STORAGE
# =============================================================================

def store_stress_lane_result(
    duckdb_path: str,
    run_id: str,
    phase_id: str,
    champion_id: str,
    lane_name: str,
    lane_config: Dict[str, Any],
    result: Dict[str, Any],
    duration_ms: int = 0,
) -> str:
    """Store a single stress lane validation result."""
    ensure_trial_schema(duckdb_path)
    
    from tools.shared.duckdb_adapter import get_write_connection
    result_id = f"{champion_id}_{lane_name}"
    
    with get_write_connection(duckdb_path) as con:
        now = datetime.now(UTC).replace(tzinfo=None)
        
        con.execute("""
            INSERT OR REPLACE INTO optimizer.stress_lane_results_f (
                result_id, run_id, phase_id, champion_id, lane_name, created_at,
                fee_bps, slippage_bps, latency_candles, stop_gap_prob, stop_gap_mult,
                lane_config_json,
                test_r, ratio, passes_gates,
                duration_ms, summary_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            result_id,
            run_id,
            phase_id,
            champion_id,
            lane_name,
            now,
            lane_config.get("fee_bps"),
            lane_config.get("slippage_bps"),
            lane_config.get("latency_candles", 0),
            lane_config.get("stop_gap_prob"),
            lane_config.get("stop_gap_mult"),
            json.dumps(lane_config, separators=(",", ":"), default=str),
            result.get("test_r"),
            result.get("ratio"),
            result.get("passes_gates", False),
            duration_ms,
            json.dumps(result.get("summary", {}), separators=(",", ":"), default=str),
        ])
        
        return result_id


def get_completed_lanes_for_champion(
    duckdb_path: str,
    run_id: str,
    champion_id: str,
) -> List[str]:
    """Get list of lane names already completed for a champion."""
    from tools.shared.duckdb_adapter import get_readonly_connection
    ensure_trial_schema(duckdb_path)
    with get_readonly_connection(duckdb_path) as con:
        rows = con.execute("""
            SELECT lane_name FROM optimizer.stress_lane_results_f
            WHERE run_id = ? AND champion_id = ?
        """, [run_id, champion_id]).fetchall()
        
        return [r[0] for r in rows]


def load_stress_lane_results(
    duckdb_path: str,
    run_id: str,
    champion_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Load stress lane results for a run or specific champion."""
    from tools.shared.duckdb_adapter import get_readonly_connection
    ensure_trial_schema(duckdb_path)
    with get_readonly_connection(duckdb_path) as con:
        if champion_id:
            rows = con.execute("""
                SELECT * FROM optimizer.stress_lane_results_f
                WHERE run_id = ? AND champion_id = ?
                ORDER BY lane_name
            """, [run_id, champion_id]).fetchall()
        else:
            rows = con.execute("""
                SELECT * FROM optimizer.stress_lane_results_f
                WHERE run_id = ?
                ORDER BY champion_id, lane_name
            """, [run_id]).fetchall()
        
        cols = [d[0] for d in con.description]
        results = []
        for row in rows:
            result = dict(zip(cols, row))
            if result.get("lane_config_json"):
                result["lane_config"] = json.loads(result["lane_config_json"])
            if result.get("summary_json"):
                result["summary"] = json.loads(result["summary_json"])
            results.append(result)
        
        return results


# =============================================================================
# CHAMPION VALIDATION SUMMARY STORAGE
# =============================================================================

def store_champion_validation(
    duckdb_path: str,
    run_id: str,
    phase_id: str,
    champion_id: str,
    island_id: str,
    lane_scores: Dict[str, float],
    validation_rank: int,
    discovery_score: float,
) -> str:
    """Store the final validation summary for a champion."""
    ensure_trial_schema(duckdb_path)
    
    validation_id = f"{champion_id}_validation"
    
    # Compute aggregate scores
    scores = list(lane_scores.values())
    sorted_scores = sorted(scores)
    n = len(sorted_scores)
    
    robust_score = min(scores) if scores else 0.0
    median_score = sorted_scores[n // 2] if n > 0 else 0.0
    p25_score = sorted_scores[n // 4] if n >= 4 else min(scores) if scores else 0.0
    mean_score = sum(scores) / n if n > 0 else 0.0
    
    worst_lane = min(lane_scores.keys(), key=lambda k: lane_scores[k]) if lane_scores else None
    worst_lane_score = lane_scores.get(worst_lane, 0.0) if worst_lane else 0.0
    
    lanes_passing = sum(1 for s in scores if s >= 0)
    from tools.shared.duckdb_adapter import get_write_connection
    score_delta = robust_score - discovery_score
    
    with get_write_connection(duckdb_path) as con:
        now = datetime.now(UTC).replace(tzinfo=None)
        
        con.execute("""
            INSERT OR REPLACE INTO optimizer.champion_validation_f (
                validation_id, run_id, phase_id, champion_id, island_id, created_at,
                n_lanes, lane_scores_json,
                robust_score, median_score, p25_score, mean_score,
                worst_lane, worst_lane_score,
                lanes_passing, validation_rank, score_delta
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            validation_id,
            run_id,
            phase_id,
            champion_id,
            island_id,
            now,
            n,
            json.dumps(lane_scores, separators=(",", ":"), default=str),
            robust_score,
            median_score,
            p25_score,
            mean_score,
            worst_lane,
            worst_lane_score,
            lanes_passing,
            validation_rank,
            score_delta,
        ])
        
        # Update champion validation status
        con.execute("""
            UPDATE optimizer.island_champions_f
            SET validation_status = 'validated'
            WHERE champion_id = ?
        """, [champion_id])
        
        return validation_id


def load_champion_validations(duckdb_path: str, run_id: str) -> List[Dict[str, Any]]:
    """Load champion validation summaries for a run."""
    from tools.shared.duckdb_adapter import get_readonly_connection
    ensure_trial_schema(duckdb_path)
    with get_readonly_connection(duckdb_path) as con:
        rows = con.execute("""
            SELECT * FROM optimizer.champion_validation_f
            WHERE run_id = ?
            ORDER BY validation_rank
        """, [run_id]).fetchall()
        
        cols = [d[0] for d in con.description]
        results = []
        for row in rows:
            result = dict(zip(cols, row))
            if result.get("lane_scores_json"):
                result["lane_scores"] = json.loads(result["lane_scores_json"])
            results.append(result)
        
        return results


def get_maximin_winner(duckdb_path: str, run_id: str) -> Optional[Dict[str, Any]]:
    """Get the maximin winner (validation_rank = 1) for a run."""
    validations = load_champion_validations(duckdb_path, run_id)
    for v in validations:
        if v.get("validation_rank") == 1:
            return v
    return None


# =============================================================================
# RESUME HELPERS
# =============================================================================

def get_resumable_run_state(duckdb_path: str, run_id: str) -> Dict[str, Any]:
    """
    Get the current state of a run for resume purposes.
    
    Returns:
        Dict with:
        - last_completed_phase: Name of last completed phase
        - next_phase: Name of next phase to run (or None if complete)
        - phases: List of all phases with status
        - can_resume: Whether we can resume from current state
        - islands_count: Number of islands stored
        - champions_count: Number of champions stored
        - lane_results_count: Number of lane results stored
    """
    ensure_trial_schema(duckdb_path)
    
    phases = get_run_phases(duckdb_path, run_id)
    last_completed = get_last_completed_phase(duckdb_path, run_id)
    
    # Determine next phase
    next_phase = None
    if last_completed is None:
        next_phase = "discovery"
    else:
        last_order = PIPELINE_PHASES.get(last_completed, 0)
        for name, order in sorted(PIPELINE_PHASES.items(), key=lambda x: x[1]):
            if order == last_order + 1:
                next_phase = name
                break
    
    # Count stored objects
    from tools.shared.duckdb_adapter import get_readonly_connection
    with get_readonly_connection(duckdb_path) as con:
        islands_count = con.execute(
            "SELECT COUNT(*) FROM optimizer.islands_f WHERE run_id = ?", [run_id]
        ).fetchone()[0]
        
        champions_count = con.execute(
            "SELECT COUNT(*) FROM optimizer.island_champions_f WHERE run_id = ?", [run_id]
        ).fetchone()[0]
        
        lane_results_count = con.execute(
            "SELECT COUNT(*) FROM optimizer.stress_lane_results_f WHERE run_id = ?", [run_id]
        ).fetchone()[0]
    
    can_resume = next_phase is None or can_resume_from_phase(duckdb_path, run_id, next_phase)
    
    return {
        "run_id": run_id,
        "last_completed_phase": last_completed,
        "next_phase": next_phase,
        "phases": phases,
        "can_resume": can_resume,
        "is_complete": next_phase is None or last_completed == "final_selection",
        "islands_count": islands_count,
        "champions_count": champions_count,
        "lane_results_count": lane_results_count,
    }


def print_run_state(duckdb_path: str, run_id: str) -> None:
    """Print the current state of a run."""
    state = get_resumable_run_state(duckdb_path, run_id)
    
    print(f"\n{'='*60}")
    print(f"RUN STATE: {run_id}")
    print(f"{'='*60}")
    
    print(f"\nLast completed phase: {state['last_completed_phase'] or 'None'}")
    print(f"Next phase: {state['next_phase'] or 'Complete'}")
    print(f"Can resume: {'Yes' if state['can_resume'] else 'No'}")
    print(f"Is complete: {'Yes' if state['is_complete'] else 'No'}")
    
    print(f"\nStored objects:")
    print(f"  Islands: {state['islands_count']}")
    print(f"  Champions: {state['champions_count']}")
    print(f"  Lane results: {state['lane_results_count']}")
    
    print(f"\nPhase history:")
    for phase in state['phases']:
        status = phase.get('status', 'unknown')
        status_icon = {'completed': '✓', 'running': '→', 'failed': '✗', 'pending': '○'}.get(status, '?')
        duration = phase.get('duration_ms')
        duration_str = f" ({duration}ms)" if duration else ""
        print(f"  [{status_icon}] {phase['phase_name']}: {status}{duration_str}")


def write_trials_to_parquet(trials: List[Dict[str, Any]], run_id: str, parquet_path: str) -> None:
    """
    Write trial results directly to Parquet file (artifacts).
    
    This writes trial data directly to Parquet without going through DuckDB first.
    DuckDB will only store metadata (file path) as a catalog.
    
    Args:
        trials: List of trial result dicts (from TrialResult.to_dict())
        run_id: Run ID
        parquet_path: Output path for Parquet file (string or Path)
    """
    from pathlib import Path
    import duckdb
    
    parquet_path_obj = Path(parquet_path)
    parquet_path_obj.parent.mkdir(parents=True, exist_ok=True)
    
    if not trials:
        return
    
    # Use in-memory DuckDB to convert dicts to Parquet
    # This matches the schema from optimizer.trials_f
    with duckdb.connect(":memory:") as con:
        # Create temp table with same schema as trials_f
        con.execute("""
            CREATE TABLE trials_temp AS
            SELECT * FROM (
                SELECT 
                    ?::TEXT as trial_id,
                    ?::TEXT as run_id,
                    ?::TIMESTAMP as created_at,
                    ?::TEXT as strategy_name,
                    ?::DOUBLE as tp_mult,
                    ?::DOUBLE as sl_mult,
                    ?::TEXT as intrabar_order,
                    ?::TEXT as params_json,
                    ?::DATE as date_from,
                    ?::DATE as date_to,
                    ?::TEXT as entry_mode,
                    ?::INTEGER as horizon_hours,
                    ?::INTEGER as alerts_total,
                    ?::INTEGER as alerts_ok,
                    ?::DOUBLE as total_r,
                    ?::DOUBLE as avg_r,
                    ?::DOUBLE as avg_r_win,
                    ?::DOUBLE as avg_r_loss,
                    ?::DOUBLE as r_profit_factor,
                    ?::DOUBLE as win_rate,
                    ?::DOUBLE as profit_factor,
                    ?::DOUBLE as expectancy_pct,
                    ?::DOUBLE as total_return_pct,
                    ?::DOUBLE as risk_adj_total_return_pct,
                    ?::DOUBLE as hit2x_pct,
                    ?::DOUBLE as hit3x_pct,
                    ?::DOUBLE as hit4x_pct,
                    ?::DOUBLE as median_ath_mult,
                    ?::DOUBLE as p75_ath_mult,
                    ?::DOUBLE as p95_ath_mult,
                    ?::DOUBLE as median_time_to_2x_min,
                    ?::DOUBLE as median_time_to_3x_min,
                    ?::DOUBLE as median_dd_pre2x,
                    ?::DOUBLE as p95_dd_pre2x,
                    ?::DOUBLE as p75_dd_pre2x,
                    ?::DOUBLE as median_dd_overall,
                    ?::DOUBLE as objective_score,
                    ?::DOUBLE as test_train_ratio,
                    ?::DOUBLE as robust_score,
                    ?::DOUBLE as stress_penalty,
                    ?::TEXT as worst_lane,
                    ?::DOUBLE as worst_lane_score,
                    ?::TEXT as gate_check_json,
                    ?::BOOLEAN as passes_gates,
                    ?::BIGINT as duration_ms,
                    ?::TEXT as summary_json
            ) WHERE FALSE
        """)
        
        # Insert all trials
        created_at = datetime.now(UTC).replace(tzinfo=None)
        for i, r in enumerate(trials):
            trial_id = f"{run_id}_{i:04d}"
            params = r.get("params", {})
            s = r.get("summary", {})
            obj = r.get("objective", {})
            
            # Extract metrics (matching store_optimizer_run logic)
            test_train_ratio = r.get("ratio") or obj.get("median_ratio") if isinstance(obj, dict) else None
            robust_score = obj.get("robust_score") if isinstance(obj, dict) else None
            stress_penalty = obj.get("stress_penalty") if isinstance(obj, dict) else None
            worst_lane = obj.get("worst_lane") if isinstance(obj, dict) else None
            worst_lane_score = obj.get("worst_lane_score") if isinstance(obj, dict) else None
            passes_gates = r.get("passes_gates", True)
            gate_check = r.get("gate_check")
            
            # Use same logic as store_optimizer_run to populate fields
            con.execute("""
                INSERT INTO trials_temp VALUES (
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 
                    ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?, ?, ?, ?, ?
                )
            """, [
                trial_id, run_id, created_at,
                params.get("strategy_name", ""),
                params.get("tp_mult"), params.get("sl_mult"),
                params.get("intrabar_order", "sl_first"),
                json.dumps(params, separators=(",", ":"), default=str),
                None, None,  # date_from, date_to (from run level)
                params.get("entry_mode"),
                None,  # horizon_hours (from config)
                r.get("alerts_total", 0), r.get("alerts_ok", 0),
                s.get("total_r"), s.get("avg_r"), s.get("avg_r_win"),
                s.get("avg_r_loss"), s.get("r_profit_factor"),
                s.get("tp_sl_win_rate"), s.get("profit_factor"),
                s.get("expectancy_pct"), s.get("total_return_pct"),
                s.get("risk_adj_total_return_pct"),
                s.get("pct_hit_2x"), s.get("pct_hit_3x"), s.get("pct_hit_4x"),
                s.get("median_ath_mult"), s.get("p75_ath_mult"), s.get("p95_ath_mult"),
                s.get("median_t2x_min"), s.get("median_t3x_min"),
                r.get("median_dd_pre2x"), s.get("p95_dd_pre2x"),
                r.get("p75_dd_pre2x"), s.get("median_dd_overall"),
                obj.get("final_score") if isinstance(obj, dict) else None,
                test_train_ratio, robust_score, stress_penalty,
                worst_lane, worst_lane_score,
                json.dumps(gate_check, separators=(",", ":")) if gate_check else None,
                passes_gates, r.get("duration_ms", 0),
                json.dumps(s, separators=(",", ":"), default=str),
            ])
        
        # Export to Parquet
        parquet_path_escaped = str(parquet_path).replace("'", "''")
        con.execute(f"COPY trials_temp TO '{parquet_path_escaped}' (FORMAT PARQUET)")


def write_trades_to_parquet(trades: List[Dict[str, Any]], run_id: str, parquet_path: str) -> None:
    """
    Write per-alert trade records directly to Parquet file (trade history / replay artifacts).
    
    This writes trade-by-trade records that are auditable and replayable.
    Each record represents one alert/trade with entry/exit details.
    
    Args:
        trades: List of trade record dicts (from run_tp_sl_query rows with trial_id, fold_name, run_id added)
        run_id: Run ID
        parquet_path: Output path for Parquet file (string or Path)
    """
    from pathlib import Path
    import duckdb
    
    parquet_path_obj = Path(parquet_path)
    parquet_path_obj.parent.mkdir(parents=True, exist_ok=True)
    
    if not trades:
        return
    
    # Use in-memory DuckDB to convert dicts to Parquet
    with duckdb.connect(":memory:") as con:
        # Get sample row to infer schema dynamically
        sample = trades[0]
        columns = list(sample.keys())
        
        # Build CREATE TABLE statement dynamically based on actual columns
        # This ensures we capture all columns from run_tp_sl_query
        col_defs = []
        for col in columns:
            if col in ["run_id", "trial_id", "fold_name", "mint", "caller", "status", "tp_sl_exit_reason"]:
                col_defs.append(f"{col} TEXT")
            elif col == "alert_id":
                col_defs.append(f"{col} BIGINT")
            elif "ts" in col.lower() or "time" in col.lower() or ("at" in col.lower() and "ts" in col.lower()):
                col_defs.append(f"{col} TIMESTAMP")
            elif col in ["entry_price", "exit_price", "exit_h", "exit_l", "exit_cl", "tp_sl_ret", "ret_end", 
                         "total_r", "avg_r", "ath_mult", "dd_pre2x", "peak_pnl_pct"]:
                col_defs.append(f"{col} DOUBLE")
            elif "count" in col.lower() or "candles" in col.lower():
                col_defs.append(f"{col} BIGINT")
            else:
                # Try to infer type from sample value
                val = sample.get(col)
                if val is None:
                    col_defs.append(f"{col} DOUBLE")  # Default to DOUBLE for nulls
                elif isinstance(val, (int, float)):
                    col_defs.append(f"{col} DOUBLE")
                elif isinstance(val, bool):
                    col_defs.append(f"{col} BOOLEAN")
                else:
                    col_defs.append(f"{col} TEXT")
        
        create_sql = f"""
            CREATE TABLE trades_temp (
                {', '.join(col_defs)}
            )
        """
        con.execute(create_sql)
        
        # Insert all trades
        for trade in trades:
            values = [trade.get(col) for col in columns]
            placeholders = ", ".join(["?"] * len(values))
            con.execute(f"INSERT INTO trades_temp ({', '.join(columns)}) VALUES ({placeholders})", values)
        
        # Export to Parquet
        parquet_path_escaped = str(parquet_path).replace("'", "''")
        con.execute(f"COPY trades_temp TO '{parquet_path_escaped}' (FORMAT PARQUET)")


# =============================================================================
# REPLAY AND RESUME FUNCTIONALITY
# =============================================================================

def load_trades_from_parquet(parquet_path: str) -> List[Dict[str, Any]]:
    """
    Load trade-by-trade records from Parquet file.
    
    Args:
        parquet_path: Path to Parquet file (string or Path)
    
    Returns:
        List of trade record dicts
    """
    from pathlib import Path
    import duckdb
    
    parquet_path_obj = Path(parquet_path)
    if not parquet_path_obj.exists():
        return []
    
    with duckdb.connect(":memory:") as con:
        parquet_path_escaped = str(parquet_path).replace("'", "''")
        rows = con.execute(f"SELECT * FROM '{parquet_path_escaped}'").fetchall()
        cols = [d[0] for d in con.description]
        return [dict(zip(cols, r)) for r in rows]


def get_completed_trial_ids_from_parquet(parquet_path: str) -> Dict[str, Set[str]]:
    """
    Get set of completed trial_ids from Parquet file, grouped by fold_name.
    
    This is used for resume functionality - to determine which trials
    have already been completed and can be skipped.
    
    Args:
        parquet_path: Path to trades Parquet file
    
    Returns:
        Dict mapping fold_name -> set of completed trial_ids
    """
    trades = load_trades_from_parquet(parquet_path)
    if not trades:
        return {}
    
    # Group trades by fold_name and trial_id
    completed: Dict[str, Set[str]] = {}
    for trade in trades:
        fold_name = trade.get("fold_name", "default")
        trial_id = trade.get("trial_id")
        if trial_id:
            if fold_name not in completed:
                completed[fold_name] = set()
            completed[fold_name].add(trial_id)
    
    return completed


def reconstruct_trial_summary_from_trades(
    trades: List[Dict[str, Any]],
    sl_mult: float = 0.5,
    risk_per_trade: float = 0.02,
) -> Dict[str, Any]:
    """
    Reconstruct trial summary from trade records (replay functionality).
    
    This aggregates per-alert trade records back into a trial summary,
    matching the output of summarize_tp_sl().
    
    Args:
        trades: List of trade record dicts (from load_trades_from_parquet)
        sl_mult: Stop-loss multiplier (for risk calculations)
        risk_per_trade: Maximum risk per trade as fraction
    
    Returns:
        Summary dict matching summarize_tp_sl() output
    """
    from lib.summary import summarize_tp_sl
    
    # Convert trade records back to the format expected by summarize_tp_sl
    # Trade records have all the columns from run_tp_sl_query
    rows = trades
    
    # Use existing summarize_tp_sl function
    return summarize_tp_sl(rows, sl_mult=sl_mult, risk_per_trade=risk_per_trade)


def replay_run_from_parquet(
    trades_parquet_path: str,
    trials_parquet_path: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Replay an entire run from Parquet files (full replay functionality).
    
    This reconstructs the entire run state from trade history and trial summaries,
    allowing you to replay/verify a run without re-running it.
    
    Args:
        trades_parquet_path: Path to trades Parquet file
        trials_parquet_path: Optional path to trials Parquet file (for metadata)
    
    Returns:
        Dict with:
        - trades: List of all trade records
        - trials: Dict mapping trial_id -> reconstructed trial summary
        - run_id: Run ID from trades
        - completed_trial_ids: Set of completed trial IDs
    """
    trades = load_trades_from_parquet(trades_parquet_path)
    if not trades:
        return {
            "trades": [],
            "trials": {},
            "run_id": None,
            "completed_trial_ids": set(),
        }
    
    # Extract run_id
    run_id = trades[0].get("run_id") if trades else None
    
    # Group trades by trial_id and fold_name
    trial_trades: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for trade in trades:
        trial_id = trade.get("trial_id")
        fold_name = trade.get("fold_name", "default")
        key = (trial_id, fold_name)
        if key not in trial_trades:
            trial_trades[key] = []
        trial_trades[key].append(trade)
    
    # Reconstruct trial summaries
    trials: Dict[str, Dict[str, Any]] = {}
    completed_trial_ids: Set[str] = set()
    
    for (trial_id, fold_name), fold_trades in trial_trades.items():
        if trial_id:
            completed_trial_ids.add(trial_id)
            
            # Get sl_mult from first trade (it's in params or we can infer)
            sl_mult = 0.5  # Default
            if fold_trades:
                # Try to extract from trade data
                first_trade = fold_trades[0]
                # sl_mult might be in params_json or we need to infer from exit_reason
            
            # Reconstruct summary for this fold
            summary = reconstruct_trial_summary_from_trades(fold_trades, sl_mult=sl_mult)
            
            # Store by trial_id (aggregate across folds if needed)
            if trial_id not in trials:
                trials[trial_id] = {
                    "trial_id": trial_id,
                    "fold_summaries": [],
                    "total_trades": 0,
                }
            
            trials[trial_id]["fold_summaries"].append({
                "fold_name": fold_name,
                "summary": summary,
                "n_trades": len(fold_trades),
            })
            trials[trial_id]["total_trades"] += len(fold_trades)
    
    return {
        "trades": trades,
        "trials": trials,
        "run_id": run_id,
        "completed_trial_ids": completed_trial_ids,
    }

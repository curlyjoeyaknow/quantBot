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
from typing import Any, Dict, List, Optional

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
            json.dumps(output_summary, separators=(",", ":"), default=str),
            notes,
            phase_id,
        ])


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


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
    
    -- Metadata
    notes TEXT
);

-- Trials table - one row per parameter combination tested
CREATE TABLE IF NOT EXISTS optimizer.trials_f (
    trial_id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL,
    
    -- Parameters
    tp_mult DOUBLE,
    sl_mult DOUBLE,
    intrabar_order TEXT,
    params_json TEXT,
    
    -- Dataset info
    date_from DATE,
    date_to DATE,
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
    
    -- Degradation (overfit detection)
    avg_r_degradation DOUBLE,
    total_r_degradation DOUBLE,
    
    notes TEXT,
    
    FOREIGN KEY (run_id) REFERENCES optimizer.runs_d(run_id)
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_trials_run_id ON optimizer.trials_f(run_id);
CREATE INDEX IF NOT EXISTS idx_trials_total_r ON optimizer.trials_f(total_r DESC);
CREATE INDEX IF NOT EXISTS idx_wf_run_id ON optimizer.walk_forward_f(run_id);

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
    t.tp_mult,
    t.sl_mult,
    t.total_r,
    t.avg_r,
    t.win_rate,
    t.risk_adj_total_return_pct,
    row_number() OVER (PARTITION BY t.run_id ORDER BY t.total_r DESC) AS rank_by_total_r
FROM optimizer.trials_f t
ORDER BY t.run_id, t.total_r DESC;

CREATE OR REPLACE VIEW optimizer.walk_forward_summary_v AS
SELECT
    run_id,
    COUNT(*) AS n_folds,
    AVG(train_total_r) AS avg_train_r,
    AVG(test_total_r) AS avg_test_r,
    AVG(avg_r_degradation) AS avg_degradation,
    SUM(CASE WHEN avg_r_degradation < 0 THEN 1 ELSE 0 END) AS folds_improved,
    SUM(CASE WHEN avg_r_degradation > 0.5 THEN 1 ELSE 0 END) AS folds_overfit
FROM optimizer.walk_forward_f
GROUP BY run_id;
"""


def ensure_trial_schema(duckdb_path: str) -> None:
    """Create the trial ledger schema if it doesn't exist."""
    con = duckdb.connect(duckdb_path)
    try:
        for stmt in SCHEMA_SQL.split(";"):
            stmt = stmt.strip()
            if stmt:
                con.execute(stmt)
    finally:
        con.close()


# =============================================================================
# Storage Functions
# =============================================================================

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
    """
    ensure_trial_schema(duckdb_path)
    
    con = duckdb.connect(duckdb_path)
    try:
        created_at = datetime.now(UTC).replace(tzinfo=None)
        
        # Compute totals from results
        alerts_total = results[0].get("alerts_total", 0) if results else 0
        alerts_ok = results[0].get("alerts_ok", 0) if results else 0
        
        # Summary of best result
        best_result = max(results, key=lambda r: r.get("summary", {}).get("total_r", 0)) if results else {}
        summary = best_result.get("summary", {})
        
        # Insert run
        con.execute("""
            INSERT OR REPLACE INTO optimizer.runs_d (
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
            
            con.execute("""
                INSERT INTO optimizer.trials_f (
                    trial_id, run_id, created_at,
                    tp_mult, sl_mult, intrabar_order, params_json,
                    date_from, date_to, alerts_total, alerts_ok,
                    total_r, avg_r, avg_r_win, avg_r_loss, r_profit_factor,
                    win_rate, profit_factor, expectancy_pct,
                    total_return_pct, risk_adj_total_return_pct,
                    duration_ms, summary_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                trial_id,
                run_id,
                created_at,
                params.get("tp_mult"),
                params.get("sl_mult"),
                params.get("intrabar_order", "sl_first"),
                json.dumps(params, separators=(",", ":"), default=str),
                date_from,
                date_to,
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
                int(r.get("duration_s", 0) * 1000),
                json.dumps(s, separators=(",", ":"), default=str),
            ])
        
    finally:
        con.close()


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
    ensure_trial_schema(duckdb_path)
    
    con = duckdb.connect(duckdb_path)
    try:
        created_at = datetime.now(UTC).replace(tzinfo=None)
        
        # Compute summary
        if folds:
            date_from = min(f.get("train_from", "") for f in folds)
            date_to = max(f.get("test_to", "") for f in folds)
            alerts_total = sum(f.get("train_alerts", 0) + f.get("test_alerts", 0) for f in folds)
            avg_test_r = sum(f.get("test_total_r", 0) for f in folds) / len(folds)
            avg_degrad = sum(f.get("avg_r_degradation", 0) for f in folds) / len(folds)
            summary = {
                "n_folds": len(folds),
                "avg_test_total_r": avg_test_r,
                "avg_degradation": avg_degrad,
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
                    avg_r_degradation, total_r_degradation, notes
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
                f.get("avg_r_degradation"),
                f.get("total_r_degradation"),
                None,
            ])
        
    finally:
        con.close()


# =============================================================================
# Query Functions
# =============================================================================

def list_runs(duckdb_path: str, limit: int = 50) -> List[Dict[str, Any]]:
    """List recent optimization runs."""
    ensure_trial_schema(duckdb_path)
    con = duckdb.connect(duckdb_path, read_only=True)
    try:
        rows = con.execute(f"SELECT * FROM optimizer.recent_runs_v LIMIT {limit}").fetchall()
        cols = [d[0] for d in con.description]
        return [dict(zip(cols, r)) for r in rows]
    finally:
        con.close()


def get_best_trials(duckdb_path: str, run_id: str, limit: int = 10) -> List[Dict[str, Any]]:
    """Get best trials from a run."""
    ensure_trial_schema(duckdb_path)
    con = duckdb.connect(duckdb_path, read_only=True)
    try:
        rows = con.execute("""
            SELECT * FROM optimizer.best_trials_v
            WHERE run_id = ?
            LIMIT ?
        """, [run_id, limit]).fetchall()
        cols = [d[0] for d in con.description]
        return [dict(zip(cols, r)) for r in rows]
    finally:
        con.close()


def get_walk_forward_summary(duckdb_path: str, run_id: str) -> Optional[Dict[str, Any]]:
    """Get walk-forward summary for a run."""
    ensure_trial_schema(duckdb_path)
    con = duckdb.connect(duckdb_path, read_only=True)
    try:
        row = con.execute("""
            SELECT * FROM optimizer.walk_forward_summary_v
            WHERE run_id = ?
        """, [run_id]).fetchone()
        if row is None:
            return None
        cols = [d[0] for d in con.description]
        return dict(zip(cols, row))
    finally:
        con.close()


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


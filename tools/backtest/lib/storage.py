"""
DuckDB storage for backtest results.

Provides schema management and data insertion for:
- baseline.* schema (pure path metrics)
- bt.* schema (TP/SL strategy results)
"""

from __future__ import annotations

import json
import math
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List

import duckdb

from .helpers import parse_utc_ts

UTC = timezone.utc


# =============================================================================
# Baseline Schema (baseline.*)
# =============================================================================

def ensure_baseline_schema(con: duckdb.DuckDBPyConnection) -> None:
    """Create baseline schema and tables if they don't exist."""
    con.execute("CREATE SCHEMA IF NOT EXISTS baseline;")

    # Use TEXT for run_id (not UUID) to avoid fragility
    con.execute("""
        CREATE TABLE IF NOT EXISTS baseline.runs_d (
            run_id TEXT PRIMARY KEY,
            created_at TIMESTAMP,
            run_name TEXT,
            date_from DATE,
            date_to DATE,
            interval_seconds INTEGER,
            horizon_hours INTEGER,
            chain TEXT,
            alerts_total INTEGER,
            alerts_ok INTEGER,
            config_json TEXT,
            summary_json TEXT,
            slice_path TEXT,
            partitioned BOOLEAN
        );
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS baseline.alert_results_f (
            run_id TEXT,
            alert_id BIGINT,
            mint TEXT,
            caller TEXT,
            alert_ts_utc TIMESTAMP,
            entry_ts_utc TIMESTAMP,
            status TEXT,
            candles BIGINT,
            entry_price DOUBLE,
            ath_mult DOUBLE,
            time_to_ath_s BIGINT,
            time_to_2x_s BIGINT,
            time_to_3x_s BIGINT,
            time_to_4x_s BIGINT,
            time_to_5x_s BIGINT,
            time_to_10x_s BIGINT,
            dd_initial DOUBLE,
            dd_overall DOUBLE,
            dd_pre2x DOUBLE,
            dd_after_2x DOUBLE,
            dd_after_3x DOUBLE,
            dd_after_4x DOUBLE,
            dd_after_5x DOUBLE,
            dd_after_10x DOUBLE,
            dd_after_ath DOUBLE,
            peak_pnl_pct DOUBLE,
            ret_end_pct DOUBLE,
            PRIMARY KEY(run_id, alert_id)
        );
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS baseline.caller_stats_f (
            run_id TEXT,
            caller TEXT,
            n INTEGER,
            median_ath DOUBLE,
            p25_ath DOUBLE,
            p75_ath DOUBLE,
            p95_ath DOUBLE,
            hit2x_pct DOUBLE,
            hit3x_pct DOUBLE,
            hit4x_pct DOUBLE,
            hit5x_pct DOUBLE,
            hit10x_pct DOUBLE,
            median_t2x_hrs DOUBLE,
            median_dd_initial_pct DOUBLE,
            median_dd_overall_pct DOUBLE,
            median_dd_pre2x_pct DOUBLE,
            median_dd_pre2x_or_horizon_pct DOUBLE,
            median_dd_after_2x_pct DOUBLE,
            median_dd_after_3x_pct DOUBLE,
            median_dd_after_ath_pct DOUBLE,
            worst_dd_pct DOUBLE,
            median_peak_pnl_pct DOUBLE,
            median_ret_end_pct DOUBLE
        );
    """)

    # Convenience views
    con.execute("""
        CREATE OR REPLACE VIEW baseline.caller_leaderboard_v AS
        SELECT
          run_id,
          caller,
          n,
          median_ath,
          p75_ath,
          p95_ath,
          hit2x_pct,
          hit3x_pct,
          hit4x_pct,
          hit5x_pct,
          median_t2x_hrs,
          median_dd_initial_pct,
          median_dd_overall_pct,
          median_dd_pre2x_pct,
          median_dd_pre2x_or_horizon_pct,
          median_dd_after_2x_pct,
          median_dd_after_ath_pct,
          median_peak_pnl_pct,
          median_ret_end_pct
        FROM baseline.caller_stats_f
        ORDER BY run_id, median_ath DESC;
    """)

    con.execute("""
        CREATE OR REPLACE VIEW baseline.run_summary_v AS
        SELECT
          run_id, created_at, run_name, chain, date_from, date_to, interval_seconds, horizon_hours,
          alerts_total, alerts_ok,
          json_extract_string(summary_json, '$.median_ath_mult') AS median_ath_mult,
          json_extract_string(summary_json, '$.pct_hit_2x') AS pct_hit_2x,
          json_extract_string(summary_json, '$.median_dd_overall') AS median_dd_overall,
          json_extract_string(summary_json, '$.median_peak_pnl_pct') AS median_peak_pnl_pct
        FROM baseline.runs_d
        ORDER BY created_at DESC;
    """)

    # Caller scoring view v2: rewards fast 2x with controlled pre-2x pain
    # Scoring philosophy: "who delivers fast 2x with controlled pre-2x pain"
    # - Exponential risk penalty after 30% DD magnitude
    # - Fast 2x timing boost
    # - Synergy bonus for hit2x >= 50% AND risk <= 30%
    # - Tail bonus for p75/p95
    # - Confidence shrink for sample size
    con.execute("""
        CREATE OR REPLACE VIEW baseline.caller_scored_v2 AS
        WITH src AS (
          SELECT
            run_id,
            caller,
            n,
            median_ath,
            p75_ath,
            p95_ath,
            hit2x_pct,
            hit3x_pct,
            hit4x_pct,
            hit5x_pct,
            median_t2x_hrs,
            COALESCE(median_dd_pre2x_or_horizon_pct, median_dd_pre2x_pct, median_dd_overall_pct) AS risk_dd_pct,
            median_dd_pre2x_pct,
            median_dd_pre2x_or_horizon_pct
          FROM baseline.caller_stats_f
        ),
        feat AS (
          SELECT
            *,
            GREATEST(0.0, -COALESCE(risk_dd_pct, 0.0) / 100.0) AS risk_mag,
            CASE WHEN median_t2x_hrs IS NULL THEN NULL ELSE median_t2x_hrs * 60.0 END AS median_t2x_min,
            (GREATEST(COALESCE(median_ath, 1.0) - 1.0, 0.0) * (COALESCE(hit2x_pct, 0.0) / 100.0)) AS base_upside,
            (0.15 * GREATEST(COALESCE(p75_ath, median_ath) - COALESCE(median_ath, 1.0), 0.0))
            + (0.10 * GREATEST(COALESCE(p95_ath, p75_ath) - COALESCE(p75_ath, median_ath), 0.0)) AS tail_bonus,
            CASE WHEN median_t2x_hrs IS NULL THEN 0.0 ELSE exp(-(median_t2x_hrs * 60.0) / 60.0) END AS fast2x_signal,
            sqrt(n * 1.0 / (n + 50.0)) AS confidence
          FROM src
        ),
        pen AS (
          SELECT
            *,
            CASE WHEN risk_mag <= 0.30 THEN 0.0 ELSE exp(15.0 * (risk_mag - 0.30)) - 1.0 END AS risk_penalty,
            CASE WHEN COALESCE(hit2x_pct, 0.0) >= 50.0 AND risk_mag <= 0.30 THEN 0.60 ELSE 0.0 END AS discipline_bonus
          FROM feat
        ),
        score AS (
          SELECT
            *,
            (1.0 + 0.80 * fast2x_signal) AS timing_mult,
            confidence * (((base_upside + tail_bonus) * (1.0 + 0.80 * fast2x_signal)) + discipline_bonus - (1.00 * risk_penalty)) AS score_v2
          FROM pen
        )
        SELECT
          run_id, caller, n,
          median_ath, p75_ath, p95_ath,
          hit2x_pct, hit3x_pct, hit4x_pct, hit5x_pct,
          median_t2x_hrs, median_t2x_min,
          median_dd_pre2x_pct, median_dd_pre2x_or_horizon_pct, risk_dd_pct, risk_mag,
          base_upside, tail_bonus, fast2x_signal, discipline_bonus, risk_penalty, confidence,
          score_v2
        FROM score;
    """)


def store_baseline_run(
    duckdb_path: str,
    run_id: str,
    run_name: str,
    config: Dict[str, Any],
    rows: List[Dict[str, Any]],
    summary: Dict[str, Any],
    caller_agg: List[Dict[str, Any]],
    slice_path: str,
    partitioned: bool,
) -> None:
    """
    Store a baseline backtest run to DuckDB.

    Args:
        duckdb_path: Path to DuckDB file
        run_id: Unique run identifier
        run_name: Human-readable run name
        config: Run configuration dict
        rows: Per-alert results
        summary: Overall summary metrics
        caller_agg: Caller aggregation stats
        slice_path: Path to slice used
        partitioned: Whether slice was partitioned
    """
    con = duckdb.connect(duckdb_path)
    try:
        con.execute("BEGIN;")
        ensure_baseline_schema(con)

        # Convert created_at to naive datetime (DuckDB prefers this)
        created_at = datetime.now(tz=UTC).replace(tzinfo=None)

        con.execute("""
            INSERT OR REPLACE INTO baseline.runs_d
            (run_id, created_at, run_name, date_from, date_to, interval_seconds, horizon_hours, chain,
             alerts_total, alerts_ok, config_json, summary_json, slice_path, partitioned)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            run_id,
            created_at,
            run_name,
            config.get("date_from"),
            config.get("date_to"),
            int(config.get("interval_seconds", 60)),
            int(config.get("horizon_hours", 48)),
            config.get("chain"),
            int(summary.get("alerts_total", 0)),
            int(summary.get("alerts_ok", 0)),
            json.dumps(config, separators=(",", ":"), sort_keys=True),
            json.dumps(summary, separators=(",", ":"), sort_keys=True),
            slice_path,
            bool(partitioned),
        ])

        # Replace existing facts for this run_id (if rerun with same run_id)
        con.execute("DELETE FROM baseline.alert_results_f WHERE run_id = ?", [run_id])
        con.execute("DELETE FROM baseline.caller_stats_f WHERE run_id = ?", [run_id])

        # Build rows with proper datetime conversion
        out_rows = []
        for r in rows:
            alert_ts = parse_utc_ts(r.get("alert_ts_utc", ""))
            entry_ts = parse_utc_ts(r.get("entry_ts_utc", ""))
            # Remove tzinfo for DuckDB
            alert_ts_naive = alert_ts.replace(tzinfo=None) if alert_ts else None
            entry_ts_naive = entry_ts.replace(tzinfo=None) if entry_ts else None

            out_rows.append((
                run_id,
                int(r.get("alert_id", 0)),
                r.get("mint"),
                r.get("caller"),
                alert_ts_naive,
                entry_ts_naive,
                r.get("status"),
                int(r.get("candles") or 0),
                r.get("entry_price"),
                r.get("ath_mult"),
                r.get("time_to_ath_s"),
                r.get("time_to_2x_s"),
                r.get("time_to_3x_s"),
                r.get("time_to_4x_s"),
                r.get("time_to_5x_s"),
                r.get("time_to_10x_s"),
                r.get("dd_initial"),
                r.get("dd_overall"),
                r.get("dd_pre2x"),
                r.get("dd_after_2x"),
                r.get("dd_after_3x"),
                r.get("dd_after_4x"),
                r.get("dd_after_5x"),
                r.get("dd_after_10x"),
                r.get("dd_after_ath"),
                r.get("peak_pnl_pct"),
                r.get("ret_end_pct"),
            ))

        # Use executemany for speed
        con.executemany("""
            INSERT INTO baseline.alert_results_f VALUES (
                ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
            )
        """, out_rows)

        caller_rows = []
        for c in caller_agg:
            caller_rows.append((
                run_id,
                c.get("caller"),
                int(c.get("n") or 0),
                c.get("median_ath"),
                c.get("p25_ath"),
                c.get("p75_ath"),
                c.get("p95_ath"),
                c.get("hit2x_pct"),
                c.get("hit3x_pct"),
                c.get("hit4x_pct"),
                c.get("hit5x_pct"),
                c.get("hit10x_pct"),
                c.get("median_t2x_hrs"),
                c.get("median_dd_initial_pct"),
                c.get("median_dd_overall_pct"),
                c.get("median_dd_pre2x_pct"),
                c.get("median_dd_pre2x_or_horizon_pct"),
                c.get("median_dd_after_2x_pct"),
                c.get("median_dd_after_3x_pct"),
                c.get("median_dd_after_ath_pct"),
                c.get("worst_dd_pct"),
                c.get("median_peak_pnl_pct"),
                c.get("median_ret_end_pct"),
            ))

        con.executemany("""
            INSERT INTO baseline.caller_stats_f VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, caller_rows)

        con.execute("COMMIT;")
    except Exception:
        con.execute("ROLLBACK;")
        raise
    finally:
        con.close()


# =============================================================================
# TP/SL Schema (bt.*)
# =============================================================================

def ensure_bt_schema(con: duckdb.DuckDBPyConnection) -> None:
    """Create bt schema and tables if they don't exist."""
    con.execute("CREATE SCHEMA IF NOT EXISTS bt;")

    # Use TEXT for run_id instead of UUID to avoid fragility
    con.execute("""
        CREATE TABLE IF NOT EXISTS bt.runs_d (
            run_id TEXT PRIMARY KEY,
            created_at TIMESTAMP,
            run_name VARCHAR,
            strategy_name VARCHAR,
            strategy_version VARCHAR,
            candle_interval_s INTEGER,
            window_from_ts_ms BIGINT,
            window_to_ts_ms BIGINT,
            entry_rule VARCHAR,
            exit_rule VARCHAR,
            config_json TEXT,
            notes VARCHAR
        )
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS bt.alert_scenarios_d (
            scenario_id TEXT PRIMARY KEY,
            created_at TIMESTAMP,
            run_id TEXT,
            alert_id BIGINT,
            mint VARCHAR,
            alert_ts_ms BIGINT,
            entry_ts_ms BIGINT,
            end_ts_ms BIGINT,
            interval_seconds INTEGER,
            eval_window_s INTEGER,
            caller_name VARCHAR,
            scenario_json TEXT
        )
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS bt.alert_outcomes_f (
            scenario_id TEXT PRIMARY KEY,
            computed_at TIMESTAMP,
            entry_price_usd DOUBLE,
            entry_ts_ms BIGINT,
            ath_multiple DOUBLE,
            time_to_2x_s INTEGER,
            time_to_3x_s INTEGER,
            time_to_4x_s INTEGER,
            max_drawdown_pct DOUBLE,
            hit_2x BOOLEAN,
            candles_seen INTEGER,
            tp_sl_exit_reason VARCHAR,
            tp_sl_ret DOUBLE,
            details_json TEXT
        )
    """)

    con.execute("""
        CREATE TABLE IF NOT EXISTS bt.metrics_f (
            run_id TEXT,
            metric_name VARCHAR,
            metric_value DOUBLE,
            computed_at TIMESTAMP
        )
    """)


def store_tp_sl_run(
    duckdb_path: str,
    run_id: str,
    run_name: str,
    config: Dict[str, Any],
    rows: List[Dict[str, Any]],
    summary: Dict[str, Any],
) -> None:
    """
    Store a TP/SL backtest run to DuckDB.

    Args:
        duckdb_path: Path to DuckDB file
        run_id: Unique run identifier
        run_name: Human-readable run name
        config: Run configuration dict
        rows: Per-alert results
        summary: Overall summary metrics
    """
    con = duckdb.connect(duckdb_path)
    try:
        con.execute("BEGIN;")
        ensure_bt_schema(con)

        created_at = datetime.now(tz=UTC).replace(tzinfo=None)
        date_from = config.get("date_from")
        date_to = config.get("date_to")

        # Convert dates to timestamps
        window_from_ms = None
        window_to_ms = None
        if date_from:
            from .helpers import parse_yyyy_mm_dd
            window_from_ms = int(parse_yyyy_mm_dd(date_from).timestamp() * 1000)
        if date_to:
            from .helpers import parse_yyyy_mm_dd
            window_to_ms = int(parse_yyyy_mm_dd(date_to).timestamp() * 1000)

        con.execute("""
            INSERT OR REPLACE INTO bt.runs_d (
                run_id, created_at, run_name, strategy_name, strategy_version,
                candle_interval_s, window_from_ts_ms, window_to_ts_ms,
                entry_rule, exit_rule, config_json, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, [
            run_id,
            created_at,
            run_name,
            "tp_sl_fast",
            "1.0",
            int(config.get("interval_seconds", 60)),
            window_from_ms,
            window_to_ms,
            f"tp={config.get('tp_mult', 2.0)}x",
            f"sl={config.get('sl_mult', 0.5)}x",
            json.dumps(config, separators=(",", ":"), sort_keys=True),
            f"TP/SL backtest: {date_from} to {date_to}",
        ])

        horizon_hours = int(config.get("horizon_hours", 48))
        eval_window_s = horizon_hours * 3600

        # Delete existing data for this run
        con.execute("DELETE FROM bt.alert_scenarios_d WHERE run_id = ?", [run_id])
        con.execute("DELETE FROM bt.alert_outcomes_f WHERE scenario_id IN (SELECT scenario_id FROM bt.alert_scenarios_d WHERE run_id = ?)", [run_id])
        con.execute("DELETE FROM bt.metrics_f WHERE run_id = ?", [run_id])

        # Insert scenarios and outcomes
        scenario_rows = []
        outcome_rows = []

        for r in rows:
            scenario_id = str(uuid.uuid4())

            # Reconstruct ms from strings
            alert_ts_utc = r.get("alert_ts_utc") or ""
            entry_ts_utc = r.get("entry_ts_utc") or ""

            alert_ts = parse_utc_ts(alert_ts_utc)
            entry_ts = parse_utc_ts(entry_ts_utc)
            alert_ts_ms = int(alert_ts.timestamp() * 1000) if alert_ts.year > 1970 else 0
            entry_ts_ms = int(entry_ts.timestamp() * 1000) if entry_ts.year > 1970 else 0
            end_ts_ms = entry_ts_ms + eval_window_s * 1000 if entry_ts_ms else 0

            alert_id = int(r.get("alert_id") or 0)

            scenario_rows.append((
                scenario_id,
                created_at,
                run_id,
                alert_id,
                r.get("mint") or "",
                alert_ts_ms,
                entry_ts_ms,
                end_ts_ms,
                int(r.get("interval_seconds") or config.get("interval_seconds", 60)),
                eval_window_s,
                (r.get("caller") or "").strip(),
                json.dumps(r, separators=(",", ":"), default=str),
            ))

            if r.get("status") == "ok":
                dd_overall = r.get("dd_overall")
                max_dd_pct = (float(dd_overall) * 100.0) if dd_overall is not None else None

                details = {
                    "peak_pnl_pct": r.get("peak_pnl_pct"),
                    "ret_end": r.get("ret_end"),
                    "dd_initial": r.get("dd_initial"),
                    "dd_pre2x": r.get("dd_pre2x"),
                    "dd_after_2x": r.get("dd_after_2x"),
                    "dd_after_3x": r.get("dd_after_3x"),
                    "dd_after_4x": r.get("dd_after_4x"),
                    "dd_after_ath": r.get("dd_after_ath"),
                }

                outcome_rows.append((
                    scenario_id,
                    created_at,
                    float(r.get("entry_price") or 0.0),
                    entry_ts_ms,
                    float(r.get("ath_mult") or 0.0),
                    int(r["time_to_2x_s"]) if r.get("time_to_2x_s") is not None else None,
                    int(r["time_to_3x_s"]) if r.get("time_to_3x_s") is not None else None,
                    int(r["time_to_4x_s"]) if r.get("time_to_4x_s") is not None else None,
                    max_dd_pct,
                    (r.get("time_to_2x_s") is not None),
                    int(r.get("candles") or 0),
                    r.get("tp_sl_exit_reason"),
                    r.get("tp_sl_ret"),
                    json.dumps(details, separators=(",", ":"), default=str),
                ))

        con.executemany("""
            INSERT INTO bt.alert_scenarios_d (
                scenario_id, created_at, run_id, alert_id, mint, alert_ts_ms, entry_ts_ms, end_ts_ms,
                interval_seconds, eval_window_s, caller_name, scenario_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, scenario_rows)

        con.executemany("""
            INSERT INTO bt.alert_outcomes_f (
                scenario_id, computed_at, entry_price_usd, entry_ts_ms, ath_multiple,
                time_to_2x_s, time_to_3x_s, time_to_4x_s,
                max_drawdown_pct, hit_2x, candles_seen, tp_sl_exit_reason, tp_sl_ret, details_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, outcome_rows)

        # Insert metrics
        metric_pairs = [
            ("alerts_total", summary.get("alerts_total")),
            ("alerts_ok", summary.get("alerts_ok")),
            ("alerts_missing", summary.get("alerts_missing")),
            ("median_ath_mult", summary.get("median_ath_mult")),
            ("median_time_to_2x_s", summary.get("median_time_to_2x_s")),
            ("median_time_to_4x_s", summary.get("median_time_to_4x_s")),
            ("median_dd_initial", summary.get("median_dd_initial")),
            ("median_dd_overall", summary.get("median_dd_overall")),
            ("median_peak_pnl_pct", summary.get("median_peak_pnl_pct")),
            ("pct_hit_2x", summary.get("pct_hit_2x")),
            ("pct_hit_4x", summary.get("pct_hit_4x")),
            ("tp_sl_total_return_pct", summary.get("tp_sl_total_return_pct")),
            ("tp_sl_avg_return_pct", summary.get("tp_sl_avg_return_pct")),
            ("tp_sl_win_rate", summary.get("tp_sl_win_rate")),
            ("tp_sl_profit_factor", summary.get("tp_sl_profit_factor")),
            ("tp_sl_expectancy_pct", summary.get("tp_sl_expectancy_pct")),
        ]

        metric_rows = []
        for name, val in metric_pairs:
            if val is None:
                continue
            fv = float(val)
            if math.isnan(fv) or math.isinf(fv):
                continue
            metric_rows.append((run_id, name, fv, created_at))

        con.executemany(
            "INSERT INTO bt.metrics_f(run_id, metric_name, metric_value, computed_at) VALUES (?, ?, ?, ?)",
            metric_rows,
        )

        con.execute("COMMIT;")
    except Exception:
        con.execute("ROLLBACK;")
        raise
    finally:
        con.close()


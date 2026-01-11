"""
Scoring Views - Versioned DuckDB views for caller scoring.

Score logic lives in DuckDB as versioned views:
- baseline.caller_scored_v1
- baseline.caller_scored_v2
- etc.

Runner prints whichever version is set as "current".
This keeps experimentation cheap and history readable.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

import duckdb


# =============================================================================
# View Definitions
# =============================================================================

# View version 1: Simple win-rate * avg-return product
CALLER_SCORED_V1_SQL = """
CREATE OR REPLACE VIEW baseline.caller_scored_v1 AS
WITH caller_stats AS (
    SELECT
        caller,
        COUNT(*) AS n_trades,
        
        -- Win rate
        SUM(CASE WHEN net_return > 0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS win_rate,
        
        -- Returns
        AVG(net_return) AS avg_return,
        SUM(net_return) AS total_return,
        MEDIAN(net_return) AS median_return,
        
        -- Avg win/loss
        AVG(CASE WHEN net_return > 0 THEN net_return END) AS avg_win,
        AVG(CASE WHEN net_return <= 0 THEN net_return END) AS avg_loss,
        
        -- Peak multiples
        AVG(peak_mult) AS avg_peak,
        SUM(CASE WHEN peak_mult >= 2.0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS hit_2x_rate,
        SUM(CASE WHEN peak_mult >= 3.0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS hit_3x_rate,
        
        -- Profit factor
        CASE 
            WHEN ABS(SUM(CASE WHEN net_return < 0 THEN net_return ELSE 0 END)) < 0.0001 THEN 999.99
            ELSE SUM(CASE WHEN net_return > 0 THEN net_return ELSE 0 END) / 
                 ABS(SUM(CASE WHEN net_return < 0 THEN net_return ELSE 0 END))
        END AS profit_factor
        
    FROM baseline.trades_d
    GROUP BY caller
)
SELECT
    *,
    -- v1 score: simple win_rate * (1 + avg_return)
    win_rate * (1 + avg_return) AS score
FROM caller_stats
ORDER BY score DESC;
"""

# View version 2: Expectancy-based with profit factor bonus
CALLER_SCORED_V2_SQL = """
CREATE OR REPLACE VIEW baseline.caller_scored_v2 AS
WITH caller_stats AS (
    SELECT
        caller,
        COUNT(*) AS n_trades,
        
        -- Win rate
        SUM(CASE WHEN net_return > 0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS win_rate,
        
        -- Returns
        AVG(net_return) AS avg_return,
        SUM(net_return) AS total_return,
        MEDIAN(net_return) AS median_return,
        STDDEV(net_return) AS stddev_return,
        
        -- Avg win/loss
        AVG(CASE WHEN net_return > 0 THEN net_return END) AS avg_win,
        AVG(CASE WHEN net_return <= 0 THEN net_return END) AS avg_loss,
        
        -- Peak multiples
        AVG(peak_mult) AS avg_peak,
        SUM(CASE WHEN peak_mult >= 2.0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS hit_2x_rate,
        SUM(CASE WHEN peak_mult >= 3.0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS hit_3x_rate,
        SUM(CASE WHEN peak_mult >= 4.0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS hit_4x_rate,
        
        -- Profit factor
        CASE 
            WHEN ABS(SUM(CASE WHEN net_return < 0 THEN net_return ELSE 0 END)) < 0.0001 THEN 999.99
            ELSE SUM(CASE WHEN net_return > 0 THEN net_return ELSE 0 END) / 
                 ABS(SUM(CASE WHEN net_return < 0 THEN net_return ELSE 0 END))
        END AS profit_factor,
        
        -- Expectancy
        (SUM(CASE WHEN net_return > 0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*)) 
            * COALESCE(AVG(CASE WHEN net_return > 0 THEN net_return END), 0)
        + (1 - SUM(CASE WHEN net_return > 0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*))
            * COALESCE(AVG(CASE WHEN net_return <= 0 THEN net_return END), 0)
        AS expectancy
        
    FROM baseline.trades_d
    GROUP BY caller
)
SELECT
    *,
    -- Sharpe approximation
    CASE WHEN stddev_return > 0.001 THEN avg_return / stddev_return ELSE 0 END AS sharpe_approx,
    -- v2 score: expectancy * min(pf, 5) * log(n+1) for significance
    CASE 
        WHEN n_trades < 10 THEN 0  -- Not enough data
        ELSE expectancy * LEAST(profit_factor, 5.0) * LN(n_trades + 1)
    END AS score
FROM caller_stats
ORDER BY score DESC;
"""

# View version 3: Risk-adjusted with drawdown penalty
CALLER_SCORED_V3_SQL = """
CREATE OR REPLACE VIEW baseline.caller_scored_v3 AS
WITH caller_stats AS (
    SELECT
        caller,
        COUNT(*) AS n_trades,
        
        -- Win rate
        SUM(CASE WHEN net_return > 0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS win_rate,
        
        -- Returns
        AVG(net_return) AS avg_return,
        SUM(net_return) AS total_return,
        MEDIAN(net_return) AS median_return,
        STDDEV(net_return) AS stddev_return,
        
        -- Avg win/loss
        AVG(CASE WHEN net_return > 0 THEN net_return END) AS avg_win,
        AVG(CASE WHEN net_return <= 0 THEN net_return END) AS avg_loss,
        
        -- Peak multiples
        AVG(peak_mult) AS avg_peak,
        SUM(CASE WHEN peak_mult >= 2.0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS hit_2x_rate,
        SUM(CASE WHEN peak_mult >= 3.0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS hit_3x_rate,
        SUM(CASE WHEN peak_mult >= 4.0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS hit_4x_rate,
        
        -- Drawdown metrics (if available)
        AVG(COALESCE(dd_pre2x_or_horizon, dd_max, 0.5)) AS avg_dd,
        MAX(COALESCE(dd_max, 0.5)) AS max_dd,
        
        -- Profit factor
        CASE 
            WHEN ABS(SUM(CASE WHEN net_return < 0 THEN net_return ELSE 0 END)) < 0.0001 THEN 999.99
            ELSE SUM(CASE WHEN net_return > 0 THEN net_return ELSE 0 END) / 
                 ABS(SUM(CASE WHEN net_return < 0 THEN net_return ELSE 0 END))
        END AS profit_factor,
        
        -- Expectancy
        (SUM(CASE WHEN net_return > 0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*)) 
            * COALESCE(AVG(CASE WHEN net_return > 0 THEN net_return END), 0)
        + (1 - SUM(CASE WHEN net_return > 0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*))
            * COALESCE(AVG(CASE WHEN net_return <= 0 THEN net_return END), 0)
        AS expectancy
        
    FROM baseline.trades_d
    GROUP BY caller
)
SELECT
    *,
    -- Sharpe approximation
    CASE WHEN stddev_return > 0.001 THEN avg_return / stddev_return ELSE 0 END AS sharpe_approx,
    -- v3 score: expectancy * pf * (1 - avg_dd) * log(n+1)
    CASE 
        WHEN n_trades < 10 THEN 0  -- Not enough data
        ELSE (
            expectancy 
            * LEAST(profit_factor, 5.0) 
            * (1 - avg_dd)  -- DD penalty
            * LN(n_trades + 1)
        )
    END AS score
FROM caller_stats
ORDER BY score DESC;
"""


# View version 4: R-multiple based scoring (portfolio-adjusted)
CALLER_SCORED_V4_SQL = """
CREATE OR REPLACE VIEW baseline.caller_scored_v4 AS
WITH caller_stats AS (
    SELECT
        caller,
        COUNT(*) AS n_trades,
        
        -- Win rate (based on R-multiple > 0)
        SUM(CASE WHEN COALESCE(r_multiple, 0) > 0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS win_rate,
        
        -- R-multiple stats
        SUM(COALESCE(r_multiple, 0)) AS total_r,
        AVG(COALESCE(r_multiple, 0)) AS avg_r,
        MEDIAN(COALESCE(r_multiple, 0)) AS median_r,
        STDDEV(COALESCE(r_multiple, 0)) AS stddev_r,
        
        -- Avg winner/loser in R
        AVG(CASE WHEN r_multiple > 0 THEN r_multiple END) AS avg_winner_r,
        AVG(CASE WHEN r_multiple <= 0 THEN r_multiple END) AS avg_loser_r,
        
        -- Portfolio PnL stats
        SUM(COALESCE(portfolio_pnl_pct, 0)) AS total_portfolio_pnl_pct,
        AVG(COALESCE(portfolio_pnl_pct, 0)) AS avg_portfolio_pnl_pct,
        
        -- Traditional token returns (for comparison)
        AVG(net_return) AS avg_token_return,
        SUM(net_return) AS total_token_return,
        
        -- Peak multiples
        AVG(peak_mult) AS avg_peak,
        SUM(CASE WHEN peak_mult >= 2.0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS hit_2x_rate,
        SUM(CASE WHEN peak_mult >= 3.0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS hit_3x_rate,
        
        -- Position sizing stats
        AVG(position_pct) AS avg_position_pct,
        
        -- Profit factor in R terms
        CASE 
            WHEN ABS(SUM(CASE WHEN r_multiple < 0 THEN r_multiple ELSE 0 END)) < 0.0001 THEN 999.99
            ELSE SUM(CASE WHEN r_multiple > 0 THEN r_multiple ELSE 0 END) / 
                 ABS(SUM(CASE WHEN r_multiple < 0 THEN r_multiple ELSE 0 END))
        END AS profit_factor_r,
        
        -- Expectancy in R
        AVG(COALESCE(r_multiple, 0)) AS expectancy_r
        
    FROM baseline.trades_d
    GROUP BY caller
)
SELECT
    *,
    -- Sharpe-like ratio in R terms
    CASE WHEN stddev_r > 0.001 THEN avg_r / stddev_r ELSE 0 END AS sharpe_r,
    -- v4 score: expectancy_r * profit_factor_r * log(n+1)
    CASE 
        WHEN n_trades < 10 THEN 0
        ELSE expectancy_r * LEAST(profit_factor_r, 5.0) * LN(n_trades + 1)
    END AS score
FROM caller_stats
ORDER BY score DESC;
"""


VIEW_DEFINITIONS: Dict[str, str] = {
    "v1": CALLER_SCORED_V1_SQL,
    "v2": CALLER_SCORED_V2_SQL,
    "v3": CALLER_SCORED_V3_SQL,
    "v4": CALLER_SCORED_V4_SQL,
}

# Default/current version
CURRENT_SCORE_VERSION = "v4"


# =============================================================================
# Schema and View Management
# =============================================================================

def ensure_baseline_trades_schema(con: duckdb.DuckDBPyConnection) -> None:
    """
    Create the baseline schema with trades_d table.
    
    This is the source table for all scoring views.
    """
    con.execute("CREATE SCHEMA IF NOT EXISTS baseline;")
    
    # Trades table - one row per trade
    con.execute("""
        CREATE TABLE IF NOT EXISTS baseline.trades_d (
            -- Identity
            trade_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            alert_id TEXT NOT NULL,
            
            -- Caller info
            caller TEXT NOT NULL,
            token_address TEXT NOT NULL,
            
            -- Entry mode
            entry_mode TEXT DEFAULT 'immediate',
            
            -- Timestamps
            alert_timestamp_ms BIGINT NOT NULL,
            entry_timestamp_ms BIGINT NOT NULL,
            exit_timestamp_ms BIGINT,
            
            -- Prices
            entry_price DOUBLE NOT NULL,
            stop_price DOUBLE,
            exit_price DOUBLE,
            
            -- Path metrics (raw)
            peak_mult DOUBLE,
            trough_mult DOUBLE,
            final_mult DOUBLE,
            
            -- Drawdown metrics
            dd_initial DOUBLE,
            dd_max DOUBLE,
            dd_pre2x DOUBLE,
            dd_pre2x_or_horizon DOUBLE,
            
            -- Time metrics
            time_to_peak_ms BIGINT,
            time_to_2x_ms BIGINT,
            time_to_3x_ms BIGINT,
            
            -- Strategy results
            exit_reason TEXT,
            gross_return DOUBLE,
            net_return DOUBLE,
            
            -- Risk sizing (minimum viable truth)
            stop_pct DOUBLE,                    -- d = (entry - stop) / entry
            position_pct DOUBLE,                -- 0.02 / d, capped
            planned_risk_pct DOUBLE,            -- should be ~2% unless capped
            realized_loss_pct DOUBLE,           -- actual loss if stop hit + gap/slip
            
            -- Portfolio returns
            portfolio_pnl_pct DOUBLE,           -- position_pct * token_return
            r_multiple DOUBLE,                  -- portfolio_pnl_pct / 0.02
            
            -- Flags
            hit_2x BOOLEAN,
            hit_3x BOOLEAN,
            hit_4x BOOLEAN,
            is_win BOOLEAN
        );
    """)
    
    # Index on caller for aggregations
    con.execute("""
        CREATE INDEX IF NOT EXISTS trades_caller_idx 
        ON baseline.trades_d(caller);
    """)
    
    # Index on run_id for filtering
    con.execute("""
        CREATE INDEX IF NOT EXISTS trades_run_idx 
        ON baseline.trades_d(run_id);
    """)


def create_scoring_views(
    con: duckdb.DuckDBPyConnection,
    versions: Optional[List[str]] = None,
) -> List[str]:
    """
    Create scoring views in DuckDB.
    
    Args:
        con: DuckDB connection
        versions: List of versions to create (default: all)
        
    Returns:
        List of created view names
    """
    ensure_baseline_trades_schema(con)
    
    if versions is None:
        versions = list(VIEW_DEFINITIONS.keys())
    
    created = []
    for version in versions:
        if version not in VIEW_DEFINITIONS:
            print(f"Warning: Unknown score version '{version}', skipping")
            continue
        
        sql = VIEW_DEFINITIONS[version]
        con.execute(sql)
        created.append(f"baseline.caller_scored_{version}")
    
    return created


def get_caller_leaderboard(
    con: duckdb.DuckDBPyConnection,
    version: str = CURRENT_SCORE_VERSION,
    min_trades: int = 10,
    limit: int = 50,
    run_id: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Get caller leaderboard from a scoring view.
    
    Args:
        con: DuckDB connection
        version: Score version (v1, v2, v3)
        min_trades: Minimum trades to be included
        limit: Max number of callers to return
        run_id: If set, filter to trades from this run only
        
    Returns:
        List of caller dicts with scores and stats
    """
    view_name = f"baseline.caller_scored_{version}"
    
    # Check if view exists
    try:
        con.execute(f"SELECT 1 FROM {view_name} LIMIT 1")
    except duckdb.CatalogException:
        # View doesn't exist, try to create it
        create_scoring_views(con, [version])
    
    # If filtering by run_id, we need to use a modified query
    if run_id:
        sql = f"""
            WITH filtered_trades AS (
                SELECT * FROM baseline.trades_d WHERE run_id = '{run_id}'
            ),
            caller_stats AS (
                SELECT
                    caller,
                    COUNT(*) AS n_trades,
                    SUM(CASE WHEN net_return > 0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS win_rate,
                    AVG(net_return) AS avg_return,
                    SUM(net_return) AS total_return,
                    MEDIAN(net_return) AS median_return,
                    AVG(CASE WHEN net_return > 0 THEN net_return END) AS avg_win,
                    AVG(CASE WHEN net_return <= 0 THEN net_return END) AS avg_loss,
                    AVG(peak_mult) AS avg_peak,
                    SUM(CASE WHEN peak_mult >= 2.0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*) AS hit_2x_rate,
                    CASE 
                        WHEN ABS(SUM(CASE WHEN net_return < 0 THEN net_return ELSE 0 END)) < 0.0001 THEN 999.99
                        ELSE SUM(CASE WHEN net_return > 0 THEN net_return ELSE 0 END) / 
                             ABS(SUM(CASE WHEN net_return < 0 THEN net_return ELSE 0 END))
                    END AS profit_factor,
                    (SUM(CASE WHEN net_return > 0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*)) 
                        * COALESCE(AVG(CASE WHEN net_return > 0 THEN net_return END), 0)
                    + (1 - SUM(CASE WHEN net_return > 0 THEN 1 ELSE 0 END)::DOUBLE / COUNT(*))
                        * COALESCE(AVG(CASE WHEN net_return <= 0 THEN net_return END), 0)
                    AS expectancy
                FROM filtered_trades
                GROUP BY caller
            )
            SELECT
                *,
                CASE 
                    WHEN n_trades < 10 THEN 0
                    ELSE expectancy * LEAST(profit_factor, 5.0) * LN(n_trades + 1)
                END AS score
            FROM caller_stats
            WHERE n_trades >= {min_trades}
            ORDER BY score DESC
            LIMIT {limit}
        """
    else:
        sql = f"""
            SELECT * FROM {view_name}
            WHERE n_trades >= {min_trades}
            ORDER BY score DESC
            LIMIT {limit}
        """
    
    result = con.execute(sql).fetchall()
    cols = [d[0] for d in con.description]
    
    return [dict(zip(cols, row)) for row in result]


def _parse_ts_to_ms(val: Any) -> Optional[int]:
    """Convert a timestamp value to milliseconds."""
    if val is None:
        return None
    if isinstance(val, (int, float)):
        # Already numeric - assume ms if > 1e12, else seconds
        if val > 1e12:
            return int(val)
        return int(val * 1000)
    if isinstance(val, str):
        # Try parsing as ISO datetime
        try:
            from datetime import datetime, timezone
            # Handle formats like '2025-05-01 01:07:15'
            for fmt in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ"]:
                try:
                    dt = datetime.strptime(val, fmt).replace(tzinfo=timezone.utc)
                    return int(dt.timestamp() * 1000)
                except ValueError:
                    continue
        except Exception:
            pass
    return None


def insert_trades_from_results(
    con: duckdb.DuckDBPyConnection,
    run_id: str,
    results: List[Dict[str, Any]],
    entry_mode: str = "immediate",
) -> int:
    """
    Insert trade results into baseline.trades_d.
    
    Results should be enriched with risk fields from enrich_results_with_risk().
    
    Args:
        con: DuckDB connection
        run_id: Run ID these trades belong to
        results: List of trade result dicts (enriched with risk fields)
        entry_mode: Entry mode used
        
    Returns:
        Number of rows inserted
    """
    ensure_baseline_trades_schema(con)
    
    import uuid
    
    rows_inserted = 0
    for r in results:
        trade_id = uuid.uuid4().hex
        
        # Skip trades without status=ok
        if r.get("status") and r.get("status") != "ok":
            continue
        
        # Extract values with defaults
        caller = r.get("caller") or r.get("caller_name") or "unknown"
        token = r.get("token_address") or r.get("mint") or "unknown"
        
        # Parse timestamps
        alert_ts_ms = _parse_ts_to_ms(
            r.get("alert_timestamp_ms") or r.get("alert_ts_utc") or r.get("alert_ts")
        )
        entry_ts_ms = _parse_ts_to_ms(
            r.get("entry_timestamp_ms") or r.get("entry_ts_utc") or r.get("entry_ts")
        ) or alert_ts_ms
        exit_ts_ms = _parse_ts_to_ms(
            r.get("exit_timestamp_ms") or r.get("exit_ts")
        )
        
        # Skip if no timestamp
        if alert_ts_ms is None:
            continue
        
        # Determine net_return (token return)
        net_return = r.get("net_return") or r.get("tp_sl_ret") or r.get("gross_return") or 0.0
        gross_return = r.get("gross_return") or net_return
        
        # Exit info
        exit_reason = r.get("exit_reason") or r.get("tp_sl_exit_reason") or r.get("exit_type") or "horizon"
        
        # Path metrics - ath_mult maps to peak_mult
        peak_mult = r.get("peak_mult") or r.get("ath_mult") or r.get("peak_multiple") or r.get("max_mult")
        trough_mult = r.get("trough_mult") or r.get("min_mult")
        
        # Time metrics - convert seconds to ms
        time_to_peak_s = r.get("time_to_ath_s") or r.get("time_to_peak_s")
        time_to_2x_s = r.get("time_to_2x_s")
        time_to_3x_s = r.get("time_to_3x_s")
        
        time_to_peak_ms = int(time_to_peak_s * 1000) if time_to_peak_s else None
        time_to_2x_ms = int(time_to_2x_s * 1000) if time_to_2x_s else None
        time_to_3x_ms = int(time_to_3x_s * 1000) if time_to_3x_s else None
        
        # Get entry price and compute stop price
        entry_price = r.get("entry_price") or r.get("first_price") or 1.0
        stop_pct = r.get("stop_distance") or r.get("stop_pct")
        stop_price = entry_price * (1 - stop_pct) if stop_pct else None
        
        # Risk fields (from enrich_results_with_risk)
        position_pct = r.get("position_pct")
        planned_risk_pct = r.get("planned_risk_pct")
        portfolio_pnl_pct = r.get("portfolio_pnl_pct")
        r_multiple = r.get("r_multiple")
        
        try:
            con.execute("""
                INSERT INTO baseline.trades_d (
                    trade_id, run_id, alert_id, caller, token_address,
                    entry_mode,
                    alert_timestamp_ms, entry_timestamp_ms, exit_timestamp_ms,
                    entry_price, stop_price, exit_price,
                    peak_mult, trough_mult, final_mult,
                    dd_initial, dd_max, dd_pre2x, dd_pre2x_or_horizon,
                    time_to_peak_ms, time_to_2x_ms, time_to_3x_ms,
                    exit_reason, gross_return, net_return,
                    stop_pct, position_pct, planned_risk_pct, realized_loss_pct,
                    portfolio_pnl_pct, r_multiple,
                    hit_2x, hit_3x, hit_4x, is_win
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, [
                trade_id,
                run_id,
                str(r.get("alert_id") or r.get("id") or trade_id),
                caller,
                token,
                entry_mode,
                alert_ts_ms,
                entry_ts_ms,
                exit_ts_ms,
                entry_price,
                stop_price,
                r.get("exit_price") or r.get("exit_px"),
                peak_mult,
                trough_mult,
                r.get("final_mult") or r.get("ret_end"),
                r.get("dd_initial"),
                r.get("dd_max") or r.get("dd_overall"),
                r.get("dd_pre2x"),
                r.get("dd_pre2x_or_horizon") or r.get("dd_pre2x") or r.get("dd_overall"),
                time_to_peak_ms,
                time_to_2x_ms,
                time_to_3x_ms,
                exit_reason,
                gross_return,
                net_return,
                stop_pct,
                position_pct,
                planned_risk_pct,
                r.get("realized_loss_pct"),
                portfolio_pnl_pct,
                r_multiple,
                r.get("hit_2x") or (time_to_2x_s is not None),
                r.get("hit_3x") or (time_to_3x_s is not None),
                r.get("hit_4x") or (r.get("time_to_4x_s") is not None),
                net_return > 0,
            ])
            rows_inserted += 1
        except Exception as e:
            print(f"Warning: Failed to insert trade: {e}")
    
    return rows_inserted


def print_leaderboard(
    leaderboard: List[Dict[str, Any]],
    score_version: str,
    show_raw: bool = True,
    show_scored: bool = True,
) -> None:
    """Pretty-print a caller leaderboard."""
    if not leaderboard:
        print("No callers meet the minimum trade threshold.")
        return
    
    print()
    
    if show_raw:
        print("=" * 90)
        print("LEADERBOARD (RAW STATS)")
        print("=" * 90)
        print(f"{'Rank':<5} {'Caller':<25} {'N':<6} {'Win%':<7} {'AvgRet':<9} {'TotRet':<10} {'PF':<6}")
        print("-" * 90)
        
        # Sort by total_return for raw view
        raw_sorted = sorted(leaderboard, key=lambda x: x.get("total_return", 0), reverse=True)
        for i, row in enumerate(raw_sorted, 1):
            caller = str(row["caller"])[:24]
            n = row.get("n_trades", 0)
            wr = row.get("win_rate", 0) * 100
            avg_ret = row.get("avg_return", 0) * 100
            tot_ret = row.get("total_return", 0) * 100
            pf = row.get("profit_factor", 0)
            print(f"{i:<5} {caller:<25} {n:<6} {wr:>5.1f}% {avg_ret:>7.2f}% {tot_ret:>8.1f}% {pf:>5.2f}")
        print()
    
    if show_scored:
        print("=" * 90)
        print(f"LEADERBOARD (SCORED - {score_version})")
        print("=" * 90)
        print(f"{'Rank':<5} {'Caller':<25} {'Score':<10} {'N':<6} {'Win%':<7} {'Expect':<8} {'PF':<6}")
        print("-" * 90)
        
        for i, row in enumerate(leaderboard, 1):
            caller = str(row["caller"])[:24]
            score = row.get("score", 0)
            n = row.get("n_trades", 0)
            wr = row.get("win_rate", 0) * 100
            exp = row.get("expectancy", 0) * 100
            pf = row.get("profit_factor", 0)
            print(f"{i:<5} {caller:<25} {score:>8.4f} {n:<6} {wr:>5.1f}% {exp:>6.2f}% {pf:>5.2f}")
        print()


# =============================================================================
# CLI entry point for viewing metrics docs
# =============================================================================

if __name__ == "__main__":
    print("Scoring Views Module")
    print("=" * 50)
    print(f"Available versions: {list(VIEW_DEFINITIONS.keys())}")
    print(f"Current default: {CURRENT_SCORE_VERSION}")


#!/usr/bin/env python3
"""
Query helpers for backtest analytics.

Provides functions to query the bt.* schema in DuckDB for:
- Run listing and filtering
- Per-alert outcomes
- Caller performance aggregation
- Run comparison

Usage:
  # List all runs
  python backtest_queries.py list-runs --duckdb data/alerts.duckdb

  # Get outcomes for a specific run
  python backtest_queries.py get-outcomes --duckdb data/alerts.duckdb --run-id <uuid>

  # Get caller performance across runs
  python backtest_queries.py caller-performance --duckdb data/alerts.duckdb --caller "Crypto Alpha"
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import duckdb

UTC = timezone.utc


def get_runs_by_date_range(
    duckdb_path: str,
    from_date: Optional[str] = None,
    to_date: Optional[str] = None,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """
    List backtest runs, optionally filtered by date range.
    
    Returns list of run metadata with summary metrics.
    """
    conn = duckdb.connect(duckdb_path, read_only=True)
    
    try:
        # Check if bt schema exists
        schemas = conn.execute("SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'bt'").fetchall()
        if not schemas:
            return []
        
        # Build query with optional date filters
        where_clauses = []
        params = []
        
        if from_date:
            where_clauses.append("r.created_at >= ?")
            params.append(from_date)
        if to_date:
            where_clauses.append("r.created_at <= ?")
            params.append(to_date)
        
        where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
        
        sql = f"""
        SELECT 
            r.run_id::TEXT as run_id,
            r.created_at,
            r.run_name,
            r.strategy_name,
            r.candle_interval_s,
            r.config_json,
            COUNT(DISTINCT s.scenario_id) as alert_count,
            COUNT(DISTINCT CASE WHEN o.ath_multiple IS NOT NULL THEN s.scenario_id END) as alerts_ok,
            AVG(o.ath_multiple) as avg_ath_multiple,
            AVG(o.max_drawdown_pct) as avg_max_drawdown_pct,
            COUNT(DISTINCT CASE WHEN o.hit_2x THEN s.scenario_id END) as count_hit_2x
        FROM bt.runs_d r
        LEFT JOIN bt.alert_scenarios_d s ON s.run_id = r.run_id
        LEFT JOIN bt.alert_outcomes_f o ON o.scenario_id = s.scenario_id
        {where_sql}
        GROUP BY r.run_id, r.created_at, r.run_name, r.strategy_name, r.candle_interval_s, r.config_json
        ORDER BY r.created_at DESC
        LIMIT ?
        """
        params.append(limit)
        
        rows = conn.execute(sql, params).fetchall()
        columns = ['run_id', 'created_at', 'run_name', 'strategy_name', 'candle_interval_s', 
                   'config_json', 'alert_count', 'alerts_ok', 'avg_ath_multiple', 
                   'avg_max_drawdown_pct', 'count_hit_2x']
        
        results = []
        for row in rows:
            result = dict(zip(columns, row))
            # Convert datetime to ISO string
            if result['created_at']:
                result['created_at'] = result['created_at'].isoformat() if hasattr(result['created_at'], 'isoformat') else str(result['created_at'])
            results.append(result)
        
        return results
        
    finally:
        conn.close()


def get_run_outcomes(
    duckdb_path: str,
    run_id: str,
    caller_filter: Optional[str] = None,
    limit: int = 1000,
) -> List[Dict[str, Any]]:
    """
    Get all alert outcomes for a specific run.
    
    Returns list of per-alert outcomes with path metrics.
    """
    conn = duckdb.connect(duckdb_path, read_only=True)
    
    try:
        where_clauses = ["s.run_id = ?"]
        params = [run_id]
        
        if caller_filter:
            where_clauses.append("s.caller_name ILIKE ?")
            params.append(f"%{caller_filter}%")
        
        where_sql = " AND ".join(where_clauses)
        
        sql = f"""
        SELECT 
            s.scenario_id::TEXT as scenario_id,
            s.mint,
            s.caller_name,
            s.alert_ts_ms,
            o.entry_price_usd,
            o.ath_multiple,
            o.ath_price_usd,
            o.max_drawdown_pct,
            o.hit_2x,
            o.time_to_2x_s,
            o.max_dd_before_2x_pct,
            o.candles_seen,
            o.details_json
        FROM bt.alert_scenarios_d s
        LEFT JOIN bt.alert_outcomes_f o ON o.scenario_id = s.scenario_id
        WHERE {where_sql}
        ORDER BY s.alert_ts_ms DESC
        LIMIT ?
        """
        params.append(limit)
        
        rows = conn.execute(sql, params).fetchall()
        columns = ['scenario_id', 'mint', 'caller_name', 'alert_ts_ms', 'entry_price_usd',
                   'ath_multiple', 'ath_price_usd', 'max_drawdown_pct', 'hit_2x',
                   'time_to_2x_s', 'max_dd_before_2x_pct', 'candles_seen', 'details_json']
        
        results = []
        for row in rows:
            result = dict(zip(columns, row))
            results.append(result)
        
        return results
        
    finally:
        conn.close()


def get_caller_performance(
    duckdb_path: str,
    caller_name: Optional[str] = None,
    min_calls: int = 1,
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """
    Get aggregated caller performance across all runs.
    
    Returns caller statistics including hit rates and average metrics.
    """
    conn = duckdb.connect(duckdb_path, read_only=True)
    
    try:
        where_clauses = ["o.ath_multiple IS NOT NULL"]  # Only count alerts with outcomes
        params = []
        
        if caller_name:
            where_clauses.append("s.caller_name ILIKE ?")
            params.append(f"%{caller_name}%")
        
        where_sql = " AND ".join(where_clauses)
        
        sql = f"""
        SELECT 
            s.caller_name,
            COUNT(*) as total_calls,
            AVG(o.ath_multiple) as avg_ath_multiple,
            AVG(o.max_drawdown_pct) as avg_max_drawdown_pct,
            COUNT(CASE WHEN o.hit_2x THEN 1 END) as count_2x,
            COUNT(CASE WHEN o.ath_multiple >= 3 THEN 1 END) as count_3x,
            COUNT(CASE WHEN o.ath_multiple >= 4 THEN 1 END) as count_4x,
            CAST(COUNT(CASE WHEN o.hit_2x THEN 1 END) AS DOUBLE) / COUNT(*) as hit_rate_2x,
            CAST(COUNT(CASE WHEN o.ath_multiple >= 3 THEN 1 END) AS DOUBLE) / COUNT(*) as hit_rate_3x,
            CAST(COUNT(CASE WHEN o.ath_multiple >= 4 THEN 1 END) AS DOUBLE) / COUNT(*) as hit_rate_4x,
            AVG(o.time_to_2x_s) as avg_time_to_2x_s,
            AVG(o.max_dd_before_2x_pct) as avg_dd_before_2x_pct
        FROM bt.alert_scenarios_d s
        JOIN bt.alert_outcomes_f o ON o.scenario_id = s.scenario_id
        WHERE {where_sql}
        GROUP BY s.caller_name
        HAVING COUNT(*) >= ?
        ORDER BY count_4x DESC, count_3x DESC, count_2x DESC
        LIMIT ?
        """
        params.extend([min_calls, limit])
        
        rows = conn.execute(sql, params).fetchall()
        columns = ['caller_name', 'total_calls', 'avg_ath_multiple', 'avg_max_drawdown_pct',
                   'count_2x', 'count_3x', 'count_4x', 'hit_rate_2x', 'hit_rate_3x', 'hit_rate_4x',
                   'avg_time_to_2x_s', 'avg_dd_before_2x_pct']
        
        results = []
        for row in rows:
            result = dict(zip(columns, row))
            results.append(result)
        
        return results
        
    finally:
        conn.close()


def compare_runs(
    duckdb_path: str,
    run_ids: List[str],
) -> Dict[str, Any]:
    """
    Compare metrics across multiple runs.
    
    Returns side-by-side comparison of run metrics.
    """
    conn = duckdb.connect(duckdb_path, read_only=True)
    
    try:
        comparisons = []
        
        for run_id in run_ids:
            sql = """
            SELECT 
                r.run_id::TEXT as run_id,
                r.run_name,
                r.created_at,
                r.config_json,
                COUNT(DISTINCT s.scenario_id) as alert_count,
                COUNT(DISTINCT CASE WHEN o.ath_multiple IS NOT NULL THEN s.scenario_id END) as alerts_ok,
                AVG(o.ath_multiple) as avg_ath_multiple,
                AVG(o.max_drawdown_pct) as avg_max_drawdown_pct,
                COUNT(DISTINCT CASE WHEN o.hit_2x THEN s.scenario_id END) as count_hit_2x,
                COUNT(DISTINCT CASE WHEN o.ath_multiple >= 3 THEN s.scenario_id END) as count_hit_3x,
                COUNT(DISTINCT CASE WHEN o.ath_multiple >= 4 THEN s.scenario_id END) as count_hit_4x
            FROM bt.runs_d r
            LEFT JOIN bt.alert_scenarios_d s ON s.run_id = r.run_id
            LEFT JOIN bt.alert_outcomes_f o ON o.scenario_id = s.scenario_id
            WHERE r.run_id = ?
            GROUP BY r.run_id, r.run_name, r.created_at, r.config_json
            """
            
            rows = conn.execute(sql, [run_id]).fetchall()
            if rows:
                columns = ['run_id', 'run_name', 'created_at', 'config_json', 'alert_count',
                           'alerts_ok', 'avg_ath_multiple', 'avg_max_drawdown_pct',
                           'count_hit_2x', 'count_hit_3x', 'count_hit_4x']
                result = dict(zip(columns, rows[0]))
                if result['created_at']:
                    result['created_at'] = result['created_at'].isoformat() if hasattr(result['created_at'], 'isoformat') else str(result['created_at'])
                comparisons.append(result)
        
        return {
            "runs_compared": len(comparisons),
            "runs": comparisons,
        }
        
    finally:
        conn.close()


def get_run_metrics(
    duckdb_path: str,
    run_id: str,
) -> List[Dict[str, Any]]:
    """
    Get all metrics for a specific run from bt.metrics_f.
    """
    conn = duckdb.connect(duckdb_path, read_only=True)
    
    try:
        sql = """
        SELECT 
            metric_name,
            metric_value,
            metric_json,
            computed_at
        FROM bt.metrics_f
        WHERE run_id = ?
        ORDER BY metric_name
        """
        
        rows = conn.execute(sql, [run_id]).fetchall()
        columns = ['metric_name', 'metric_value', 'metric_json', 'computed_at']
        
        results = []
        for row in rows:
            result = dict(zip(columns, row))
            if result['computed_at']:
                result['computed_at'] = result['computed_at'].isoformat() if hasattr(result['computed_at'], 'isoformat') else str(result['computed_at'])
            results.append(result)
        
        return results
        
    finally:
        conn.close()


def main():
    ap = argparse.ArgumentParser(description="Query backtest results from DuckDB bt.* schema")
    ap.add_argument("--duckdb", default=os.getenv("DUCKDB_PATH", "data/alerts.duckdb"))
    ap.add_argument("--output-format", choices=["json", "table"], default="json")
    
    subparsers = ap.add_subparsers(dest="command", required=True)
    
    # list-runs command
    list_runs_parser = subparsers.add_parser("list-runs", help="List backtest runs")
    list_runs_parser.add_argument("--from", dest="from_date", help="Start date (YYYY-MM-DD)")
    list_runs_parser.add_argument("--to", dest="to_date", help="End date (YYYY-MM-DD)")
    list_runs_parser.add_argument("--limit", type=int, default=100)
    
    # get-outcomes command
    outcomes_parser = subparsers.add_parser("get-outcomes", help="Get outcomes for a run")
    outcomes_parser.add_argument("--run-id", required=True, help="Run UUID")
    outcomes_parser.add_argument("--caller", help="Filter by caller name")
    outcomes_parser.add_argument("--limit", type=int, default=1000)
    
    # caller-performance command
    caller_parser = subparsers.add_parser("caller-performance", help="Get caller performance stats")
    caller_parser.add_argument("--caller", help="Filter by caller name")
    caller_parser.add_argument("--min-calls", type=int, default=1)
    caller_parser.add_argument("--limit", type=int, default=100)
    
    # compare-runs command
    compare_parser = subparsers.add_parser("compare-runs", help="Compare multiple runs")
    compare_parser.add_argument("--run-ids", required=True, nargs="+", help="Run UUIDs to compare")
    
    # get-metrics command
    metrics_parser = subparsers.add_parser("get-metrics", help="Get metrics for a run")
    metrics_parser.add_argument("--run-id", required=True, help="Run UUID")
    
    args = ap.parse_args()
    
    try:
        if args.command == "list-runs":
            result = get_runs_by_date_range(
                args.duckdb,
                from_date=args.from_date,
                to_date=args.to_date,
                limit=args.limit,
            )
        elif args.command == "get-outcomes":
            result = get_run_outcomes(
                args.duckdb,
                run_id=args.run_id,
                caller_filter=args.caller,
                limit=args.limit,
            )
        elif args.command == "caller-performance":
            result = get_caller_performance(
                args.duckdb,
                caller_name=args.caller,
                min_calls=args.min_calls,
                limit=args.limit,
            )
        elif args.command == "compare-runs":
            result = compare_runs(
                args.duckdb,
                run_ids=args.run_ids,
            )
        elif args.command == "get-metrics":
            result = get_run_metrics(
                args.duckdb,
                run_id=args.run_id,
            )
        else:
            print(f"Unknown command: {args.command}", file=sys.stderr)
            sys.exit(1)
        
        if args.output_format == "json":
            print(json.dumps(result, indent=2, default=str))
        else:
            # Simple table output
            if isinstance(result, list) and result:
                headers = result[0].keys()
                print("\t".join(headers))
                for row in result:
                    print("\t".join(str(row.get(h, "")) for h in headers))
            elif isinstance(result, dict):
                print(json.dumps(result, indent=2, default=str))
            else:
                print("No results found")
                
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()


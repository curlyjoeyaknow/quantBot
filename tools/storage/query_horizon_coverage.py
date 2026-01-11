#!/usr/bin/env python3
"""
Query OHLCV Horizon Coverage Matrix

Query and visualize the stored coverage matrix from DuckDB.

Usage:
    python3 query_horizon_coverage.py --duckdb data/tele.duckdb --interval 1m
    python3 query_horizon_coverage.py --duckdb data/tele.duckdb --interval 5m --month 2025-05
"""

import argparse
import sys
import warnings
from typing import Dict, List, Optional

warnings.filterwarnings('ignore', category=DeprecationWarning)

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb package not installed. Run: pip install duckdb", file=sys.stderr)
    sys.exit(1)


HORIZONS = [-4, 0, 4, 12, 24, 48, 72, 144, 288]


def get_duckdb_connection(db_path: str) -> duckdb.DuckDBPyConnection:
    """
    Get DuckDB connection.
    
    DEPRECATED: Use get_readonly_connection() from tools.shared.duckdb_adapter instead.
    This function is kept for backward compatibility but now uses the adapter internally.
    """
    from tools.shared.duckdb_adapter import get_readonly_connection
    # Use adapter which handles empty/invalid files and sets busy_timeout
    # Note: We manually enter the context manager to return the connection
    # This is not ideal but maintains backward compatibility
    ctx = get_readonly_connection(db_path)
    return ctx.__enter__()


def query_matrix(
    conn: duckdb.DuckDBPyConnection,
    interval: str,
    month_filter: Optional[str] = None
) -> Dict[str, Dict[int, float]]:
    """Query coverage matrix from DuckDB."""
    table_name = f'ohlcv_horizon_coverage_{interval}'
    
    query = f"""
        SELECT 
            month_key,
            horizon_hours,
            coverage_percentage,
            total_alerts,
            alerts_with_coverage
        FROM {table_name}
        WHERE interval = ?
    """
    
    params = [interval]
    
    if month_filter:
        query += " AND month_key = ?"
        params.append(month_filter)
    
    query += " ORDER BY month_key, horizon_hours"
    
    try:
        result = conn.execute(query, params).fetchall()
    except Exception as e:
        print(f"Error querying matrix: {e}", file=sys.stderr)
        print(f"Make sure the table {table_name} exists. Run the generation script first.", file=sys.stderr)
        sys.exit(1)
    
    matrix = {}
    for row in result:
        month_key, horizon, coverage_pct, total_alerts, alerts_with_coverage = row
        if month_key not in matrix:
            matrix[month_key] = {}
        matrix[month_key][horizon] = coverage_pct
    
    return matrix


def get_all_months(conn: duckdb.DuckDBPyConnection, interval: str) -> List[str]:
    """Get all available months from the matrix."""
    table_name = f'ohlcv_horizon_coverage_{interval}'
    
    query = f"""
        SELECT DISTINCT month_key
        FROM {table_name}
        WHERE interval = ?
        ORDER BY month_key
    """
    
    try:
        result = conn.execute(query, [interval]).fetchall()
        return [row[0] for row in result]
    except Exception:
        return []


def visualize_matrix(matrix: Dict[str, Dict[int, float]], interval: str, month_filter: Optional[str] = None):
    """Print coverage matrix with histogram visualization."""
    if not matrix:
        print("No data found in matrix.", file=sys.stderr)
        return
    
    month_keys = sorted(matrix.keys())
    
    if month_filter:
        month_keys = [m for m in month_keys if m == month_filter]
    
    if not month_keys:
        print(f"No data found for month {month_filter}", file=sys.stderr)
        return
    
    print(f"\n{'='*80}")
    print(f"OHLCV Coverage Matrix - {interval} candles")
    if month_filter:
        print(f"Filtered to: {month_filter}")
    print(f"{'='*80}\n")
    
    # Header
    print(f"{'Horizon':<12}", end="")
    for month_key in month_keys:
        print(f"{month_key:>8}", end="")
    print()
    print("-" * (12 + 8 * len(month_keys)))
    
    # Rows
    for horizon in HORIZONS:
        horizon_label = f"{horizon:+4d}hrs"
        print(f"{horizon_label:<12}", end="")
        
        for month_key in month_keys:
            coverage = matrix.get(month_key, {}).get(horizon, 0.0)
            
            # Color coding
            if coverage >= 90:
                color_code = "\033[32m"  # Green
            elif coverage >= 75:
                color_code = "\033[33m"  # Yellow
            elif coverage >= 50:
                color_code = "\033[93m"  # Bright yellow
            else:
                color_code = "\033[31m"  # Red
            
            reset_code = "\033[0m"
            
            print(f"{color_code}{coverage:>6.1f}%{reset_code}", end="")
        print()
    
    print("\n" + "="*80)
    print("Legend: Coverage percentage (0-100%)")
    print("Colors: Green (≥90%), Yellow (≥75%), Bright Yellow (≥50%), Red (<50%)")
    print("="*80 + "\n")


def main():
    parser = argparse.ArgumentParser(description='Query OHLCV horizon coverage matrix')
    parser.add_argument('--duckdb', required=True, help='Path to DuckDB database')
    parser.add_argument('--interval', choices=['1m', '5m'], default='1m', help='Candle interval')
    parser.add_argument('--month', help='Filter to specific month (YYYY-MM format)')
    parser.add_argument('--list-months', action='store_true', help='List available months')
    
    args = parser.parse_args()
    
    conn = get_duckdb_connection(args.duckdb)
    
    if args.list_months:
        months = get_all_months(conn, args.interval)
        print(f"Available months for {args.interval} candles:")
        for month in months:
            print(f"  {month}")
        return
    
    matrix = query_matrix(conn, args.interval, args.month)
    visualize_matrix(matrix, args.interval, args.month)


if __name__ == '__main__':
    main()


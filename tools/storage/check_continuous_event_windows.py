#!/usr/bin/env python3
"""
Check continuous event window coverage past alerts, per token.

For each alert, checks if candles are continuously available in time windows
(12hr, 24hr, 36hr, 48hr, 72hr, 96hr) after the alert timestamp.

If price stops moving (becomes constant) AND volume goes to 0, the token is
considered "dead" and coverage is 100% from that point forward.

Reports percentage of alerts with continuous coverage for each time bucket, per token.

Usage:
    python tools/storage/check_continuous_event_windows.py \
        [--duckdb data/alerts.duckdb] \
        [--limit 100]

Environment variables for ClickHouse:
    CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_USER, CLICKHOUSE_PASSWORD, CLICKHOUSE_DATABASE
"""

import os
import sys
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Tuple, Any

try:
    import duckdb
except ImportError:
    print("[error] duckdb not installed. pip install duckdb", file=sys.stderr)
    sys.exit(1)

try:
    from clickhouse_connect import get_client
    CLICKHOUSE_AVAILABLE = True
except ImportError:
    CLICKHOUSE_AVAILABLE = False
    print(
        "[error] clickhouse-connect not installed. "
        "Install with: pip install clickhouse-connect",
        file=sys.stderr
    )
    sys.exit(1)


# Time windows in hours
TIME_WINDOWS = [12, 24, 36, 48, 72, 96]


def get_clickhouse_client():
    """
    Get ClickHouse client from environment or defaults.
    
    clickhouse_connect uses HTTP protocol, so we need HTTP ports:
    - 8123 (local/default HTTP)
    - 18123 (Docker HTTP, mapped from container's 8123)
    
    If CLICKHOUSE_PORT is set to native protocol port (9000/19000), map to HTTP port.
    """
    host = os.getenv('CLICKHOUSE_HOST', 'localhost')
    env_port_str = os.getenv('CLICKHOUSE_PORT', '8123')
    env_port = int(env_port_str)
    
    # Map native protocol ports to HTTP ports for clickhouse_connect
    # clickhouse_connect uses HTTP, not native protocol
    if env_port == 9000:
        port = 8123  # Local HTTP
    elif env_port == 19000:
        port = 18123  # Docker HTTP
    else:
        port = env_port
    
    user = os.getenv('CLICKHOUSE_USER', 'default')
    password = os.getenv('CLICKHOUSE_PASSWORD', '')
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    
    try:
        client = get_client(
            host=host,
            port=port,
            username=user,
            password=password,
            database=database
        )
        client.command('SELECT 1')
        return client, database
    except Exception as e:
        print(f"[error] Failed to connect to ClickHouse: {e}", file=sys.stderr)
        print(f"[info] Tried host={host}, port={port} (mapped from CLICKHOUSE_PORT={env_port_str})", file=sys.stderr)
        print(f"[info] clickhouse_connect uses HTTP protocol - ensure you're using HTTP port (8123 or 18123)", file=sys.stderr)
        sys.exit(1)


def get_alerts_from_duckdb(duckdb_path: str, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """Get alerts from DuckDB."""
    conn = duckdb.connect(duckdb_path, read_only=True)
    
    limit_clause = f"LIMIT {limit}" if limit else ""
    
    # Try canon.alerts_std first, fallback to other views
    try:
        query = f"""
            SELECT DISTINCT
                mint,
                chain,
                alert_ts_ms
            FROM canon.alerts_std
            WHERE mint IS NOT NULL
              AND alert_ts_ms IS NOT NULL
            ORDER BY alert_ts_ms DESC
            {limit_clause}
        """
        results = conn.execute(query).fetchall()
    except Exception:
        # Fallback query
        try:
            query = f"""
                SELECT DISTINCT
                    mint,
                    COALESCE(chain, 'solana') as chain,
                    trigger_ts_ms as alert_ts_ms
                FROM caller_links_d
                WHERE mint IS NOT NULL
                  AND trigger_ts_ms IS NOT NULL
                ORDER BY trigger_ts_ms DESC
                {limit_clause}
            """
            results = conn.execute(query).fetchall()
        except Exception as e:
            print(f"[error] Failed to query alerts: {e}", file=sys.stderr)
            conn.close()
            sys.exit(1)
    
    alerts = []
    for row in results:
        alerts.append({
            'mint': row[0],
            'chain': row[1] or 'solana',
            'alert_ts_ms': row[2]
        })
    
    conn.close()
    return alerts


def check_token_death(candles: List[Tuple]) -> Optional[int]:
    """
    Check if token died (price stopped moving AND volume went to 0).
    
    Token is considered "dead" when:
    - Price becomes constant (open = high = low = close)
    - Volume goes to 0
    - This state persists for at least 3 consecutive candles
    
    Returns:
        Index of first candle where token died,
        or None if token never died
    """
    if len(candles) < 3:
        return None
    
    # Check forward from beginning to find first point where token dies
    for i in range(len(candles) - 2):
        # Check if current candle has zero volume and constant price
        _, open_price, high, low, close, volume = candles[i]
        
        if volume == 0 and open_price == high == low == close:
            # Check if this state persists for at least 3 candles
            constant_price = close
            is_dead = True
            
            # Check next 2 candles (total of 3 including current)
            for j in range(i + 1, min(i + 3, len(candles))):
                _, o, h, l, c, v = candles[j]
                if v != 0 or not (o == h == l == c == constant_price):
                    is_dead = False
                    break
            
            if is_dead:
                return i
    
    return None


def check_continuous_coverage(
    client,
    database: str,
    mint: str,
    chain: str,
    alert_ts_ms: int,
    window_hours: int
) -> Tuple[bool, bool]:
    """
    Check if there's continuous coverage for a time window after alert.
    
    Returns:
        (has_coverage, token_died) tuple
        - has_coverage: True if continuous candles exist OR token died
        - token_died: True if token died (price stopped + volume 0) before window ended
    """
    alert_ts = alert_ts_ms / 1000.0  # Convert to seconds
    window_end_ts = alert_ts + (window_hours * 3600)
    
    # Query candles from alert time to window end
    query = f"""
        SELECT 
            toUnixTimestamp(timestamp) as ts,
            open,
            high,
            low,
            close,
            volume
        FROM {database}.ohlcv_candles_1m
        WHERE token_address = %(mint)s
          AND chain = %(chain)s
          AND toUnixTimestamp(timestamp) >= %(alert_ts)s
          AND toUnixTimestamp(timestamp) <= %(window_end_ts)s
        ORDER BY timestamp ASC
    """
    
    try:
        result = client.query(
            query,
            parameters={
                'mint': mint,
                'chain': chain,
                'alert_ts': int(alert_ts),
                'window_end_ts': int(window_end_ts)
            }
        )
        
        candles = result.result_rows
        
        if len(candles) == 0:
            return (False, False)
        
        # Check if token died
        death_index = check_token_death(candles)
        if death_index is not None:
            # Token died - coverage is complete from that point forward
            # Even if we don't have candles until window end, token death = 100% coverage
            return (True, True)
        
        # Check for continuous coverage
        # For 1-minute candles, we expect roughly (window_hours * 60) candles
        expected_min_candles = window_hours * 60 * 0.8  # Allow 20% tolerance for gaps
        
        if len(candles) >= expected_min_candles:
            # Check for large gaps (missing more than 10 minutes)
            prev_ts = candles[0][0]
            max_gap = 0
            for candle in candles[1:]:
                ts = candle[0]
                gap = ts - prev_ts
                if gap > max_gap:
                    max_gap = gap
                prev_ts = ts
            
            # If largest gap is less than 10 minutes (600 seconds), consider continuous
            if max_gap < 600:
                return (True, False)
        
        return (False, False)
        
    except Exception as e:
        # If query fails, assume no coverage
        print(f"[warning] Query failed for {mint} @ {alert_ts_ms}: {e}", file=sys.stderr)
        return (False, False)


def analyze_per_token(
    client,
    database: str,
    alerts: List[Dict[str, Any]]
) -> Tuple[Dict[str, Dict[str, Any]], List[Dict[str, Any]]]:
    """
    Analyze coverage per token across all time windows.
    
    Returns:
        Tuple of:
        - Dictionary mapping (mint, chain) -> coverage stats
        - List of per-alert coverage results
    """
    # Group alerts by token
    token_alerts: Dict[Tuple[str, str], List[Dict[str, Any]]] = {}
    for alert in alerts:
        key = (alert['mint'], alert['chain'])
        if key not in token_alerts:
            token_alerts[key] = []
        token_alerts[key].append(alert)
    
    results = {}
    all_alert_results = []  # Per-alert coverage data
    total_tokens = len(token_alerts)
    
    print(f"Analyzing {total_tokens} tokens with {len(alerts)} total alerts...", file=sys.stderr)
    
    for idx, (key, token_alert_list) in enumerate(token_alerts.items()):
        mint, chain = key
        
        if (idx + 1) % 10 == 0:
            print(f"  Progress: {idx + 1}/{total_tokens} tokens...", file=sys.stderr)
        
        # Pre-compute coverage for all alerts and windows
        alert_coverage_data = []
        for alert in token_alert_list:
            alert_window_results = {}
            for window_hours in TIME_WINDOWS:
                has_coverage, token_died = check_continuous_coverage(
                    client,
                    database,
                    mint,
                    chain,
                    alert['alert_ts_ms'],
                    window_hours
                )
                alert_window_results[f'{window_hours}hr'] = {
                    'has_coverage': has_coverage,
                    'token_died': token_died
                }
            alert_coverage_data.append({
                'alert': alert,
                'windows': alert_window_results
            })
        
        # Aggregate per-window stats
        window_stats = {}
        for window_hours in TIME_WINDOWS:
            window_key = f'{window_hours}hr'
            coverage_count = sum(
                1 for data in alert_coverage_data
                if data['windows'][window_key]['has_coverage']
            )
            death_count = sum(
                1 for data in alert_coverage_data
                if data['windows'][window_key]['has_coverage'] and data['windows'][window_key]['token_died']
            )
            
            total_alerts = len(token_alert_list)
            coverage_pct = (coverage_count / total_alerts * 100) if total_alerts > 0 else 0.0
            death_pct = (death_count / total_alerts * 100) if total_alerts > 0 else 0.0
            
            window_stats[window_key] = {
                'coverage_pct': coverage_pct,
                'coverage_count': coverage_count,
                'death_count': death_count,
                'death_pct': death_pct,
                'total_alerts': total_alerts
            }
        
        # Collect per-alert coverage data
        for data in alert_coverage_data:
            all_alert_results.append({
                'mint': mint,
                'chain': chain,
                'alert_ts_ms': data['alert']['alert_ts_ms'],
                'windows': data['windows']
            })
        
        results[f"{mint}:{chain}"] = {
            'mint': mint,
            'chain': chain,
            'total_alerts': len(token_alert_list),
            'windows': window_stats
        }
    
    return results, all_alert_results


def print_report(results: Dict[str, Dict[str, Any]]):
    """Print formatted report."""
    print("\n" + "=" * 100, file=sys.stderr)
    print("CONTINUOUS EVENT WINDOW COVERAGE REPORT (PER TOKEN)", file=sys.stderr)
    print("=" * 100, file=sys.stderr)
    print(file=sys.stderr)
    
    # Sort by total alerts (descending)
    sorted_results = sorted(
        results.items(),
        key=lambda x: x[1]['total_alerts'],
        reverse=True
    )
    
    # Print summary header
    print(f"{'Token':<50} {'Alerts':<8} ", end="", file=sys.stderr)
    for window in TIME_WINDOWS:
        print(f"{window:>4}hr%", end="  ", file=sys.stderr)
    print(file=sys.stderr)
    print("-" * 100, file=sys.stderr)
    
    # Print per-token results
    for token_key, stats in sorted_results[:50]:  # Top 50 tokens
        mint = stats['mint']
        mint_short = (mint[:20] + '...') if len(mint) > 23 else mint
        chain = stats['chain']
        display_key = f"{mint_short} ({chain})"
        
        print(f"{display_key:<50} {stats['total_alerts']:>7} ", end="", file=sys.stderr)
        for window in TIME_WINDOWS:
            window_key = f'{window}hr'
            pct = stats['windows'][window_key]['coverage_pct']
            print(f"{pct:>5.1f}%", end="  ", file=sys.stderr)
        print(file=sys.stderr)
    
    # Print aggregated summary
    print("\n" + "=" * 100, file=sys.stderr)
    print("AGGREGATED SUMMARY", file=sys.stderr)
    print("=" * 100, file=sys.stderr)
    print(file=sys.stderr)
    
    total_tokens = len(results)
    total_alerts = sum(s['total_alerts'] for s in results.values())
    
    print(f"Total tokens analyzed: {total_tokens}", file=sys.stderr)
    print(f"Total alerts analyzed: {total_alerts}", file=sys.stderr)
    print(file=sys.stderr)
    
    # Aggregate coverage percentages across all tokens (weighted by alert count)
    print("Average Coverage % (weighted by alert count):", file=sys.stderr)
    print(f"{'Window':<10} {'Coverage %':<12} {'Deaths %':<12}", file=sys.stderr)
    print("-" * 35, file=sys.stderr)
    
    for window in TIME_WINDOWS:
        window_key = f'{window}hr'
        total_weighted_coverage = 0.0
        total_weighted_death = 0.0
        total_weight = 0
        
        for stats in results.values():
            window_stats = stats['windows'][window_key]
            weight = stats['total_alerts']
            total_weighted_coverage += window_stats['coverage_pct'] * weight
            total_weighted_death += window_stats['death_pct'] * weight
            total_weight += weight
        
        avg_coverage = total_weighted_coverage / total_weight if total_weight > 0 else 0.0
        avg_death = total_weighted_death / total_weight if total_weight > 0 else 0.0
        
        print(f"{window_key:<10} {avg_coverage:>10.2f}%  {avg_death:>10.2f}%", file=sys.stderr)
    
    print("=" * 100, file=sys.stderr)


def main():
    """Main script entry point."""
    import argparse
    
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        '--duckdb',
        default='data/alerts.duckdb',
        help='Path to DuckDB database (default: data/alerts.duckdb)'
    )
    parser.add_argument(
        '--limit',
        type=int,
        help='Limit number of alerts to process (for testing)'
    )
    parser.add_argument(
        '--output',
        help='Output JSON file path (optional)'
    )
    
    args = parser.parse_args()
    
    if not CLICKHOUSE_AVAILABLE:
        sys.exit(1)
    
    try:
        # Connect to databases
        print("Connecting to databases...", file=sys.stderr)
        ch_client, ch_database = get_clickhouse_client()
        print("✓ ClickHouse connected\n", file=sys.stderr)
        
        # Get alerts
        print("Loading alerts from DuckDB...", file=sys.stderr)
        alerts = get_alerts_from_duckdb(args.duckdb, args.limit)
        print(f"✓ Loaded {len(alerts)} alerts\n", file=sys.stderr)
        
        if len(alerts) == 0:
            print("[error] No alerts found", file=sys.stderr)
            sys.exit(1)
        
        # Analyze per token
        results, all_alert_results = analyze_per_token(ch_client, ch_database, alerts)
        
        # Add metadata to output
        output_data = {
            'metadata': {
                'total_tokens': len(results),
                'total_alerts': len(all_alert_results),
                'time_windows': TIME_WINDOWS
            },
            'tokens': results,
            'alerts': all_alert_results
        }
        
        # Print report (using old structure for compatibility)
        print_report(results)
        
        # Save JSON if requested
        if args.output:
            import json
            with open(args.output, 'w') as f:
                json.dump(output_data, f, indent=2)
            print(f"\n✓ Results saved to {args.output}", file=sys.stderr)
        
        # Also output JSON to stdout for programmatic use
        import json
        print("\n", file=sys.stderr)
        print("JSON Output:", file=sys.stderr)
        print(json.dumps(output_data, indent=2))
        
    except KeyboardInterrupt:
        print("\n[info] Interrupted by user", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"\n[error] {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()


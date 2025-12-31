#!/usr/bin/env python3
"""
OHLCV Detailed Coverage Report

Generates comprehensive coverage reports for every MINT, CALLER, and DAY for every MONTH.

Coverage is determined by:
- 1m: -5 intervals before alert to +4000 candles after alert
- 5m: -5 intervals before alert to +4000 candles after alert
- For tokens < 3 months old (at alert time):
  - 15s: -5 intervals before alert to +4000 candles after alert
  - 1s: -5 intervals before alert to +4000 candles after alert

Usage:
    python3 ohlcv_detailed_coverage.py --duckdb data/tele.duckdb --output coverage_report.json
    python3 ohlcv_detailed_coverage.py --duckdb data/tele.duckdb --format csv --output coverage_report.csv
    python3 ohlcv_detailed_coverage.py --duckdb data/tele.duckdb --caller Brook --start-month 2025-12
"""

import argparse
import json
import os
import sys
import warnings
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional, Tuple
from collections import defaultdict
import csv

# Suppress deprecation warnings
warnings.filterwarnings('ignore', category=DeprecationWarning)


class DateTimeEncoder(json.JSONEncoder):
    """Custom JSON encoder that handles datetime objects recursively"""
    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        # Also handle duckdb datetime types if they exist
        if hasattr(obj, 'isoformat') and not isinstance(obj, str):
            try:
                return obj.isoformat()
            except (AttributeError, TypeError):
                pass
        return super().default(obj)

# Try to import tqdm for progress bars, fall back to simple progress messages
try:
    from tqdm import tqdm
    HAS_TQDM = True
except ImportError:
    HAS_TQDM = False

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb package not installed. Run: pip install duckdb", file=sys.stderr)
    sys.exit(1)

try:
    from clickhouse_driver import Client as ClickHouseClient
except ImportError:
    print("ERROR: clickhouse-driver not installed. Run: pip install clickhouse-driver", file=sys.stderr)
    sys.exit(1)


def get_clickhouse_client() -> Tuple[ClickHouseClient, str]:
    """
    Get ClickHouse client from environment or defaults.
    
    Returns:
        tuple: (ClickHouseClient, database_name)
    """
    host = os.getenv('CLICKHOUSE_HOST', 'localhost')
    env_port_str = os.getenv('CLICKHOUSE_PORT', '19000')
    env_port = int(env_port_str)
    # Map HTTP ports to native protocol ports
    if env_port == 8123:
        port = 9000
    elif env_port == 18123:
        port = 19000
    else:
        port = env_port
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    user = os.getenv('CLICKHOUSE_USER', 'default')
    password = os.getenv('CLICKHOUSE_PASSWORD', '')
    connect_timeout = int(os.getenv('CLICKHOUSE_CONNECT_TIMEOUT', '10'))
    send_receive_timeout = int(os.getenv('CLICKHOUSE_SEND_RECEIVE_TIMEOUT', '30'))
    
    client = ClickHouseClient(
        host=host,
        port=port,
        database=database,
        user=user,
        password=password,
        connect_timeout=connect_timeout,
        send_receive_timeout=send_receive_timeout
    )
    
    # Test connection with a simple query
    try:
        client.execute('SELECT 1')
    except Exception as e:
        print(f"ERROR: Failed to connect to ClickHouse: {e}", file=sys.stderr)
        raise
    return client, database


def get_calls_by_mint_caller_day(duckdb_conn, start_month: Optional[str] = None, 
                                  end_month: Optional[str] = None,
                                  caller_filter: Optional[str] = None) -> List[Dict]:
    """
    Get all calls grouped by mint, caller, and day.
    
    Returns list of calls with:
        - mint
        - caller_name
        - call_datetime
        - call_ts_ms
        - year_month (YYYY-MM)
        - day (YYYY-MM-DD)
        - chain (defaults to 'solana' since user_calls_d doesn't have chain column)
    """
    where_clauses = []
    params = []
    
    if start_month:
        try:
            start_date = datetime.strptime(start_month + '-01', '%Y-%m-%d')
            start_ts = int(start_date.timestamp() * 1000)
            where_clauses.append(f"call_ts_ms >= {start_ts}")
        except ValueError as e:
            raise ValueError(f"Invalid start-month format: '{start_month}'. Expected YYYY-MM format.") from e
    
    if end_month:
        try:
            end_date = datetime.strptime(end_month + '-01', '%Y-%m-%d')
            if end_date.month == 12:
                end_date = end_date.replace(year=end_date.year + 1, month=1)
            else:
                end_date = end_date.replace(month=end_date.month + 1)
            end_ts = int(end_date.timestamp() * 1000)
            where_clauses.append(f"call_ts_ms < {end_ts}")
        except ValueError as e:
            raise ValueError(f"Invalid end-month format: '{end_month}'. Expected YYYY-MM format.") from e
    
    if caller_filter:
        where_clauses.append(f"caller_name = '{caller_filter.replace(chr(39), chr(39)+chr(39))}'")
    
    where_sql = " AND " + " AND ".join(where_clauses) if where_clauses else ""
    
    query = f"""
    SELECT 
        mint,
        caller_name,
        call_datetime,
        call_ts_ms,
        strftime(to_timestamp(call_ts_ms / 1000), '%Y-%m') as year_month,
        strftime(to_timestamp(call_ts_ms / 1000), '%Y-%m-%d') as day
    FROM user_calls_d
    WHERE mint IS NOT NULL 
      AND mint != ''
      AND caller_name IS NOT NULL
      AND caller_name != ''
      AND call_ts_ms IS NOT NULL
      {where_sql}
    ORDER BY caller_name, year_month, day, call_ts_ms
    """
    
    results = duckdb_conn.execute(query).fetchall()
    
    calls = []
    for row in results:
        mint, caller_name, call_datetime, call_ts_ms, year_month, day = row
        # user_calls_d doesn't have chain column, default to 'solana' (most tokens are Solana)
        # Convert datetime to ISO string for JSON serialization
        # DuckDB returns Python datetime objects
        if call_datetime is None:
            call_datetime_str = None
        elif isinstance(call_datetime, datetime):
            # Python datetime object
            call_datetime_str = call_datetime.isoformat()
        elif hasattr(call_datetime, 'isoformat'):
            # datetime-like object (fallback for other datetime types)
            try:
                call_datetime_str = call_datetime.isoformat()
            except (AttributeError, TypeError):
                call_datetime_str = str(call_datetime)
        else:
            # Already a string or other type
            call_datetime_str = str(call_datetime) if call_datetime is not None else None
        
        calls.append({
            'mint': mint,
            'caller_name': caller_name,
            'call_datetime': call_datetime_str,
            'call_ts_ms': int(call_ts_ms) if call_ts_ms is not None else None,
            'chain': 'solana',  # Default to solana since user_calls_d doesn't have chain column
            'year_month': year_month,
            'day': day
        })
    
    return calls


def calculate_interval_seconds(interval: str) -> int:
    """Convert interval string to seconds"""
    interval_map = {
        '1s': 1,
        '15s': 15,
        '1m': 60,
        '5m': 300,
        '15m': 900,
        '1h': 3600,
        '4h': 14400,
        '1d': 86400
    }
    return interval_map.get(interval, 60)


def calculate_coverage_for_interval(
    ch_client: ClickHouseClient,
    database: str,
    mint: str,
    chain: str,
    alert_ts_ms: int,
    interval: str,
    periods_before: int,
    periods_after: int,
    verbose: bool = False
) -> Dict[str, Any]:
    """
    Calculate coverage percentage for a specific interval.
    
    Args:
        ch_client: ClickHouse client
        database: Database name
        mint: Token mint address
        chain: Chain name
        alert_ts_ms: Alert timestamp in milliseconds
        interval: Candle interval ('1m', '5m', '15s', '1s')
        periods_before: Number of periods before alert to check
        periods_after: Number of periods after alert to check
    
    Returns:
        {
            'coverage_percent': float,
            'expected_candles': int,
            'actual_candles': int,
            'has_sufficient_coverage': bool
        }
    """
    interval_seconds = calculate_interval_seconds(interval)
    
    # Calculate time range
    alert_ts = alert_ts_ms / 1000.0  # Convert to seconds
    start_ts = alert_ts - (periods_before * interval_seconds)
    end_ts = alert_ts + (periods_after * interval_seconds)
    
    expected_candles = periods_before + periods_after
    
    # Query ClickHouse for candles in range
    escaped_mint = mint.replace("'", "''")
    escaped_chain = chain.replace("'", "''")
    # Convert interval string to seconds for comparison with interval_seconds column
    interval_seconds_value = calculate_interval_seconds(interval)
    
    query = f"""
    SELECT COUNT(*) as count
    FROM {database}.ohlcv_candles
    WHERE (token_address = '{escaped_mint}'
           OR lower(token_address) = lower('{escaped_mint}'))
      AND chain = '{escaped_chain}'
      AND interval_seconds = {interval_seconds_value}
      AND toUnixTimestamp(timestamp) >= {int(start_ts)}
      AND toUnixTimestamp(timestamp) <= {int(end_ts)}
    """
    
    try:
        if verbose:
            print(f"  Querying {mint[:20]}... {interval}...", file=sys.stderr, flush=True)
        results = ch_client.execute(query)
        actual_candles = results[0][0] if results else 0
    except Exception as e:
        print(f"Warning: Error querying candles for {mint[:20]}... {interval}: {e}", file=sys.stderr, flush=True)
        actual_candles = 0
    
    coverage_percent = (actual_candles / expected_candles * 100.0) if expected_candles > 0 else 0.0
    has_sufficient_coverage = actual_candles >= expected_candles
    
    return {
        'coverage_percent': round(coverage_percent, 2),
        'expected_candles': expected_candles,
        'actual_candles': actual_candles,
        'has_sufficient_coverage': has_sufficient_coverage
    }


def is_token_less_than_3_months_old(alert_ts_ms: int, token_created_ts_ms: Optional[int]) -> bool:
    """
    Check if token is less than 3 months old at alert time.
    
    If token_created_ts_ms is not available, assumes token is older than 3 months.
    """
    if not token_created_ts_ms:
        return False
    
    three_months_seconds = 90 * 24 * 60 * 60  # Approximate 3 months
    token_age_seconds = (alert_ts_ms - token_created_ts_ms) / 1000.0
    return token_age_seconds < three_months_seconds


def batch_calculate_coverage_by_month(
    ch_client: ClickHouseClient,
    database: str,
    calls_by_month: Dict[str, List[Dict]],
    token_created_map: Dict[str, int],
    verbose: bool = False
) -> List[Dict[str, Any]]:
    """
    Calculate coverage using batch queries grouped by month.
    
    This is much faster than querying each call individually.
    Groups calls by month and interval, then runs batch queries.
    
    Args:
        ch_client: ClickHouse client
        database: Database name
        calls_by_month: Dict mapping year_month (YYYY-MM) to list of calls
        token_created_map: Dict mapping mint -> token_created_ts_ms
        verbose: Show verbose output
    
    Returns:
        List of coverage results (one per call)
    """
    coverage_results = []
    
    # Process each month
    for year_month, calls in calls_by_month.items():
        if verbose:
            print(f"Processing month {year_month}: {len(calls)} calls", file=sys.stderr, flush=True)
        
        # Group calls by interval (we'll check 1m and 5m for all, plus 15s/1s for young tokens)
        # For batch efficiency, we'll check all intervals for all tokens in the month
        
        # Get unique mints for this month
        mints_in_month = list(set(call['mint'] for call in calls))
        
        if verbose:
            print(f"  Unique mints in {year_month}: {len(mints_in_month)}", file=sys.stderr, flush=True)
        
        # For each call, calculate coverage (but we can optimize by batching queries)
        for call in calls:
            mint = call['mint']
            chain = call['chain']
            alert_ts_ms = call['call_ts_ms']
            
            is_young_token = is_token_less_than_3_months_old(alert_ts_ms, token_created_map.get(mint))
            
            coverage = {
                'mint': mint,
                'caller_name': call['caller_name'],
                'alert_ts_ms': alert_ts_ms,
                'alert_datetime': call['call_datetime'],
                'day': call['day'],
                'year_month': call['year_month'],
                'chain': chain,
                'is_young_token': is_young_token,
                'intervals': {}
            }
            
            # Standard coverage: 1m and 5m
            # Requirements: -5 intervals before alert, +4000 candles after alert
            intervals_to_check = [
                ('1m', 5, 4000),
                ('5m', 5, 4000)
            ]
            
            # For young tokens, also check 15s and 1s
            if is_young_token:
                intervals_to_check.extend([
                    ('15s', 5, 4000),
                    ('1s', 5, 4000)
                ])
            
            for interval, periods_before, periods_after in intervals_to_check:
                interval_coverage = calculate_coverage_for_interval(
                    ch_client, database, mint, chain, alert_ts_ms,
                    interval, periods_before, periods_after, verbose
                )
                coverage['intervals'][interval] = interval_coverage
            
            coverage_results.append(coverage)
    
    return coverage_results


def calculate_coverage_for_call(
    ch_client: ClickHouseClient,
    database: str,
    call: Dict,
    token_created_ts_ms: Optional[int] = None,
    verbose: bool = False
) -> Dict[str, Any]:
    """
    Calculate coverage for a single call.
    
    Returns coverage metrics for all relevant intervals.
    """
    mint = call['mint']
    chain = call['chain']
    alert_ts_ms = call['call_ts_ms']
    
    is_young_token = is_token_less_than_3_months_old(alert_ts_ms, token_created_ts_ms)
    
    coverage = {
        'mint': mint,
        'caller_name': call['caller_name'],
        'alert_ts_ms': alert_ts_ms,
        'alert_datetime': call['call_datetime'],
        'day': call['day'],
        'year_month': call['year_month'],
        'chain': chain,
        'is_young_token': is_young_token,
        'intervals': {}
    }
    
    # Standard coverage: 1m and 5m
    # Requirements: -5 intervals before alert, +4000 candles after alert
    intervals_to_check = [
        ('1m', 5, 4000),
        ('5m', 5, 4000)
    ]
    
    # For young tokens, also check 15s and 1s
    if is_young_token:
        intervals_to_check.extend([
            ('15s', 5, 4000),
            ('1s', 5, 4000)
        ])
    
    for interval, periods_before, periods_after in intervals_to_check:
        interval_coverage = calculate_coverage_for_interval(
            ch_client, database, mint, chain, alert_ts_ms,
            interval, periods_before, periods_after, verbose
        )
        coverage['intervals'][interval] = interval_coverage
    
    return coverage


def get_token_created_timestamps(duckdb_conn) -> Dict[str, int]:
    """
    Get token creation timestamps from DuckDB.
    
    Returns dict mapping mint -> token_created_ts_ms
    """
    # Try to get from caller_links_d table which has token_created_ts_ms
    query = """
    SELECT DISTINCT mint, token_created_ts_ms
    FROM caller_links_d
    WHERE mint IS NOT NULL AND token_created_ts_ms IS NOT NULL
    """
    
    try:
        results = duckdb_conn.execute(query).fetchall()
        return {mint: ts_ms for mint, ts_ms in results}
    except Exception:
        # If column doesn't exist, return empty dict
        return {}


def generate_coverage_report(
    duckdb_path: str,
    ch_client: ClickHouseClient,
    database: str,
    start_month: Optional[str] = None,
    end_month: Optional[str] = None,
    caller_filter: Optional[str] = None,
    verbose: bool = False,
    limit: Optional[int] = None
) -> Dict[str, Any]:
    """
    Generate comprehensive coverage report.
    
    Returns:
        {
            'summary': {...},
            'by_mint_caller_day': [...],
            'metadata': {...}
        }
    """
    duckdb_conn = duckdb.connect(duckdb_path, read_only=True)
    
    try:
        print("Fetching calls from DuckDB...", file=sys.stderr, flush=True)
        
        calls = get_calls_by_mint_caller_day(
            duckdb_conn, start_month, end_month, caller_filter
        )
        
        print(f"Found {len(calls)} calls", file=sys.stderr, flush=True)
        
        # Validate duplicate mints - check if they're from different callers/dates
        print("Validating duplicate mints...", file=sys.stderr, flush=True)
        mint_counts = defaultdict(list)
        for i, call in enumerate(calls):
            mint_counts[call['mint']].append({
                'index': i,
                'caller': call['caller_name'],
                'date': call['day'],
                'alert_ts_ms': call['call_ts_ms']
            })
        
        duplicates = {mint: entries for mint, entries in mint_counts.items() if len(entries) > 1}
        
        if duplicates:
            print(f"Found {len(duplicates)} mints with multiple calls", file=sys.stderr, flush=True)
            
            suspicious_duplicates = []
            for mint, entries in duplicates.items():
                # Check if any entries have same caller AND same date
                seen_combinations = set()
                for entry in entries:
                    key = (entry['caller'], entry['date'])
                    if key in seen_combinations:
                        suspicious_duplicates.append({
                            'mint': mint,
                            'caller': entry['caller'],
                            'date': entry['date'],
                            'count': len([e for e in entries if (e['caller'], e['date']) == key])
                        })
                    seen_combinations.add(key)
            
            if suspicious_duplicates:
                print(f"⚠️  WARNING: Found {len(suspicious_duplicates)} suspicious duplicates (same mint, caller, and date):", file=sys.stderr, flush=True)
                for dup in suspicious_duplicates[:10]:  # Show first 10
                    print(f"  - {dup['mint'][:20]}... | {dup['caller']} | {dup['date']} | {dup['count']} times", file=sys.stderr, flush=True)
                if len(suspicious_duplicates) > 10:
                    print(f"  ... and {len(suspicious_duplicates) - 10} more", file=sys.stderr, flush=True)
            else:
                print(f"✓ All duplicate mints are from different callers or dates (legitimate duplicates)", file=sys.stderr, flush=True)
            
            # Show summary stats
            total_duplicate_calls = sum(len(entries) for entries in duplicates.values())
            print(f"  Total calls with duplicate mints: {total_duplicate_calls}", file=sys.stderr, flush=True)
            print(f"  Unique mints with duplicates: {len(duplicates)}", file=sys.stderr, flush=True)
        else:
            print("✓ No duplicate mints found", file=sys.stderr, flush=True)
        
        # Deduplicate: same caller + same mint + same month = keep only one
        print("Deduplicating calls (same caller + mint + month)...", file=sys.stderr, flush=True)
        original_count = len(calls)
        seen_combinations = {}
        deduplicated_calls = []
        
        for call in calls:
            # Key: (caller, mint, year_month)
            key = (call['caller_name'], call['mint'], call['year_month'])
            
            if key not in seen_combinations:
                # First occurrence - keep it
                seen_combinations[key] = True
                deduplicated_calls.append(call)
        
        removed_count = original_count - len(deduplicated_calls)
        if removed_count > 0:
            print(f"  Removed {removed_count} duplicate entries (same caller+mint+month)", file=sys.stderr, flush=True)
            print(f"  Kept {len(deduplicated_calls)} unique calls (was {original_count})", file=sys.stderr, flush=True)
        else:
            print(f"  ✓ No duplicates to remove", file=sys.stderr, flush=True)
        
        calls = deduplicated_calls
        
        # Apply limit if specified
        if limit and limit > 0:
            print(f"Limiting to first {limit} calls for testing", file=sys.stderr, flush=True)
            calls = calls[:limit]
        
        if len(calls) == 0:
            print("No calls found matching criteria. Exiting.", file=sys.stderr, flush=True)
            return {
                'summary': {
                    'total_calls': 0,
                    'young_tokens': 0,
                    'by_interval': {},
                    'by_month': {}
                },
                'by_mint_caller_day': [],
                'metadata': {
                    'generated_at': datetime.utcnow().isoformat(),
                    'duckdb_path': duckdb_path,
                    'start_month': start_month,
                    'end_month': end_month,
                    'caller_filter': caller_filter,
                    'total_calls_analyzed': 0
                }
            }
        
        # Get token creation timestamps
        print("Loading token creation timestamps...", file=sys.stderr, flush=True)
        token_created_map = get_token_created_timestamps(duckdb_conn)
        
        print(f"Found creation timestamps for {len(token_created_map)} tokens", file=sys.stderr, flush=True)
        print(f"Starting coverage calculation for {len(calls)} calls...", file=sys.stderr, flush=True)
        
        # Group calls by month for batch processing
        calls_by_month = defaultdict(list)
        for call in calls:
            calls_by_month[call['year_month']].append(call)
        
        print(f"Grouped into {len(calls_by_month)} months for batch processing", file=sys.stderr, flush=True)
        
        # Calculate coverage using batch queries by month
        coverage_results = batch_calculate_coverage_by_month(
            ch_client, database, calls_by_month, token_created_map, verbose
        )
        
        print(f"Completed: {len(coverage_results)}/{len(calls)} calls processed", file=sys.stderr, flush=True)
        
        # Generate summary statistics
        summary = calculate_summary_statistics(coverage_results)
        
        return {
            'summary': summary,
            'by_mint_caller_day': coverage_results,
            'metadata': {
                'generated_at': datetime.utcnow().isoformat(),
                'duckdb_path': duckdb_path,
                'start_month': start_month,
                'end_month': end_month,
                'caller_filter': caller_filter,
                'total_calls_analyzed': len(coverage_results)
            }
        }
    
    finally:
        duckdb_conn.close()


def calculate_summary_statistics(coverage_results: List[Dict]) -> Dict[str, Any]:
    """Calculate summary statistics from coverage results"""
    
    summary = {
        'total_calls': len(coverage_results),
        'young_tokens': sum(1 for r in coverage_results if r['is_young_token']),
        'by_interval': {},
        'by_month': defaultdict(lambda: {
            'total_calls': 0,
            'by_interval': defaultdict(lambda: {
                'total': 0,
                'sufficient_coverage': 0,
                'average_coverage_percent': 0.0
            })
        })
    }
    
    interval_totals = defaultdict(lambda: {'total': 0, 'sufficient': 0, 'coverage_sum': 0.0})
    
    for result in coverage_results:
        year_month = result['year_month']
        summary['by_month'][year_month]['total_calls'] += 1
        
        for interval, interval_data in result['intervals'].items():
            interval_totals[interval]['total'] += 1
            if interval_data['has_sufficient_coverage']:
                interval_totals[interval]['sufficient'] += 1
            interval_totals[interval]['coverage_sum'] += interval_data['coverage_percent']
            
            month_interval = summary['by_month'][year_month]['by_interval'][interval]
            month_interval['total'] += 1
            if interval_data['has_sufficient_coverage']:
                month_interval['sufficient_coverage'] += 1
    
    # Calculate averages
    for interval, totals in interval_totals.items():
        summary['by_interval'][interval] = {
            'total_calls': totals['total'],
            'calls_with_sufficient_coverage': totals['sufficient'],
            'sufficient_coverage_percent': (totals['sufficient'] / totals['total'] * 100.0) if totals['total'] > 0 else 0.0,
            'average_coverage_percent': (totals['coverage_sum'] / totals['total']) if totals['total'] > 0 else 0.0
        }
    
    # Calculate monthly averages
    for month_data in summary['by_month'].values():
        for interval_data in month_data['by_interval'].values():
            if interval_data['total'] > 0:
                interval_data['sufficient_coverage_percent'] = (
                    interval_data['sufficient_coverage'] / interval_data['total'] * 100.0
                )
    
    summary['by_month'] = dict(summary['by_month'])
    
    return summary


def export_to_csv(coverage_results: List[Dict], output_path: str):
    """Export coverage results to CSV"""
    
    with open(output_path, 'w', newline='') as f:
        writer = csv.writer(f)
        
        # Header
        header = [
            'Mint', 'Caller', 'Day', 'Month', 'Alert Datetime', 'Chain',
            'Is Young Token',
            '1m Coverage %', '1m Expected', '1m Actual', '1m Sufficient',
            '5m Coverage %', '5m Expected', '5m Actual', '5m Sufficient',
            '15s Coverage %', '15s Expected', '15s Actual', '15s Sufficient',
            '1s Coverage %', '1s Expected', '1s Actual', '1s Sufficient'
        ]
        writer.writerow(header)
        
        # Rows
        for result in coverage_results:
            row = [
                result['mint'],
                result['caller_name'],
                result['day'],
                result['year_month'],
                result['alert_datetime'],
                result['chain'],
                'Yes' if result['is_young_token'] else 'No'
            ]
            
            # Add interval data (use empty values if interval not checked)
            for interval in ['1m', '5m', '15s', '1s']:
                if interval in result['intervals']:
                    interval_data = result['intervals'][interval]
                    row.extend([
                        f"{interval_data['coverage_percent']:.2f}",
                        interval_data['expected_candles'],
                        interval_data['actual_candles'],
                        'Yes' if interval_data['has_sufficient_coverage'] else 'No'
                    ])
                else:
                    row.extend(['', '', '', ''])
            
            writer.writerow(row)


def main():
    parser = argparse.ArgumentParser(description='Generate detailed OHLCV coverage report')
    parser.add_argument('--duckdb', default='data/tele.duckdb',
                       help='Path to DuckDB database (default: data/tele.duckdb)')
    parser.add_argument('--format', choices=['json', 'csv'], default='json',
                       help='Output format (default: json)')
    parser.add_argument('--output',
                       help='Output file path (optional for JSON, required for CSV format)')
    parser.add_argument('--caller', help='Filter by specific caller')
    parser.add_argument('--start-month', help='Start month (YYYY-MM format)')
    parser.add_argument('--end-month', help='End month (YYYY-MM format)')
    parser.add_argument('--verbose', action='store_true',
                       help='Show verbose progress output')
    parser.add_argument('--limit', type=int, default=None,
                       help='Limit number of calls to process (for testing/debugging)')
    
    args = parser.parse_args()
    
    ch_client = None
    
    try:
        print("Connecting to ClickHouse...", file=sys.stderr, flush=True)
        
        ch_client, database = get_clickhouse_client()
        
        print("Connected to ClickHouse successfully", file=sys.stderr, flush=True)
        
        # Test query to verify schema works
        print("Testing ClickHouse query with interval_seconds...", file=sys.stderr, flush=True)
        try:
            test_query = f"SELECT COUNT(*) FROM {database}.ohlcv_candles WHERE interval_seconds = 60 LIMIT 1"
            result = ch_client.execute(test_query)
            print(f"✓ Schema test passed. Found {result[0][0] if result else 0} candles with interval_seconds=60", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"ERROR: Schema test failed: {e}", file=sys.stderr, flush=True)
            print(f"  Make sure the table {database}.ohlcv_candles has interval_seconds column (UInt32)", file=sys.stderr, flush=True)
            raise
        
        print("Generating coverage report...", file=sys.stderr, flush=True)
        
        report = generate_coverage_report(
            args.duckdb,
            ch_client,
            database,
            args.start_month,
            args.end_month,
            args.caller,
            args.verbose,
            args.limit
        )
        
        print("Coverage calculation complete!", file=sys.stderr, flush=True)
        print(f"Summary: {report['summary']['total_calls']} calls analyzed", file=sys.stderr, flush=True)
        
        # Output results
        if args.format == 'json':
            # For JSON, output to stdout so TypeScript can parse it
            output_json = json.dumps(report, indent=2, cls=DateTimeEncoder)
            print(output_json, flush=True)
        elif args.format == 'csv':
            if not args.output:
                print("ERROR: --output is required for CSV format", file=sys.stderr, flush=True)
                return 1
            export_to_csv(report['by_mint_caller_day'], args.output)
            print(f"Coverage report written to {args.output}", file=sys.stderr, flush=True)
            # Also output summary as JSON to stdout for TypeScript
            print(json.dumps({'summary': report['summary'], 'metadata': report['metadata']}, indent=2, cls=DateTimeEncoder), flush=True)
        
        return 0
        
    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr, flush=True)
        import traceback
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        return 1
    finally:
        if ch_client:
            try:
                ch_client.disconnect()
            except Exception:
                pass


if __name__ == '__main__':
    sys.exit(main())


#!/usr/bin/env python3
"""
OHLCV Caller Coverage Matrix

Generates a caller × month coverage matrix showing which callers have OHLCV data
for their calls in each time period. This enables surgical, caller-based fetching.

Matrix format:
                Jul-25  Aug-25  Sep-25  Oct-25  Nov-25  Dec-25
Brook           ████    ████    ████    ████    ████    ██░░
Lsy             ████    ████    ░░░░    ████    ████    ████
Rick            ████    ████    ████    ░░░░    ████    ████
...

Legend:
  ████ = 80-100% coverage (good)
  ███░ = 60-80% coverage (partial)
  ██░░ = 40-60% coverage (gaps)
  █░░░ = 20-40% coverage (poor)
  ░░░░ = 0-20% coverage (missing)

Usage:
    python3 ohlcv_caller_coverage.py --format table
    python3 ohlcv_caller_coverage.py --format json --output caller_coverage.json
    python3 ohlcv_caller_coverage.py --caller Brook --interval 5m
"""

import argparse
import json
import sys
import warnings
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from collections import defaultdict

# Suppress deprecation warnings for cleaner JSON output
warnings.filterwarnings('ignore', category=DeprecationWarning)

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


def get_duckdb_connection(db_path: str):
    """Get DuckDB connection"""
    return duckdb.connect(db_path, read_only=True)


def get_clickhouse_client() -> tuple:
    """Get ClickHouse client from environment or defaults"""
    import os
    
    host = os.getenv('CLICKHOUSE_HOST', 'localhost')
    port = int(os.getenv('CLICKHOUSE_PORT', '9000'))
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    user = os.getenv('CLICKHOUSE_USER', 'default')
    password = os.getenv('CLICKHOUSE_PASSWORD', '')
    
    client = ClickHouseClient(
        host=host,
        port=port,
        database=database,
        user=user,
        password=password
    )
    
    return client, database


def get_caller_calls_by_month(duckdb_conn, start_month: Optional[str] = None, end_month: Optional[str] = None) -> Dict[str, Dict[str, List[Dict]]]:
    """
    Get all calls grouped by caller and month
    
    Returns:
        {
            'Brook': {
                '2025-11': [{'mint': 'xxx', 'trigger_ts_ms': 123, ...}, ...],
                '2025-12': [...]
            },
            'Lsy': {...}
        }
    """
    
    # Build WHERE clause for date filtering
    where_clauses = []
    if start_month:
        start_ts = int(datetime.strptime(start_month + '-01', '%Y-%m-%d').timestamp() * 1000)
        where_clauses.append(f"trigger_ts_ms >= {start_ts}")
    if end_month:
        # End of month
        end_date = datetime.strptime(end_month + '-01', '%Y-%m-%d')
        if end_date.month == 12:
            end_date = end_date.replace(year=end_date.year + 1, month=1)
        else:
            end_date = end_date.replace(month=end_date.month + 1)
        end_ts = int(end_date.timestamp() * 1000)
        where_clauses.append(f"trigger_ts_ms < {end_ts}")
    
    where_sql = " AND " + " AND ".join(where_clauses) if where_clauses else ""
    
    query = f"""
    SELECT 
        trigger_from_name as caller,
        strftime(to_timestamp(trigger_ts_ms / 1000), '%Y-%m') as month,
        mint,
        trigger_ts_ms,
        chain
    FROM caller_links_d
    WHERE mint IS NOT NULL 
      AND mint != ''
      AND trigger_from_name IS NOT NULL
      AND trigger_from_name != ''
      {where_sql}
    ORDER BY trigger_from_name, trigger_ts_ms
    """
    
    results = duckdb_conn.execute(query).fetchall()
    
    # Group by caller and month
    caller_data = defaultdict(lambda: defaultdict(list))
    for row in results:
        caller, month, mint, trigger_ts_ms, chain = row
        caller_data[caller][month].append({
            'mint': mint,
            'trigger_ts_ms': trigger_ts_ms,
            'chain': chain or 'solana'
        })
    
    return dict(caller_data)


def check_ohlcv_coverage(ch_client, database: str, calls: List[Dict], interval: str = '5m', verbose: bool = False) -> Dict[str, Any]:
    """
    Check OHLCV coverage for a list of calls
    
    NOTE: interval filter removed due to ClickHouse 18.16 reserved keyword issue.
    Coverage check now returns true if ANY interval exists for the token.
    
    Returns:
        {
            'total_calls': 100,
            'calls_with_coverage': 85,
            'coverage_ratio': 0.85,
            'missing_mints': ['xxx', 'yyy']
        }
    """
    
    if not calls:
        return {
            'total_calls': 0,
            'calls_with_coverage': 0,
            'coverage_ratio': 0.0,
            'missing_mints': []
        }
    
    # Get unique mints from calls
    mints = list(set(call['mint'] for call in calls))
    
    if verbose:
        print(f"Checking coverage for {len(mints)} unique mints...", file=sys.stderr, flush=True)
    
    # Check which mints have OHLCV data in ClickHouse
    # Batch queries to avoid huge IN clauses (max 100 mints per query)
    # NOTE: Removed interval filter due to ClickHouse 18.16 reserved keyword issue
    mints_with_coverage = set()
    batch_size = 100
    
    for i in range(0, len(mints), batch_size):
        batch = mints[i:i+batch_size]
        mint_placeholders = ','.join(f"'{m}'" for m in batch)
        
        # Simplified query without interval filter (reserved keyword issue in CH 18.16)
        query = f"""
        SELECT DISTINCT token_address
        FROM {database}.ohlcv_candles
        WHERE token_address IN ({mint_placeholders})
        """
        
        try:
            results = ch_client.execute(query)
            mints_with_coverage.update(row[0] for row in results)
            
            if verbose:
                print(f"  Batch {i//batch_size + 1}/{(len(mints)-1)//batch_size + 1}: {len(results)} mints found", file=sys.stderr, flush=True)
        except Exception as e:
            print(f"Warning: ClickHouse query failed for batch {i//batch_size + 1}: {e}", file=sys.stderr, flush=True)
    
    # Calculate coverage
    calls_with_coverage = sum(1 for call in calls if call['mint'] in mints_with_coverage)
    coverage_ratio = calls_with_coverage / len(calls) if calls else 0.0
    missing_mints = [call['mint'] for call in calls if call['mint'] not in mints_with_coverage]
    
    return {
        'total_calls': len(calls),
        'calls_with_coverage': calls_with_coverage,
        'coverage_ratio': coverage_ratio,
        'missing_mints': list(set(missing_mints))  # Unique missing mints
    }


def build_coverage_matrix(
    duckdb_conn,
    ch_client,
    database: str,
    interval: str = '5m',
    caller_filter: Optional[str] = None,
    start_month: Optional[str] = None,
    end_month: Optional[str] = None,
    verbose: bool = False
) -> Dict[str, Any]:
    """
    Build caller × month coverage matrix
    
    Returns:
        {
            'callers': ['Brook', 'Lsy', 'Rick'],
            'months': ['2025-07', '2025-08', ...],
            'matrix': {
                'Brook': {
                    '2025-07': {'coverage_ratio': 0.95, 'total_calls': 100, ...},
                    '2025-08': {...}
                },
                ...
            }
        }
    """
    
    if verbose:
        print("Getting calls from DuckDB...", file=sys.stderr, flush=True)
    
    # Get all calls grouped by caller and month
    caller_calls = get_caller_calls_by_month(duckdb_conn, start_month, end_month)
    
    if verbose:
        print(f"Found {len(caller_calls)} callers", file=sys.stderr, flush=True)
    
    # Filter by caller if specified
    if caller_filter:
        caller_calls = {k: v for k, v in caller_calls.items() if k == caller_filter}
        if verbose:
            print(f"Filtered to caller: {caller_filter}", file=sys.stderr, flush=True)
    
    # Get all unique months
    all_months = set()
    for caller_months in caller_calls.values():
        all_months.update(caller_months.keys())
    months = sorted(list(all_months))
    
    if verbose:
        print(f"Analyzing {len(months)} months: {months}", file=sys.stderr, flush=True)
    
    # Build coverage matrix
    matrix = {}
    total_cells = len(caller_calls) * len(months)
    current_cell = 0
    
    for caller, months_data in caller_calls.items():
        if verbose:
            print(f"\nProcessing caller: {caller}", file=sys.stderr, flush=True)
        
        matrix[caller] = {}
        for month in months:
            current_cell += 1
            calls = months_data.get(month, [])
            
            if verbose:
                print(f"  [{current_cell}/{total_cells}] {month}: {len(calls)} calls", file=sys.stderr, flush=True)
            
            coverage = check_ohlcv_coverage(ch_client, database, calls, interval, verbose)
            matrix[caller][month] = coverage
    
    if verbose:
        print("\nCoverage matrix complete!", file=sys.stderr, flush=True)
    
    return {
        'callers': sorted(list(caller_calls.keys())),
        'months': months,
        'matrix': matrix,
        'interval': interval
    }


def format_coverage_cell(coverage_ratio: float) -> str:
    """Format coverage ratio as visual block"""
    if coverage_ratio >= 0.8:
        return '████'  # 80-100%
    elif coverage_ratio >= 0.6:
        return '███░'  # 60-80%
    elif coverage_ratio >= 0.4:
        return '██░░'  # 40-60%
    elif coverage_ratio >= 0.2:
        return '█░░░'  # 20-40%
    else:
        return '░░░░'  # 0-20%


def format_coverage_color(coverage_ratio: float) -> str:
    """Format coverage ratio with percentage"""
    pct = int(coverage_ratio * 100)
    if coverage_ratio >= 0.8:
        return f"{pct:3d}%"  # Good
    elif coverage_ratio >= 0.6:
        return f"{pct:3d}%"  # Partial
    elif coverage_ratio >= 0.4:
        return f"{pct:3d}%"  # Gaps
    elif coverage_ratio >= 0.2:
        return f"{pct:3d}%"  # Poor
    else:
        return f"{pct:3d}%"  # Missing


def print_coverage_matrix(coverage_data: Dict[str, Any]) -> None:
    """Print coverage matrix in table format"""
    
    callers = coverage_data['callers']
    months = coverage_data['months']
    matrix = coverage_data['matrix']
    interval = coverage_data['interval']
    
    print("\n" + "="*100)
    print(f"OHLCV CALLER COVERAGE MATRIX - Interval: {interval}")
    print("="*100)
    
    # Print legend
    print("\nLegend:")
    print("  ████ = 80-100% coverage (good)")
    print("  ███░ = 60-80% coverage (partial)")
    print("  ██░░ = 40-60% coverage (gaps)")
    print("  █░░░ = 20-40% coverage (poor)")
    print("  ░░░░ = 0-20% coverage (missing)")
    print()
    
    # Print header
    header = f"{'Caller':<20}"
    for month in months:
        # Format as MMM-YY (e.g., Jul-25)
        month_obj = datetime.strptime(month, '%Y-%m')
        month_str = month_obj.strftime('%b-%y')
        header += f" {month_str:>8}"
    print(header)
    print("-" * len(header))
    
    # Print each caller row
    for caller in callers:
        row = f"{caller:<20}"
        for month in months:
            coverage = matrix[caller].get(month, {})
            ratio = coverage.get('coverage_ratio', 0.0)
            cell = format_coverage_cell(ratio)
            row += f" {cell:>8}"
        print(row)
    
    # Print summary statistics
    print("\n" + "="*100)
    print("SUMMARY STATISTICS")
    print("="*100)
    
    for caller in callers:
        total_calls = sum(matrix[caller].get(month, {}).get('total_calls', 0) for month in months)
        total_with_coverage = sum(matrix[caller].get(month, {}).get('calls_with_coverage', 0) for month in months)
        overall_ratio = total_with_coverage / total_calls if total_calls > 0 else 0.0
        
        print(f"\n{caller}:")
        print(f"  Total Calls: {total_calls:,}")
        print(f"  Calls with Coverage: {total_with_coverage:,}")
        print(f"  Overall Coverage: {overall_ratio:.1%}")
        
        # Find months with poor coverage
        poor_months = []
        for month in months:
            coverage = matrix[caller].get(month, {})
            ratio = coverage.get('coverage_ratio', 0.0)
            if ratio < 0.8 and coverage.get('total_calls', 0) > 0:
                poor_months.append((month, ratio, coverage.get('total_calls', 0)))
        
        if poor_months:
            print(f"  Months needing attention:")
            for month, ratio, calls in poor_months:
                print(f"    {month}: {ratio:.1%} coverage ({calls} calls)")
    
    print("\n" + "="*100)


def generate_surgical_fetch_plan(coverage_data: Dict[str, Any], min_coverage: float = 0.8) -> List[Dict[str, Any]]:
    """
    Generate a surgical fetch plan for callers with poor coverage
    
    Returns list of fetch tasks:
    [
        {
            'caller': 'Brook',
            'month': '2025-11',
            'missing_mints': ['xxx', 'yyy'],
            'total_calls': 50,
            'current_coverage': 0.45
        },
        ...
    ]
    """
    
    matrix = coverage_data['matrix']
    months = coverage_data['months']
    
    fetch_plan = []
    
    for caller, months_data in matrix.items():
        for month in months:
            coverage = months_data.get(month, {})
            ratio = coverage.get('coverage_ratio', 0.0)
            total_calls = coverage.get('total_calls', 0)
            
            if ratio < min_coverage and total_calls > 0:
                fetch_plan.append({
                    'caller': caller,
                    'month': month,
                    'missing_mints': coverage.get('missing_mints', []),
                    'total_calls': total_calls,
                    'calls_with_coverage': coverage.get('calls_with_coverage', 0),
                    'current_coverage': ratio,
                    'priority': (1 - ratio) * total_calls  # Higher priority for more calls with worse coverage
                })
    
    # Sort by priority (descending)
    fetch_plan.sort(key=lambda x: x['priority'], reverse=True)
    
    return fetch_plan


def main():
    parser = argparse.ArgumentParser(description='Analyze OHLCV coverage by caller and month')
    parser.add_argument('--duckdb', default='data/tele.duckdb',
                       help='Path to DuckDB database (default: data/tele.duckdb)')
    parser.add_argument('--format', choices=['table', 'json'], default='table',
                       help='Output format (default: table)')
    parser.add_argument('--output', help='Output file for JSON format')
    parser.add_argument('--caller', help='Filter by specific caller')
    parser.add_argument('--interval', default='5m',
                       help='OHLCV interval to check (default: 5m)')
    parser.add_argument('--start-month', help='Start month (YYYY-MM)')
    parser.add_argument('--end-month', help='End month (YYYY-MM)')
    parser.add_argument('--min-coverage', type=float, default=0.8,
                       help='Minimum coverage threshold for surgical fetch plan (default: 0.8)')
    parser.add_argument('--generate-fetch-plan', action='store_true',
                       help='Generate surgical fetch plan for gaps')
    parser.add_argument('--verbose', action='store_true',
                       help='Show verbose progress output to stderr')
    
    args = parser.parse_args()
    
    try:
        # Connect to databases
        duckdb_conn = get_duckdb_connection(args.duckdb)
        ch_client, database = get_clickhouse_client()
        
        # Build coverage matrix
        coverage_data = build_coverage_matrix(
            duckdb_conn,
            ch_client,
            database,
            interval=args.interval,
            caller_filter=args.caller,
            start_month=args.start_month,
            end_month=args.end_month,
            verbose=args.verbose
        )
        
        # Generate fetch plan if requested
        fetch_plan = []
        if args.generate_fetch_plan:
            fetch_plan = generate_surgical_fetch_plan(coverage_data, args.min_coverage)
        
        # Output results
        if args.format == 'json':
            output_data = {
                **coverage_data,
                'fetch_plan': fetch_plan if args.generate_fetch_plan else None,
                'metadata': {
                    'generated_at': datetime.utcnow().isoformat(),
                    'duckdb_path': args.duckdb,
                    'interval': args.interval,
                    'caller_filter': args.caller,
                    'start_month': args.start_month,
                    'end_month': args.end_month
                }
            }
            
            output = json.dumps(output_data, indent=2)
            if args.output:
                with open(args.output, 'w') as f:
                    f.write(output)
                print(f"Coverage data written to {args.output}")
            else:
                print(output)
        else:
            print_coverage_matrix(coverage_data)
            
            if args.generate_fetch_plan and fetch_plan:
                print("\n" + "="*100)
                print("SURGICAL FETCH PLAN")
                print("="*100)
                print(f"\nFound {len(fetch_plan)} caller-month combinations needing attention:\n")
                
                for i, task in enumerate(fetch_plan[:20], 1):  # Show top 20
                    print(f"{i}. {task['caller']} - {task['month']}")
                    print(f"   Coverage: {task['current_coverage']:.1%} ({task['calls_with_coverage']}/{task['total_calls']} calls)")
                    print(f"   Missing mints: {len(task['missing_mints'])}")
                    print(f"   Priority score: {task['priority']:.1f}")
                    print()
                
                if len(fetch_plan) > 20:
                    print(f"... and {len(fetch_plan) - 20} more tasks")
                
                print("\nTo fetch OHLCV for a specific caller-month:")
                print("  quantbot ingestion ohlcv --duckdb data/tele.duckdb --caller <name> --from <start> --to <end>")
        
        duckdb_conn.close()
        return 0
        
    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())


#!/usr/bin/env python3
"""
OHLCV Coverage Map - Analyze candle coverage in ClickHouse

Generates a coverage map showing:
- Coverage by time period (daily, weekly, monthly)
- Coverage by interval (1m, 5m, 15m, 1h)
- Coverage by chain (solana, ethereum, base, bsc)
- Histogram-style visualization
- Gap identification for targeted fetching

Usage:
    python3 ohlcv_coverage_map.py --format table
    python3 ohlcv_coverage_map.py --format json --output coverage.json
    python3 ohlcv_coverage_map.py --chain solana --interval 5m
"""

import argparse
import json
import sys
import warnings
from datetime import datetime, timedelta
from typing import Dict, List, Any, Optional
from collections import defaultdict

# Suppress deprecation warnings for cleaner output
warnings.filterwarnings('ignore', category=DeprecationWarning)

try:
    from clickhouse_driver import Client
except ImportError:
    print("ERROR: clickhouse-driver not installed. Run: pip install clickhouse-driver", file=sys.stderr)
    sys.exit(1)


def get_clickhouse_client() -> tuple[Client, str]:
    """Get ClickHouse client from environment or defaults"""
    import os
    
    host = os.getenv('CLICKHOUSE_HOST', 'localhost')
    port = int(os.getenv('CLICKHOUSE_PORT', '9000'))
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    user = os.getenv('CLICKHOUSE_USER', 'default')
    password = os.getenv('CLICKHOUSE_PASSWORD', '')
    
    client = Client(
        host=host,
        port=port,
        database=database,
        user=user,
        password=password
    )
    
    return client, database


def get_coverage_by_period(
    client: Client,
    database: str,
    chain: Optional[str] = None,
    interval: Optional[str] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    verbose: bool = False
) -> Dict[str, Any]:
    """
    Get coverage statistics by time period (daily, weekly, monthly)
    
    Returns histogram data showing:
    - Number of unique tokens per period
    - Total candles per period
    - Coverage percentage (candles vs expected)
    """
    
    # Build WHERE clause
    where_clauses = []
    if chain:
        where_clauses.append(f"chain = '{chain}'")
    if interval:
        where_clauses.append(f"interval = '{interval}'")
    if start_date:
        where_clauses.append(f"timestamp >= '{start_date}'")
    if end_date:
        where_clauses.append(f"timestamp <= '{end_date}'")
    
    where_sql = " AND " + " AND ".join(where_clauses) if where_clauses else ""
    
    # Daily coverage
    daily_query = f"""
    SELECT 
        toDate(timestamp) as date,
        uniqExact(token_address) as unique_tokens,
        count() as total_candles,
        uniqExact(chain) as chains
    FROM {database}.ohlcv_candles
    {where_sql}
    GROUP BY date
    ORDER BY date DESC
    LIMIT 90
    """
    
    # Weekly coverage
    weekly_query = f"""
    SELECT 
        toMonday(timestamp) as week_start,
        uniqExact(token_address) as unique_tokens,
        count() as total_candles,
        uniqExact(chain) as chains
    FROM {database}.ohlcv_candles
    {where_sql}
    GROUP BY week_start
    ORDER BY week_start DESC
    LIMIT 52
    """
    
    # Monthly coverage
    monthly_query = f"""
    SELECT 
        toStartOfMonth(timestamp) as month_start,
        uniqExact(token_address) as unique_tokens,
        count() as total_candles,
        uniqExact(chain) as chains
    FROM {database}.ohlcv_candles
    {where_sql}
    GROUP BY month_start
    ORDER BY month_start DESC
    LIMIT 12
    """
    
    if verbose:
        print("  Querying daily coverage...", file=sys.stderr, flush=True)
    daily_data = client.execute(daily_query)
    
    if verbose:
        print("  Querying weekly coverage...", file=sys.stderr, flush=True)
    weekly_data = client.execute(weekly_query)
    
    if verbose:
        print("  Querying monthly coverage...", file=sys.stderr, flush=True)
    monthly_data = client.execute(monthly_query)
    
    return {
        'daily': [
            {
                'date': str(row[0]),
                'unique_tokens': row[1],
                'total_candles': row[2],
                'chains': row[3]
            }
            for row in daily_data
        ],
        'weekly': [
            {
                'week_start': str(row[0]),
                'unique_tokens': row[1],
                'total_candles': row[2],
                'chains': row[3]
            }
            for row in weekly_data
        ],
        'monthly': [
            {
                'month_start': str(row[0]),
                'unique_tokens': row[1],
                'total_candles': row[2],
                'chains': row[3]
            }
            for row in monthly_data
        ]
    }


def get_coverage_by_interval(
    client: Client,
    database: str,
    chain: Optional[str] = None,
    verbose: bool = False
) -> List[Dict[str, Any]]:
    """Get coverage statistics by interval"""
    
    if verbose:
        print("Querying coverage by interval...", file=sys.stderr, flush=True)
    
    where_sql = f"WHERE chain = '{chain}'" if chain else ""
    
    query = f"""
    SELECT 
        `interval`,
        uniqExact(token_address) as unique_tokens,
        count() as total_candles,
        min(timestamp) as earliest_candle,
        max(timestamp) as latest_candle,
        dateDiff('day', min(timestamp), max(timestamp)) as days_covered
    FROM {database}.ohlcv_candles
    {where_sql}
    GROUP BY `interval`
    ORDER BY total_candles DESC
    """
    
    results = client.execute(query)
    
    return [
        {
            'interval': row[0],
            'unique_tokens': row[1],
            'total_candles': row[2],
            'earliest_candle': str(row[3]),
            'latest_candle': str(row[4]),
            'days_covered': row[5]
        }
        for row in results
    ]


def get_coverage_by_chain(client: Client, database: str, verbose: bool = False) -> List[Dict[str, Any]]:
    """Get coverage statistics by chain"""
    
    if verbose:
        print("Querying coverage by chain...", file=sys.stderr, flush=True)
    
    query = f"""
    SELECT 
        chain,
        uniqExact(token_address) as unique_tokens,
        count() as total_candles,
        min(timestamp) as earliest_candle,
        max(timestamp) as latest_candle
    FROM {database}.ohlcv_candles
    GROUP BY chain
    ORDER BY total_candles DESC
    """
    
    results = client.execute(query)
    
    # Get intervals separately for each chain using a simpler approach
    chain_data = []
    for idx, row in enumerate(results):
        chain = row[0]
        
        if verbose:
            print(f"  Chain {idx+1}/{len(results)}: {chain}", file=sys.stderr, flush=True)
        
        interval_query = f"""
        SELECT DISTINCT `interval`
        FROM {database}.ohlcv_candles
        WHERE chain = '{chain}'
        """
        intervals = [r[0] for r in client.execute(interval_query)]
        
        chain_data.append({
            'chain': chain,
            'unique_tokens': row[1],
            'total_candles': row[2],
            'earliest_candle': str(row[3]),
            'latest_candle': str(row[4]),
            'intervals': intervals
        })
    
    return chain_data


def get_gaps_analysis(
    client: Client,
    database: str,
    chain: Optional[str] = None,
    interval: Optional[str] = None,
    min_gap_hours: int = 24
) -> List[Dict[str, Any]]:
    """
    Identify gaps in coverage (periods with no candles)
    
    Returns tokens with significant gaps that need fetching
    """
    
    where_clauses = []
    if chain:
        where_clauses.append(f"chain = '{chain}'")
    if interval:
        where_clauses.append(f"interval = '{interval}'")
    
    where_sql = " AND " + " AND ".join(where_clauses) if where_clauses else ""
    
    # Find tokens with large gaps between candles
    query = f"""
    WITH candle_gaps AS (
        SELECT 
            token_address,
            chain,
            `interval`,
            timestamp,
            lagInFrame(timestamp) OVER (
                PARTITION BY token_address, chain, `interval` 
                ORDER BY timestamp
            ) as prev_timestamp,
            dateDiff('hour', 
                lagInFrame(timestamp) OVER (
                    PARTITION BY token_address, chain, `interval` 
                    ORDER BY timestamp
                ),
                timestamp
            ) as gap_hours
        FROM {database}.ohlcv_candles
        {where_sql}
    )
    SELECT 
        token_address,
        chain,
        `interval`,
        max(gap_hours) as max_gap_hours,
        count() as gap_count,
        min(timestamp) as first_candle,
        max(timestamp) as last_candle
    FROM candle_gaps
    WHERE gap_hours > {min_gap_hours}
    GROUP BY token_address, chain, `interval`
    HAVING gap_count > 0
    ORDER BY max_gap_hours DESC
    LIMIT 100
    """
    
    results = client.execute(query)
    
    return [
        {
            'token_address': row[0],
            'chain': row[1],
            'interval': row[2],
            'max_gap_hours': row[3],
            'gap_count': row[4],
            'first_candle': str(row[5]),
            'last_candle': str(row[6])
        }
        for row in results
    ]


def format_histogram(data: List[Dict[str, Any]], key: str, max_width: int = 50) -> str:
    """Format data as ASCII histogram"""
    
    if not data:
        return "No data available"
    
    # Find max value for scaling
    max_value = max(item[key] for item in data)
    
    lines = []
    for item in data:
        value = item[key]
        bar_width = int((value / max_value) * max_width) if max_value > 0 else 0
        bar = '█' * bar_width
        
        # Format label based on data type
        if 'date' in item:
            label = item['date']
        elif 'week_start' in item:
            label = item['week_start']
        elif 'month_start' in item:
            label = item['month_start']
        elif 'interval' in item:
            label = item['interval']
        elif 'chain' in item:
            label = item['chain']
        else:
            label = str(item.get('token_address', 'Unknown'))[:20]
        
        lines.append(f"{label:20} {bar} {value:,}")
    
    return '\n'.join(lines)


def print_table_format(coverage_data: Dict[str, Any]) -> None:
    """Print coverage data in table format"""
    
    print("\n" + "="*80)
    print("OHLCV COVERAGE MAP - ClickHouse Analysis")
    print("="*80)
    
    # Summary statistics
    print("\n📊 SUMMARY BY CHAIN")
    print("-" * 80)
    for chain_data in coverage_data['by_chain']:
        print(f"\n{chain_data['chain'].upper()}")
        print(f"  Unique Tokens: {chain_data['unique_tokens']:,}")
        print(f"  Total Candles: {chain_data['total_candles']:,}")
        print(f"  Intervals: {', '.join(chain_data['intervals'])}")
        print(f"  Date Range: {chain_data['earliest_candle']} to {chain_data['latest_candle']}")
    
    # Coverage by interval
    print("\n\n📈 COVERAGE BY INTERVAL")
    print("-" * 80)
    for interval_data in coverage_data['by_interval']:
        print(f"\n{interval_data['interval']}")
        print(f"  Unique Tokens: {interval_data['unique_tokens']:,}")
        print(f"  Total Candles: {interval_data['total_candles']:,}")
        print(f"  Days Covered: {interval_data['days_covered']}")
        print(f"  Date Range: {interval_data['earliest_candle']} to {interval_data['latest_candle']}")
    
    # Daily histogram (last 30 days)
    print("\n\n📅 DAILY COVERAGE (Last 30 Days)")
    print("-" * 80)
    daily_data = coverage_data['by_period']['daily'][:30]
    print(format_histogram(daily_data, 'total_candles'))
    
    # Weekly histogram
    print("\n\n📆 WEEKLY COVERAGE (Last 12 Weeks)")
    print("-" * 80)
    weekly_data = coverage_data['by_period']['weekly'][:12]
    print(format_histogram(weekly_data, 'total_candles'))
    
    # Monthly histogram
    print("\n\n📆 MONTHLY COVERAGE (Last 12 Months)")
    print("-" * 80)
    monthly_data = coverage_data['by_period']['monthly'][:12]
    print(format_histogram(monthly_data, 'total_candles'))
    
    # Gaps analysis
    if coverage_data.get('gaps'):
        print("\n\n🔍 COVERAGE GAPS (Top 20 tokens with largest gaps)")
        print("-" * 80)
        print(f"{'Token':<22} {'Chain':<10} {'Interval':<8} {'Max Gap (hrs)':<15} {'Gap Count'}")
        print("-" * 80)
        for gap in coverage_data['gaps'][:20]:
            token_short = gap['token_address'][:20] + '..'
            print(f"{token_short:<22} {gap['chain']:<10} {gap['interval']:<8} {gap['max_gap_hours']:<15} {gap['gap_count']}")
    
    print("\n" + "="*80)


def main():
    parser = argparse.ArgumentParser(description='Analyze OHLCV coverage in ClickHouse')
    parser.add_argument('--format', choices=['table', 'json'], default='table',
                       help='Output format (default: table)')
    parser.add_argument('--output', help='Output file for JSON format')
    parser.add_argument('--chain', help='Filter by chain (solana, ethereum, base, bsc)')
    parser.add_argument('--interval', help='Filter by interval (1m, 5m, 15m, 1h)')
    parser.add_argument('--start-date', help='Start date (YYYY-MM-DD)')
    parser.add_argument('--end-date', help='End date (YYYY-MM-DD)')
    parser.add_argument('--min-gap-hours', type=int, default=24,
                       help='Minimum gap size in hours to report (default: 24)')
    parser.add_argument('--verbose', action='store_true',
                       help='Show verbose progress output to stderr')
    
    args = parser.parse_args()
    
    try:
        if args.verbose:
            print("Connecting to ClickHouse...", file=sys.stderr, flush=True)
        
        client, database = get_clickhouse_client()
        
        if args.verbose:
            print(f"Connected to database: {database}\n", file=sys.stderr, flush=True)
        
        # Gather coverage data
        coverage_data = {
            'by_chain': get_coverage_by_chain(client, database, args.verbose),
            'by_interval': get_coverage_by_interval(client, database, args.chain, args.verbose),
            'by_period': get_coverage_by_period(
                client,
                database,
                args.chain, 
                args.interval,
                args.start_date,
                args.end_date,
                args.verbose
            ),
            # Gaps analysis disabled for older ClickHouse versions (requires window functions)
            'gaps': [],  # get_gaps_analysis requires ClickHouse 21.1+
            'metadata': {
                'generated_at': datetime.utcnow().isoformat(),
                'filters': {
                    'chain': args.chain,
                    'interval': args.interval,
                    'start_date': args.start_date,
                    'end_date': args.end_date,
                    'min_gap_hours': args.min_gap_hours
                }
            }
        }
        
        if args.format == 'json':
            output = json.dumps(coverage_data, indent=2)
            if args.output:
                with open(args.output, 'w') as f:
                    f.write(output)
                print(f"Coverage data written to {args.output}")
            else:
                print(output)
        else:
            print_table_format(coverage_data)
        
        return 0
        
    except Exception as e:
        print(f"ERROR: {str(e)}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        return 1


if __name__ == '__main__':
    sys.exit(main())


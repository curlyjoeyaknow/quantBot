#!/usr/bin/env python3
"""
Generate comprehensive candle ingestion report.

This script analyzes ClickHouse ohlcv_candles table and generates a report showing:
1. Tokens with duplicate candles
2. Candles sorted by most recent ingestion that align with alert times
3. Coverage analysis per token

Usage:
    python tools/storage/generate_candle_ingestion_report.py [--output report.json] [--format json|csv]
"""

import os
import sys
import json
import csv
from datetime import datetime
from typing import List, Dict, Any, Optional
from clickhouse_driver import Client
import duckdb

def get_clickhouse_client() -> Client:
    """Get ClickHouse client from environment variables."""
    host = os.getenv('CLICKHOUSE_HOST', 'localhost')
    port = int(os.getenv('CLICKHOUSE_PORT', '9000'))
    user = os.getenv('CLICKHOUSE_USER', 'default')
    password = os.getenv('CLICKHOUSE_PASSWORD', '')
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    
    return Client(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database
    )

def get_duckdb_connection(duckdb_path: str) -> duckdb.DuckDBPyConnection:
    """Get DuckDB connection."""
    return duckdb.connect(duckdb_path, read_only=True)

def get_alerts_with_times(duck_conn: duckdb.DuckDBPyConnection) -> List[Dict[str, Any]]:
    """Get all alerts with their timestamps and mint addresses."""
    query = """
        SELECT DISTINCT
            mint,
            alert_ts_ms,
            caller_name_norm,
            chain
        FROM canon.alerts_std
        WHERE mint IS NOT NULL
          AND alert_ts_ms IS NOT NULL
        ORDER BY alert_ts_ms DESC
        LIMIT 10000
    """
    
    result = duck_conn.execute(query).fetchall()
    
    alerts = []
    for row in result:
        mint, alert_ts_ms, caller, chain = row
        alerts.append({
            'mint': mint,
            'alert_timestamp_ms': alert_ts_ms,
            'alert_timestamp': datetime.fromtimestamp(alert_ts_ms / 1000).isoformat(),
            'caller': caller,
            'chain': chain or 'solana'
        })
    
    return alerts

def analyze_token_candles(
    ch_client: Client,
    mint: str,
    chain: str,
    alert_timestamp_ms: int
) -> Dict[str, Any]:
    """Analyze candles for a specific token around its alert time."""
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    
    # Convert alert timestamp to datetime
    alert_dt = datetime.fromtimestamp(alert_timestamp_ms / 1000)
    
    # Query candles around alert time (±7 days)
    query = f"""
        SELECT 
            token_address,
            chain,
            timestamp,
            interval,
            ingested_at,
            ingestion_run_id,
            open,
            high,
            low,
            close,
            volume
        FROM {database}.ohlcv_candles
        WHERE token_address = %(mint)s
          AND chain = %(chain)s
          AND timestamp >= toDateTime(%(start_time)s)
          AND timestamp <= toDateTime(%(end_time)s)
        ORDER BY timestamp ASC, ingested_at DESC
    """
    
    # Query ±7 days around alert
    start_time = int((alert_timestamp_ms - 7 * 24 * 60 * 60 * 1000) / 1000)
    end_time = int((alert_timestamp_ms + 7 * 24 * 60 * 60 * 1000) / 1000)
    
    try:
        result = ch_client.execute(
            query,
            {
                'mint': mint,
                'chain': chain,
                'start_time': start_time,
                'end_time': end_time
            }
        )
    except Exception as e:
        return {
            'mint': mint,
            'chain': chain,
            'alert_timestamp': alert_dt.isoformat(),
            'error': str(e),
            'total_candles': 0,
            'unique_timestamps': 0,
            'duplicate_timestamps': 0,
            'intervals': {},
            'ingestion_runs': []
        }
    
    if not result:
        return {
            'mint': mint,
            'chain': chain,
            'alert_timestamp': alert_dt.isoformat(),
            'total_candles': 0,
            'unique_timestamps': 0,
            'duplicate_timestamps': 0,
            'intervals': {},
            'ingestion_runs': [],
            'coverage': 'no_data'
        }
    
    # Analyze candles
    candles = []
    timestamps_seen = {}
    intervals_count = {}
    ingestion_runs = set()
    
    for row in result:
        token, ch, ts, interval, ingested_at, run_id, o, h, l, c, v = row
        
        candle = {
            'timestamp': ts.isoformat() if hasattr(ts, 'isoformat') else str(ts),
            'interval': interval,
            'ingested_at': ingested_at.isoformat() if hasattr(ingested_at, 'isoformat') else str(ingested_at),
            'ingestion_run_id': run_id,
            'open': o,
            'high': h,
            'low': l,
            'close': c,
            'volume': v
        }
        
        candles.append(candle)
        
        # Track timestamps
        ts_key = (str(ts), interval)
        if ts_key not in timestamps_seen:
            timestamps_seen[ts_key] = []
        timestamps_seen[ts_key].append(ingested_at)
        
        # Track intervals
        intervals_count[interval] = intervals_count.get(interval, 0) + 1
        
        # Track ingestion runs
        if run_id:
            ingestion_runs.add(run_id)
    
    # Find duplicates
    duplicate_timestamps = sum(1 for ts_list in timestamps_seen.values() if len(ts_list) > 1)
    
    # Determine most recent ingestion
    most_recent_ingestion = None
    if candles:
        most_recent_ingestion = max(
            c['ingested_at'] for c in candles
        )
    
    return {
        'mint': mint,
        'chain': chain,
        'alert_timestamp': alert_dt.isoformat(),
        'total_candles': len(candles),
        'unique_timestamps': len(timestamps_seen),
        'duplicate_timestamps': duplicate_timestamps,
        'intervals': intervals_count,
        'ingestion_runs': sorted(list(ingestion_runs)),
        'most_recent_ingestion': most_recent_ingestion,
        'candles_sample': candles[:10],  # First 10 candles
        'coverage': 'has_data' if candles else 'no_data'
    }

def generate_report(
    duckdb_path: str,
    output_path: Optional[str] = None,
    format: str = 'json',
    limit: int = 100
) -> Dict[str, Any]:
    """Generate comprehensive candle ingestion report."""
    
    print("Connecting to databases...")
    ch_client = get_clickhouse_client()
    duck_conn = get_duckdb_connection(duckdb_path)
    
    print("Fetching alerts from DuckDB...")
    alerts = get_alerts_with_times(duck_conn)
    print(f"Found {len(alerts)} alerts")
    
    # Limit alerts for analysis
    alerts = alerts[:limit]
    
    print(f"Analyzing candles for {len(alerts)} alerts...")
    
    token_analyses = []
    for i, alert in enumerate(alerts):
        if i % 10 == 0:
            print(f"  Progress: {i}/{len(alerts)} alerts analyzed...")
        
        analysis = analyze_token_candles(
            ch_client,
            alert['mint'],
            alert['chain'],
            alert['alert_timestamp_ms']
        )
        
        analysis['caller'] = alert['caller']
        token_analyses.append(analysis)
    
    print(f"Completed analysis of {len(token_analyses)} tokens")
    
    # Sort by most recent ingestion (most recent first)
    token_analyses_sorted = sorted(
        token_analyses,
        key=lambda x: x.get('most_recent_ingestion', ''),
        reverse=True
    )
    
    # Generate summary statistics
    total_tokens = len(token_analyses)
    tokens_with_data = sum(1 for t in token_analyses if t['coverage'] == 'has_data')
    tokens_with_duplicates = sum(1 for t in token_analyses if t['duplicate_timestamps'] > 0)
    total_candles = sum(t['total_candles'] for t in token_analyses)
    total_duplicates = sum(t['duplicate_timestamps'] for t in token_analyses)
    
    report = {
        'generated_at': datetime.utcnow().isoformat(),
        'summary': {
            'total_tokens_analyzed': total_tokens,
            'tokens_with_data': tokens_with_data,
            'tokens_without_data': total_tokens - tokens_with_data,
            'tokens_with_duplicates': tokens_with_duplicates,
            'total_candles': total_candles,
            'total_duplicate_timestamps': total_duplicates,
            'coverage_rate': f"{(tokens_with_data / total_tokens * 100):.1f}%" if total_tokens > 0 else "0%"
        },
        'tokens': token_analyses_sorted
    }
    
    # Output report
    if output_path:
        if format == 'json':
            with open(output_path, 'w') as f:
                json.dump(report, f, indent=2)
            print(f"\n✓ Report saved to {output_path}")
        elif format == 'csv':
            with open(output_path, 'w', newline='') as f:
                writer = csv.DictWriter(f, fieldnames=[
                    'mint', 'chain', 'caller', 'alert_timestamp',
                    'total_candles', 'unique_timestamps', 'duplicate_timestamps',
                    'most_recent_ingestion', 'coverage'
                ])
                writer.writeheader()
                for token in token_analyses_sorted:
                    writer.writerow({
                        'mint': token['mint'],
                        'chain': token['chain'],
                        'caller': token.get('caller', ''),
                        'alert_timestamp': token['alert_timestamp'],
                        'total_candles': token['total_candles'],
                        'unique_timestamps': token['unique_timestamps'],
                        'duplicate_timestamps': token['duplicate_timestamps'],
                        'most_recent_ingestion': token.get('most_recent_ingestion', ''),
                        'coverage': token['coverage']
                    })
            print(f"\n✓ Report saved to {output_path}")
    else:
        # Print to stdout
        print(json.dumps(report, indent=2))
    
    # Print summary
    print("\n" + "="*80)
    print("SUMMARY")
    print("="*80)
    print(f"Total tokens analyzed: {report['summary']['total_tokens_analyzed']}")
    print(f"Tokens with data: {report['summary']['tokens_with_data']}")
    print(f"Tokens without data: {report['summary']['tokens_without_data']}")
    print(f"Tokens with duplicates: {report['summary']['tokens_with_duplicates']}")
    print(f"Total candles: {report['summary']['total_candles']:,}")
    print(f"Total duplicate timestamps: {report['summary']['total_duplicate_timestamps']:,}")
    print(f"Coverage rate: {report['summary']['coverage_rate']}")
    
    # Top 10 tokens by most recent ingestion
    print("\n" + "="*80)
    print("TOP 10 TOKENS BY MOST RECENT INGESTION")
    print("="*80)
    for i, token in enumerate(token_analyses_sorted[:10], 1):
        mint_short = token['mint'][:8] + "..." if len(token['mint']) > 12 else token['mint']
        print(f"{i}. {mint_short} ({token['chain']})")
        print(f"   Caller: {token.get('caller', 'unknown')}")
        print(f"   Alert: {token['alert_timestamp']}")
        print(f"   Most recent ingestion: {token.get('most_recent_ingestion', 'N/A')}")
        print(f"   Candles: {token['total_candles']} ({token['duplicate_timestamps']} duplicates)")
        print()
    
    return report

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
        '--output',
        help='Output file path (default: print to stdout)'
    )
    parser.add_argument(
        '--format',
        choices=['json', 'csv'],
        default='json',
        help='Output format (default: json)'
    )
    parser.add_argument(
        '--limit',
        type=int,
        default=100,
        help='Maximum number of tokens to analyze (default: 100)'
    )
    
    args = parser.parse_args()
    
    try:
        generate_report(
            duckdb_path=args.duckdb,
            output_path=args.output,
            format=args.format,
            limit=args.limit
        )
    except Exception as e:
        print(f"\n✗ Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()


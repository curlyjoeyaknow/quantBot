#!/usr/bin/env python3
"""
Analyze candle data quality and generate re-ingestion worklist.

Identifies tokens with:
1. Duplicate candles (same timestamp, multiple entries)
2. Gaps in candle data (missing expected timestamps)
3. Price distortions (suspicious price jumps, zero/negative values)
4. Volume anomalies (zero volume, extreme spikes)
5. Inconsistent OHLC relationships (close > high, open < low, etc.)

Generates a prioritized worklist for re-ingestion.

Usage:
    python tools/storage/analyze_candle_quality.py [--output worklist.json] [--duckdb data/alerts.duckdb]
"""

import os
import sys
import json
import csv
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Tuple
from clickhouse_driver import Client
import duckdb
from collections import defaultdict

def get_clickhouse_client() -> Client:
    """Get ClickHouse client from environment variables."""
    host = os.getenv('CLICKHOUSE_HOST', 'localhost')
    port = int(os.getenv('CLICKHOUSE_PORT', '9000'))
    user = os.getenv('CLICKHOUSE_USER', 'default')
    password = os.getenv('CLICKHOUSE_PASSWORD', '')
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    
    print(f"Connecting to ClickHouse: {host}:{port} as {user} (database: {database})")
    
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

def get_tokens_with_alerts(duck_conn: duckdb.DuckDBPyConnection, limit: Optional[int] = None) -> List[Dict[str, Any]]:
    """Get tokens that have alerts (candidates for analysis)."""
    limit_clause = f"LIMIT {limit}" if limit else ""
    
    query = f"""
        SELECT DISTINCT
            mint,
            chain,
            COUNT(DISTINCT alert_ts_ms) as alert_count,
            MIN(alert_ts_ms) as first_alert_ms,
            MAX(alert_ts_ms) as last_alert_ms,
            list(DISTINCT caller_name_norm) FILTER (WHERE caller_name_norm IS NOT NULL) as callers
        FROM canon.alerts_std
        WHERE mint IS NOT NULL
          AND alert_ts_ms IS NOT NULL
        GROUP BY mint, chain
        ORDER BY alert_count DESC, last_alert_ms DESC
        {limit_clause}
    """
    
    result = duck_conn.execute(query).fetchall()
    
    tokens = []
    for row in result:
        mint, chain, alert_count, first_alert_ms, last_alert_ms, callers = row
        tokens.append({
            'mint': mint,
            'chain': chain or 'solana',
            'alert_count': alert_count,
            'first_alert': datetime.fromtimestamp(first_alert_ms / 1000).isoformat(),
            'last_alert': datetime.fromtimestamp(last_alert_ms / 1000).isoformat(),
            'callers': callers
        })
    
    return tokens

def analyze_token_duplicates(ch_client: Client, mint: str, chain: str) -> Dict[str, Any]:
    """Analyze duplicate candles for a token."""
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    
    # Check if ingested_at column exists
    try:
        ch_client.execute(f"SELECT ingested_at FROM {database}.ohlcv_candles LIMIT 1")
        has_ingested_at = True
    except Exception:
        has_ingested_at = False
    
    if has_ingested_at:
        query = f"""
            SELECT 
                timestamp,
                interval_seconds,
                count() as duplicate_count,
                groupArray(ingested_at) as ingestion_times,
                groupArray(open) as opens,
                groupArray(close) as closes,
                groupArray(volume) as volumes
            FROM {database}.ohlcv_candles
            WHERE token_address = %(mint)s
              AND chain = %(chain)s
            GROUP BY timestamp, interval_seconds
            HAVING duplicate_count > 1
            ORDER BY duplicate_count DESC, timestamp DESC
            LIMIT 100
        """
    else:
        # Fallback: no ingestion metadata, just check for duplicates
        query = f"""
            SELECT 
                timestamp,
                interval_seconds,
                count() as duplicate_count,
                groupArray(open) as opens,
                groupArray(close) as closes,
                groupArray(volume) as volumes
            FROM {database}.ohlcv_candles
            WHERE token_address = %(mint)s
              AND chain = %(chain)s
            GROUP BY timestamp, interval_seconds
            HAVING duplicate_count > 1
            ORDER BY duplicate_count DESC, timestamp DESC
            LIMIT 100
        """
    
    try:
        result = ch_client.execute(query, {'mint': mint, 'chain': chain})
    except Exception as e:
        return {
            'has_duplicates': False,
            'duplicate_count': 0,
            'error': str(e)
        }
    
    if not result:
        return {
            'has_duplicates': False,
            'duplicate_count': 0
        }
    
    duplicates = []
    for row in result:
        if has_ingested_at:
            ts, interval_sec, dup_count, ing_times, opens, closes, volumes = row
        else:
            ts, interval_sec, dup_count, opens, closes, volumes = row
            ing_times = []
        
        # Convert interval_seconds to string format
        interval_map = {1: '1s', 15: '15s', 60: '1m', 300: '5m', 900: '15m', 3600: '1h', 14400: '4h', 86400: '1d'}
        interval_str = interval_map.get(interval_sec, f'{interval_sec}s')
        
        # Check if values differ (true duplicates vs. re-ingestion of same data)
        values_differ = (
            len(set(opens)) > 1 or
            len(set(closes)) > 1 or
            len(set(volumes)) > 1
        )
        
        duplicates.append({
            'timestamp': ts.isoformat() if hasattr(ts, 'isoformat') else str(ts),
            'interval': interval_str,
            'duplicate_count': dup_count,
            'values_differ': values_differ,
            'ingestion_times': [t.isoformat() if hasattr(t, 'isoformat') else str(t) for t in ing_times] if ing_times else [],
            'price_range': f"{min(opens):.10f} - {max(closes):.10f}" if opens and closes else None
        })
    
    return {
        'has_duplicates': True,
        'duplicate_count': len(duplicates),
        'total_duplicate_timestamps': sum(d['duplicate_count'] for d in duplicates),
        'duplicates_with_different_values': sum(1 for d in duplicates if d['values_differ']),
        'sample_duplicates': duplicates[:10]
    }

def analyze_token_gaps(ch_client: Client, mint: str, chain: str, interval: str = '5m') -> Dict[str, Any]:
    """Analyze gaps in candle data."""
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    
    # Convert interval string to seconds
    interval_seconds = {
        '1s': 1,
        '15s': 15,
        '1m': 60,
        '5m': 300,
        '15m': 900,
        '1h': 3600,
        '4h': 14400,
        '1d': 86400
    }.get(interval, 300)
    
    # Get all candles for this token/interval
    query = f"""
        SELECT 
            timestamp,
            open,
            high,
            low,
            close,
            volume
        FROM {database}.ohlcv_candles
        WHERE token_address = %(mint)s
          AND chain = %(chain)s
          AND interval_seconds = %(interval_seconds)s
        ORDER BY timestamp ASC
    """
    
    try:
        result = ch_client.execute(query, {'mint': mint, 'chain': chain, 'interval': interval})
    except Exception as e:
        return {
            'has_gaps': False,
            'gap_count': 0,
            'error': str(e)
        }
    
    if len(result) < 2:
        return {
            'has_gaps': False,
            'gap_count': 0,
            'total_candles': len(result),
            'reason': 'insufficient_data'
        }
    
    # Calculate expected interval in seconds
    interval_seconds = {
        '1s': 1,
        '15s': 15,
        '1m': 60,
        '5m': 300,
        '15m': 900,
        '1h': 3600,
        '4h': 14400,
        '1d': 86400
    }.get(interval, 300)
    
    gaps = []
    prev_ts = None
    
    for row in result:
        ts = row[0]
        
        if prev_ts is not None:
            # Calculate time difference
            if hasattr(ts, 'timestamp') and hasattr(prev_ts, 'timestamp'):
                diff_seconds = (ts.timestamp() - prev_ts.timestamp())
            else:
                # Fallback for different datetime types
                diff_seconds = (ts - prev_ts).total_seconds() if hasattr(ts, 'total_seconds') else 0
            
            expected_diff = interval_seconds
            
            # Allow 10% tolerance for timing variations
            if diff_seconds > expected_diff * 1.1:
                missing_candles = int(diff_seconds / interval_seconds) - 1
                
                gaps.append({
                    'start': prev_ts.isoformat() if hasattr(prev_ts, 'isoformat') else str(prev_ts),
                    'end': ts.isoformat() if hasattr(ts, 'isoformat') else str(ts),
                    'gap_seconds': int(diff_seconds),
                    'missing_candles': missing_candles
                })
        
        prev_ts = ts
    
    return {
        'has_gaps': len(gaps) > 0,
        'gap_count': len(gaps),
        'total_candles': len(result),
        'total_missing_candles': sum(g['missing_candles'] for g in gaps),
        'largest_gap_seconds': max((g['gap_seconds'] for g in gaps), default=0),
        'sample_gaps': gaps[:10]
    }

def analyze_token_price_distortions(ch_client: Client, mint: str, chain: str, interval: str = '5m') -> Dict[str, Any]:
    """Analyze price distortions and anomalies."""
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    
    # Convert interval string to seconds
    interval_seconds = {
        '1s': 1,
        '15s': 15,
        '1m': 60,
        '5m': 300,
        '15m': 900,
        '1h': 3600,
        '4h': 14400,
        '1d': 86400
    }.get(interval, 300)
    
    query = f"""
        SELECT 
            timestamp,
            open,
            high,
            low,
            close,
            volume
        FROM {database}.ohlcv_candles
        WHERE token_address = %(mint)s
          AND chain = %(chain)s
          AND interval_seconds = %(interval_seconds)s
        ORDER BY timestamp ASC
    """
    
    try:
        result = ch_client.execute(query, {'mint': mint, 'chain': chain, 'interval_seconds': interval_seconds})
    except Exception as e:
        return {
            'has_distortions': False,
            'error': str(e)
        }
    
    if len(result) < 2:
        return {
            'has_distortions': False,
            'total_candles': len(result),
            'reason': 'insufficient_data'
        }
    
    distortions = []
    prev_close = None
    
    for row in result:
        ts, open_price, high, low, close, volume = row
        
        issues = []
        
        # Check OHLC consistency
        if high < low:
            issues.append('high_less_than_low')
        if open_price > high:
            issues.append('open_above_high')
        if open_price < low:
            issues.append('open_below_low')
        if close > high:
            issues.append('close_above_high')
        if close < low:
            issues.append('close_below_low')
        
        # Check for zero/negative values
        if open_price <= 0:
            issues.append('zero_or_negative_open')
        if high <= 0:
            issues.append('zero_or_negative_high')
        if low <= 0:
            issues.append('zero_or_negative_low')
        if close <= 0:
            issues.append('zero_or_negative_close')
        if volume < 0:
            issues.append('negative_volume')
        
        # Check for extreme price jumps (>10x or <0.1x from previous close)
        if prev_close is not None and prev_close > 0:
            price_ratio = open_price / prev_close
            if price_ratio > 10:
                issues.append(f'extreme_jump_up_{price_ratio:.1f}x')
            elif price_ratio < 0.1:
                issues.append(f'extreme_drop_down_{1/price_ratio:.1f}x')
        
        # Check for zero volume
        if volume == 0:
            issues.append('zero_volume')
        
        if issues:
            distortions.append({
                'timestamp': ts.isoformat() if hasattr(ts, 'isoformat') else str(ts),
                'open': open_price,
                'high': high,
                'low': low,
                'close': close,
                'volume': volume,
                'issues': issues
            })
        
        prev_close = close
    
    # Categorize distortions
    ohlc_inconsistencies = sum(1 for d in distortions if any('high' in i or 'low' in i or 'open' in i or 'close' in i for i in d['issues'] if not 'zero' in i and not 'negative' in i))
    zero_negative_values = sum(1 for d in distortions if any('zero' in i or 'negative' in i for i in d['issues']))
    extreme_jumps = sum(1 for d in distortions if any('extreme' in i for i in d['issues']))
    zero_volume_count = sum(1 for d in distortions if 'zero_volume' in d['issues'])
    
    return {
        'has_distortions': len(distortions) > 0,
        'total_distortions': len(distortions),
        'total_candles': len(result),
        'distortion_rate': len(distortions) / len(result) if result else 0,
        'ohlc_inconsistencies': ohlc_inconsistencies,
        'zero_negative_values': zero_negative_values,
        'extreme_jumps': extreme_jumps,
        'zero_volume_count': zero_volume_count,
        'sample_distortions': distortions[:10]
    }

def calculate_quality_score(analysis: Dict[str, Any]) -> Tuple[float, str]:
    """Calculate data quality score (0-100) and priority level."""
    score = 100.0
    
    # Deduct for duplicates
    if analysis.get('duplicates', {}).get('has_duplicates'):
        dup_count = analysis['duplicates'].get('duplicate_count', 0)
        dup_with_diff = analysis['duplicates'].get('duplicates_with_different_values', 0)
        score -= min(30, dup_count * 0.5)  # Max -30 points
        score -= min(20, dup_with_diff * 2)  # Extra penalty for different values
    
    # Deduct for gaps
    if analysis.get('gaps', {}).get('has_gaps'):
        gap_count = analysis['gaps'].get('gap_count', 0)
        missing_candles = analysis['gaps'].get('total_missing_candles', 0)
        score -= min(25, gap_count * 0.3)  # Max -25 points
        score -= min(15, missing_candles * 0.1)  # Extra penalty for missing data
    
    # Deduct for distortions
    if analysis.get('distortions', {}).get('has_distortions'):
        distortion_rate = analysis['distortions'].get('distortion_rate', 0)
        ohlc_issues = analysis['distortions'].get('ohlc_inconsistencies', 0)
        extreme_jumps = analysis['distortions'].get('extreme_jumps', 0)
        score -= min(30, distortion_rate * 100)  # Max -30 points
        score -= min(10, ohlc_issues * 1)  # Extra penalty for OHLC issues
        score -= min(10, extreme_jumps * 2)  # Extra penalty for extreme jumps
    
    score = max(0, score)
    
    # Determine priority
    if score < 50:
        priority = 'critical'
    elif score < 70:
        priority = 'high'
    elif score < 85:
        priority = 'medium'
    else:
        priority = 'low'
    
    return score, priority

def analyze_all_tokens(
    ch_client: Client,
    duck_conn: duckdb.DuckDBPyConnection,
    limit: Optional[int] = None,
    interval: str = '5m'
) -> List[Dict[str, Any]]:
    """Analyze all tokens and generate quality report."""
    
    print("Fetching tokens with alerts...")
    tokens = get_tokens_with_alerts(duck_conn, limit)
    print(f"Found {len(tokens)} tokens to analyze")
    
    results = []
    
    for i, token in enumerate(tokens):
        if i % 10 == 0:
            print(f"  Progress: {i}/{len(tokens)} tokens analyzed...")
        
        mint = token['mint']
        chain = token['chain']
        
        # Run all analyses
        duplicates = analyze_token_duplicates(ch_client, mint, chain)
        gaps = analyze_token_gaps(ch_client, mint, chain, interval)
        distortions = analyze_token_price_distortions(ch_client, mint, chain, interval)
        
        analysis = {
            'mint': mint,
            'chain': chain,
            'alert_count': token['alert_count'],
            'first_alert': token['first_alert'],
            'last_alert': token['last_alert'],
            'callers': token['callers'],
            'duplicates': duplicates,
            'gaps': gaps,
            'distortions': distortions
        }
        
        # Calculate quality score
        quality_score, priority = calculate_quality_score(analysis)
        analysis['quality_score'] = quality_score
        analysis['priority'] = priority
        
        # Determine if re-ingestion is needed
        needs_reingest = (
            duplicates.get('has_duplicates', False) or
            gaps.get('has_gaps', False) or
            distortions.get('has_distortions', False)
        )
        analysis['needs_reingest'] = needs_reingest
        
        results.append(analysis)
    
    print(f"Completed analysis of {len(results)} tokens")
    
    return results

def generate_worklist(results: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Generate prioritized re-ingestion worklist."""
    
    # Filter tokens that need re-ingestion
    worklist = [r for r in results if r['needs_reingest']]
    
    # Sort by priority (critical first) and quality score (lowest first)
    priority_order = {'critical': 0, 'high': 1, 'medium': 2, 'low': 3}
    worklist.sort(key=lambda x: (priority_order[x['priority']], x['quality_score']))
    
    # Generate summary statistics
    total_tokens = len(results)
    tokens_needing_reingest = len(worklist)
    
    by_priority = defaultdict(int)
    by_issue_type = defaultdict(int)
    
    for item in worklist:
        by_priority[item['priority']] += 1
        
        if item['duplicates'].get('has_duplicates'):
            by_issue_type['duplicates'] += 1
        if item['gaps'].get('has_gaps'):
            by_issue_type['gaps'] += 1
        if item['distortions'].get('has_distortions'):
            by_issue_type['distortions'] += 1
    
    return {
        'generated_at': datetime.utcnow().isoformat(),
        'summary': {
            'total_tokens_analyzed': total_tokens,
            'tokens_needing_reingest': tokens_needing_reingest,
            'reingest_rate': f"{(tokens_needing_reingest / total_tokens * 100):.1f}%" if total_tokens > 0 else "0%",
            'by_priority': dict(by_priority),
            'by_issue_type': dict(by_issue_type)
        },
        'worklist': worklist,
        'all_results': results
    }

def export_worklist_csv(worklist: List[Dict[str, Any]], output_path: str) -> None:
    """Export worklist to CSV format."""
    with open(output_path, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=[
            'priority', 'quality_score', 'mint', 'chain', 'alert_count',
            'has_duplicates', 'duplicate_count', 'has_gaps', 'gap_count',
            'has_distortions', 'distortion_count', 'callers'
        ])
        writer.writeheader()
        
        for item in worklist:
            # Handle callers field - filter out None values
            callers = item.get('callers', [])
            if callers is None:
                callers = []
            callers_str = ','.join(str(c) for c in callers if c is not None)
            
            writer.writerow({
                'priority': item['priority'],
                'quality_score': f"{item['quality_score']:.1f}",
                'mint': item['mint'],
                'chain': item['chain'],
                'alert_count': item['alert_count'],
                'has_duplicates': item['duplicates'].get('has_duplicates', False),
                'duplicate_count': item['duplicates'].get('duplicate_count', 0),
                'has_gaps': item['gaps'].get('has_gaps', False),
                'gap_count': item['gaps'].get('gap_count', 0),
                'has_distortions': item['distortions'].get('has_distortions', False),
                'distortion_count': item['distortions'].get('total_distortions', 0),
                'callers': callers_str
            })

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
        default='candle_quality_worklist.json',
        help='Output file path (default: candle_quality_worklist.json)'
    )
    parser.add_argument(
        '--csv',
        help='Also export worklist as CSV to this path'
    )
    parser.add_argument(
        '--limit',
        type=int,
        help='Maximum number of tokens to analyze (default: all)'
    )
    parser.add_argument(
        '--interval',
        default='5m',
        choices=['1s', '15s', '1m', '5m', '15m', '1h', '4h', '1d'],
        help='Candle interval to analyze (default: 5m)'
    )
    parser.add_argument(
        '--min-quality-score',
        type=float,
        default=0,
        help='Only include tokens with quality score below this threshold (default: 0 = all)'
    )
    
    args = parser.parse_args()
    
    try:
        print("Connecting to databases...")
        ch_client = get_clickhouse_client()
        duck_conn = get_duckdb_connection(args.duckdb)
        
        # Test connections
        ch_version = ch_client.execute("SELECT version()")[0][0]
        print(f"Connected to ClickHouse version: {ch_version}")
        
        # Analyze all tokens
        results = analyze_all_tokens(ch_client, duck_conn, args.limit, args.interval)
        
        # Generate worklist
        print("\nGenerating worklist...")
        report = generate_worklist(results)
        
        # Filter by quality score if specified
        if args.min_quality_score > 0:
            original_count = len(report['worklist'])
            report['worklist'] = [
                item for item in report['worklist']
                if item['quality_score'] < args.min_quality_score
            ]
            print(f"Filtered worklist: {len(report['worklist'])}/{original_count} tokens below quality score {args.min_quality_score}")
        
        # Save JSON report
        with open(args.output, 'w') as f:
            json.dump(report, f, indent=2)
        print(f"\n✓ Report saved to {args.output}")
        
        # Save CSV if requested
        if args.csv:
            export_worklist_csv(report['worklist'], args.csv)
            print(f"✓ CSV worklist saved to {args.csv}")
        
        # Print summary
        print("\n" + "="*80)
        print("CANDLE QUALITY ANALYSIS SUMMARY")
        print("="*80)
        print(f"Total tokens analyzed: {report['summary']['total_tokens_analyzed']}")
        print(f"Tokens needing re-ingestion: {report['summary']['tokens_needing_reingest']}")
        print(f"Re-ingestion rate: {report['summary']['reingest_rate']}")
        
        print("\nBy Priority:")
        for priority in ['critical', 'high', 'medium', 'low']:
            count = report['summary']['by_priority'].get(priority, 0)
            if count > 0:
                print(f"  {priority.upper()}: {count} tokens")
        
        print("\nBy Issue Type:")
        for issue_type, count in report['summary']['by_issue_type'].items():
            print(f"  {issue_type}: {count} tokens")
        
        # Show top 10 critical tokens
        critical_tokens = [t for t in report['worklist'] if t['priority'] == 'critical']
        if critical_tokens:
            print("\n" + "="*80)
            print("TOP 10 CRITICAL TOKENS (LOWEST QUALITY SCORES)")
            print("="*80)
            for i, token in enumerate(critical_tokens[:10], 1):
                mint_short = token['mint'][:8] + "..." if len(token['mint']) > 12 else token['mint']
                print(f"\n{i}. {mint_short} ({token['chain']})")
                print(f"   Quality Score: {token['quality_score']:.1f}/100")
                print(f"   Alerts: {token['alert_count']}")
                print(f"   Issues:")
                if token['duplicates'].get('has_duplicates'):
                    print(f"     - Duplicates: {token['duplicates']['duplicate_count']} timestamps")
                if token['gaps'].get('has_gaps'):
                    print(f"     - Gaps: {token['gaps']['gap_count']} gaps, {token['gaps']['total_missing_candles']} missing candles")
                if token['distortions'].get('has_distortions'):
                    print(f"     - Distortions: {token['distortions']['total_distortions']} candles ({token['distortions']['distortion_rate']*100:.1f}%)")
        
    except Exception as e:
        print(f"\n✗ Error: {e}", file=sys.stderr)
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == '__main__':
    main()


#!/usr/bin/env python3
"""
Test candle data quality in ClickHouse - zero volume analysis.

This script analyzes the ohlcv_candles_1m table to detect quality issues:
- Candles with 0 volume that have price movement (open/high/low/close differ)
- Reports percentages and quality scores

Usage:
    python tools/storage/test_candle_quality_zero_volume.py

Environment variables:
    CLICKHOUSE_HOST (default: localhost)
    CLICKHOUSE_PORT (default: 8123)
    CLICKHOUSE_USER (default: default)
    CLICKHOUSE_PASSWORD (default: empty)
    CLICKHOUSE_DATABASE (default: quantbot)
"""

import os
import sys
from typing import Dict, Any

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


def get_clickhouse_client():
    """Get ClickHouse client from environment or defaults."""
    host = os.getenv('CLICKHOUSE_HOST', 'localhost')
    port = int(os.getenv('CLICKHOUSE_PORT', '8123'))
    user = os.getenv('CLICKHOUSE_USER', 'default')
    password = os.getenv('CLICKHOUSE_PASSWORD', '')
    database = os.getenv('CLICKHOUSE_DATABASE', 'quantbot')
    
    print(f"Connecting to ClickHouse: {host}:{port} as {user} (database: {database})", file=sys.stderr)
    
    try:
        client = get_client(
            host=host,
            port=port,
            username=user,
            password=password,
            database=database
        )
        # Test connection
        client.command('SELECT 1')
        print("✓ Connected successfully\n", file=sys.stderr)
        return client, database
    except Exception as e:
        print(f"[error] Failed to connect to ClickHouse: {e}", file=sys.stderr)
        sys.exit(1)


def analyze_zero_volume_quality(client, database: str) -> Dict[str, Any]:
    """
    Analyze candles with zero volume for price movement quality issues.
    
    Returns:
        Dictionary with counts and percentages
    """
    print("Analyzing zero volume candles...", file=sys.stderr)
    
    # Query to get all zero-volume candles and check for price movement
    # Price movement means: open != high OR high != low OR low != close
    # OR any combination where prices differ
    
    query = f"""
        SELECT 
            count() as total_candles,
            countIf(volume = 0) as zero_volume_count,
            countIf(volume > 0) as has_volume_count,
            countIf(volume = 0 AND (
                open != high OR 
                high != low OR 
                low != close OR
                open != low OR
                open != close OR
                high != close
            )) as zero_volume_with_price_movement,
            countIf(volume = 0 AND (
                open = high AND 
                high = low AND 
                low = close
            )) as zero_volume_no_price_movement
        FROM {database}.ohlcv_candles_1m
    """
    
    try:
        result = client.query(query)
        row = result.result_rows[0]
        
        total_candles = row[0]
        zero_volume_count = row[1]
        has_volume_count = row[2]
        zero_volume_with_price_movement = row[3]
        zero_volume_no_price_movement = row[4]
        
        # Calculate percentages
        total_pct = 100.0
        
        if total_candles > 0:
            zero_volume_pct = (zero_volume_count / total_candles) * 100
            has_volume_pct = (has_volume_count / total_candles) * 100
            
            if zero_volume_count > 0:
                zero_volume_with_movement_pct = (zero_volume_with_price_movement / zero_volume_count) * 100
                zero_volume_no_movement_pct = (zero_volume_no_price_movement / zero_volume_count) * 100
            else:
                zero_volume_with_movement_pct = 0.0
                zero_volume_no_movement_pct = 0.0
            
            # Quality score: percentage of total candles that have price movement with 0 volume
            # This is bad quality - candles should not have price changes without volume
            bad_quality_pct = (zero_volume_with_price_movement / total_candles) * 100
            quality_score = 100.0 - bad_quality_pct
        else:
            zero_volume_pct = 0.0
            has_volume_pct = 0.0
            zero_volume_with_movement_pct = 0.0
            zero_volume_no_movement_pct = 0.0
            bad_quality_pct = 0.0
            quality_score = 100.0
        
        return {
            'total_candles': total_candles,
            'zero_volume_count': zero_volume_count,
            'has_volume_count': has_volume_count,
            'zero_volume_with_price_movement': zero_volume_with_price_movement,
            'zero_volume_no_price_movement': zero_volume_no_price_movement,
            'zero_volume_pct': zero_volume_pct,
            'has_volume_pct': has_volume_pct,
            'zero_volume_with_movement_pct': zero_volume_with_movement_pct,
            'zero_volume_no_movement_pct': zero_volume_no_movement_pct,
            'bad_quality_pct': bad_quality_pct,
            'quality_score': quality_score
        }
    except Exception as e:
        print(f"[error] Query failed: {e}", file=sys.stderr)
        raise


def print_report(results: Dict[str, Any]):
    """Print formatted report of analysis results."""
    print("=" * 80, file=sys.stderr)
    print("CANDLE QUALITY ANALYSIS - ZERO VOLUME REPORT", file=sys.stderr)
    print("=" * 80, file=sys.stderr)
    print(file=sys.stderr)
    
    print(f"Total candles: {results['total_candles']:,}", file=sys.stderr)
    print(file=sys.stderr)
    
    print("Zero Volume Candles:", file=sys.stderr)
    print(f"  Total with 0 volume: {results['zero_volume_count']:,} ({results['zero_volume_pct']:.2f}%)", file=sys.stderr)
    print(f"  With price movement: {results['zero_volume_with_price_movement']:,} ({results['zero_volume_with_movement_pct']:.2f}% of zero-volume candles)", file=sys.stderr)
    print(f"  No price movement: {results['zero_volume_no_price_movement']:,} ({results['zero_volume_no_movement_pct']:.2f}% of zero-volume candles)", file=sys.stderr)
    print(file=sys.stderr)
    
    print("Candles With Volume:", file=sys.stderr)
    print(f"  Total with volume > 0: {results['has_volume_count']:,} ({results['has_volume_pct']:.2f}%)", file=sys.stderr)
    print(file=sys.stderr)
    
    print("=" * 80, file=sys.stderr)
    print("QUALITY SCORE", file=sys.stderr)
    print("=" * 80, file=sys.stderr)
    print(f"Bad quality candles (price movement with 0 volume): {results['bad_quality_pct']:.4f}% of total", file=sys.stderr)
    print(f"Quality Score: {results['quality_score']:.2f}/100", file=sys.stderr)
    print(file=sys.stderr)
    
    # Quality interpretation
    if results['quality_score'] >= 99.9:
        interpretation = "EXCELLENT - Minimal quality issues"
    elif results['quality_score'] >= 99.0:
        interpretation = "VERY GOOD - Acceptable quality"
    elif results['quality_score'] >= 95.0:
        interpretation = "GOOD - Some quality issues present"
    elif results['quality_score'] >= 90.0:
        interpretation = "FAIR - Quality issues need attention"
    else:
        interpretation = "POOR - Significant quality issues detected"
    
    print(f"Interpretation: {interpretation}", file=sys.stderr)
    print("=" * 80, file=sys.stderr)


def main():
    """Main script entry point."""
    if not CLICKHOUSE_AVAILABLE:
        sys.exit(1)
    
    try:
        client, database = get_clickhouse_client()
        
        # Analyze zero volume quality
        results = analyze_zero_volume_quality(client, database)
        
        # Print report
        print_report(results)
        
        # Also output JSON for programmatic use
        import json
        print("\n", file=sys.stderr)
        print("JSON Output (for programmatic use):", file=sys.stderr)
        print(json.dumps(results, indent=2))
        
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


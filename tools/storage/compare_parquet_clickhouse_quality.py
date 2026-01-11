#!/usr/bin/env python3
"""
Compare OHLCV Data Quality: Parquet vs ClickHouse

Compares data quality between parquet slice files and ClickHouse to determine:
1. Whether bad ClickHouse data is mostly OUTSIDE the 48-hour event horizon window
2. Coverage and quality differences within vs outside the horizon
3. Which data source is more reliable for backtesting

The 48-hour event horizon is defined as: alert_time → alert_time + 48 hours

Usage:
    python tools/storage/compare_parquet_clickhouse_quality.py \
        --duckdb data/tele.duckdb \
        --parquet-dir slices/per_token \
        --output quality_comparison_report.json

    python tools/storage/compare_parquet_clickhouse_quality.py \
        --duckdb data/tele.duckdb \
        --parquet-dir slices/per_token \
        --limit 100 \
        --visualize
"""

import os
import sys
import json
import argparse
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Any, Optional, Tuple
from collections import defaultdict
import warnings

warnings.filterwarnings('ignore', category=DeprecationWarning)

try:
    import duckdb
except ImportError:
    print("ERROR: duckdb not installed. Run: pip install duckdb", file=sys.stderr)
    sys.exit(1)

try:
    from clickhouse_driver import Client as ClickHouseClient
except ImportError:
    print("ERROR: clickhouse-driver not installed. Run: pip install clickhouse-driver", file=sys.stderr)
    sys.exit(1)

try:
    import pandas as pd
except ImportError:
    pd = None

# Add tools/shared to path
_shared_path = os.path.join(os.path.dirname(__file__), '..', 'shared')
if _shared_path not in sys.path:
    sys.path.insert(0, _shared_path)

# Default event horizon in hours (can be overridden via --horizon)
DEFAULT_HORIZON_HOURS = 48

# Candle interval (1m = 60 seconds, 5m = 300 seconds)
INTERVAL_1M_SECONDS = 60
INTERVAL_5M_SECONDS = 300


def get_clickhouse_client() -> Tuple[ClickHouseClient, str]:
    """Get ClickHouse client from environment or defaults."""
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
    
    client = ClickHouseClient(
        host=host,
        port=port,
        database=database,
        user=user,
        password=password,
        connect_timeout=5,
        send_receive_timeout=60
    )
    
    # Test connection
    client.execute('SELECT 1')
    return client, database


def get_duckdb_connection(db_path: str) -> duckdb.DuckDBPyConnection:
    """Get DuckDB connection."""
    return duckdb.connect(db_path, read_only=True)


def parse_parquet_filename(filename: str) -> Optional[Dict[str, Any]]:
    """
    Parse parquet filename to extract alert info.
    Format: YYYYMMDD_HHMM_mintPrefix_suffix.parquet
    Example: 20250501_0007_BL22Me3x_pump.parquet
    """
    try:
        base = filename.replace('.parquet', '')
        parts = base.split('_')
        if len(parts) < 3:
            return None
        
        date_str = parts[0]  # YYYYMMDD
        time_str = parts[1]  # HHMM
        mint_prefix = parts[2]  # First 8 chars of mint
        
        # Parse datetime
        dt = datetime.strptime(f"{date_str}{time_str}", "%Y%m%d%H%M")
        
        return {
            'datetime': dt,
            'timestamp_ms': int(dt.timestamp() * 1000),
            'mint_prefix': mint_prefix,
            'filename': filename
        }
    except Exception:
        return None


def find_matching_parquet(parquet_dir: str, mint: str, alert_ts_ms: int, tolerance_minutes: int = 120) -> Optional[Path]:
    """
    Find parquet file matching the mint address and alert timestamp.
    
    Parquet files are named: YYYYMMDD_HHMM_mintPrefix_suffix.parquet
    We match by mint prefix (first 8 chars) and timestamp within tolerance.
    """
    mint_prefix = mint[:8]
    alert_dt = datetime.fromtimestamp(alert_ts_ms / 1000)
    
    parquet_path = Path(parquet_dir)
    if not parquet_path.exists():
        return None
    
    # Look for files matching the mint prefix
    candidates = []
    for f in parquet_path.glob(f"*_{mint_prefix}_*.parquet"):
        info = parse_parquet_filename(f.name)
        if info:
            time_diff = abs((info['datetime'] - alert_dt).total_seconds() / 60)
            if time_diff <= tolerance_minutes:
                candidates.append((f, time_diff))
    
    if not candidates:
        # Also try exact filename pattern
        date_str = alert_dt.strftime("%Y%m%d")
        for f in parquet_path.glob(f"{date_str}_*_{mint_prefix}_*.parquet"):
            info = parse_parquet_filename(f.name)
            if info:
                time_diff = abs((info['datetime'] - alert_dt).total_seconds() / 60)
                candidates.append((f, time_diff))
    
    if not candidates:
        return None
    
    # Return closest match
    candidates.sort(key=lambda x: x[1])
    return candidates[0][0]


def analyze_candle_quality(candles: List[Dict[str, Any]], interval_seconds: int = 60) -> Dict[str, Any]:
    """
    Analyze quality of candle data.
    
    Returns dict with:
    - total_candles
    - duplicates: count of duplicate timestamps
    - gaps: count of missing candles
    - distortions: count of price/OHLC inconsistencies
    - zero_volume: count of zero volume candles
    """
    if not candles:
        return {
            'total_candles': 0,
            'duplicates': 0,
            'gaps': 0,
            'distortions': 0,
            'zero_volume': 0,
            'quality_score': 0.0
        }
    
    # Sort by timestamp
    sorted_candles = sorted(candles, key=lambda c: c['timestamp'])
    
    duplicates = 0
    gaps = 0
    distortions = 0
    zero_volume = 0
    
    seen_timestamps = set()
    prev_ts = None
    
    for candle in sorted_candles:
        ts = candle['timestamp']
        
        # Check duplicates
        if ts in seen_timestamps:
            duplicates += 1
        else:
            seen_timestamps.add(ts)
        
        # Check gaps
        if prev_ts is not None:
            expected_diff = interval_seconds
            actual_diff = ts - prev_ts
            if actual_diff > expected_diff * 1.5:
                gaps += int(actual_diff / interval_seconds) - 1
        
        # Check OHLC distortions
        o, h, l, c = candle.get('open', 0), candle.get('high', 0), candle.get('low', 0), candle.get('close', 0)
        if h < l or o > h or o < l or c > h or c < l or any(v <= 0 for v in [o, h, l, c]):
            distortions += 1
        
        # Check zero volume
        if candle.get('volume', 0) == 0:
            zero_volume += 1
        
        prev_ts = ts
    
    total = len(sorted_candles)
    quality_score = 100.0
    quality_score -= min(30, duplicates * 0.5)
    quality_score -= min(30, gaps * 0.1)
    quality_score -= min(20, distortions * 1.0)
    quality_score -= min(10, zero_volume * 0.1)
    quality_score = max(0, quality_score)
    
    return {
        'total_candles': total,
        'duplicates': duplicates,
        'gaps': gaps,
        'distortions': distortions,
        'zero_volume': zero_volume,
        'quality_score': quality_score
    }


def load_parquet_candles(parquet_path: Path) -> List[Dict[str, Any]]:
    """Load candles from parquet file."""
    try:
        conn = duckdb.connect()
        rows = conn.execute(f"""
            SELECT 
                token_address,
                CAST(EXTRACT(EPOCH FROM timestamp) AS INTEGER) as timestamp,
                open,
                high,
                low,
                close,
                volume
            FROM read_parquet('{parquet_path}')
            ORDER BY timestamp
        """).fetchall()
        
        return [
            {
                'token_address': row[0],
                'timestamp': row[1],
                'open': row[2],
                'high': row[3],
                'low': row[4],
                'close': row[5],
                'volume': row[6]
            }
            for row in rows
        ]
    except Exception as e:
        print(f"Error loading parquet {parquet_path}: {e}", file=sys.stderr)
        return []


def load_clickhouse_candles(
    ch_client: ClickHouseClient,
    database: str,
    mint: str,
    chain: str,
    from_ts: int,
    to_ts: int,
    interval: str = '1m'
) -> List[Dict[str, Any]]:
    """Load candles from ClickHouse for a time range."""
    # Map interval string to seconds
    interval_seconds_map = {
        '1s': 1,
        '15s': 15,
        '1m': 60,
        '5m': 300,
        '15m': 900,
        '1h': 3600,
        '4h': 14400,
        '1d': 86400
    }
    interval_sec = interval_seconds_map.get(interval, 60)
    
    try:
        query = f"""
            SELECT 
                token_address,
                toUnixTimestamp(timestamp) as timestamp,
                open,
                high,
                low,
                close,
                volume
            FROM {database}.ohlcv_candles
            WHERE token_address = %(mint)s
              AND lower(chain) = lower(%(chain)s)
              AND interval_seconds = %(interval_sec)s
              AND timestamp >= toDateTime(%(from_ts)s)
              AND timestamp <= toDateTime(%(to_ts)s)
            ORDER BY timestamp
        """
        
        rows = ch_client.execute(query, {
            'mint': mint,
            'chain': chain,
            'interval_sec': interval_sec,
            'from_ts': from_ts,
            'to_ts': to_ts
        })
        
        return [
            {
                'token_address': row[0],
                'timestamp': row[1],
                'open': row[2],
                'high': row[3],
                'low': row[4],
                'close': row[5],
                'volume': row[6]
            }
            for row in rows
        ]
    except Exception as e:
        print(f"Error loading ClickHouse candles for {mint[:8]}...: {e}", file=sys.stderr)
        return []


def get_alerts_with_parquet(
    duck_conn: duckdb.DuckDBPyConnection,
    parquet_dir: str,
    limit: Optional[int] = None
) -> List[Dict[str, Any]]:
    """Get alerts from DuckDB that have corresponding parquet files."""
    
    # Check which tables exist (try both unqualified and schema-qualified names)
    caller_links_table = None
    simulation_runs_table = None
    alerts_std_table = None
    
    # Try different table locations for caller_links
    for table in ['caller_links_d', 'main.caller_links_d']:
        try:
            duck_conn.execute(f"SELECT 1 FROM {table} LIMIT 1")
            caller_links_table = table
            break
        except Exception:
            pass
    
    # Try different table locations for simulation_runs
    for table in ['simulation_runs', 'main.simulation_runs']:
        try:
            duck_conn.execute(f"SELECT 1 FROM {table} LIMIT 1")
            simulation_runs_table = table
            break
        except Exception:
            pass
    
    # Try alerts_std as fallback
    for table in ['alerts_std', 'canon.alerts_std']:
        try:
            duck_conn.execute(f"SELECT 1 FROM {table} LIMIT 1")
            alerts_std_table = table
            break
        except Exception:
            pass
    
    if caller_links_table:
        query = f"""
            SELECT DISTINCT
                mint,
                COALESCE(chain, 'solana') as chain,
                trigger_ts_ms as alert_ts_ms,
                trigger_from_name as caller_name
            FROM {caller_links_table}
            WHERE mint IS NOT NULL
              AND mint != ''
              AND trigger_ts_ms IS NOT NULL
            ORDER BY trigger_ts_ms DESC
        """
        if limit:
            query += f" LIMIT {limit * 50}"  # Get more since we'll filter by parquet existence
    elif simulation_runs_table:
        query = f"""
            SELECT DISTINCT
                mint,
                'solana' as chain,
                CAST(EXTRACT(EPOCH FROM alert_timestamp) * 1000 AS BIGINT) as alert_ts_ms,
                caller_name
            FROM {simulation_runs_table}
            WHERE mint IS NOT NULL
              AND mint != ''
              AND alert_timestamp IS NOT NULL
            ORDER BY alert_timestamp DESC
        """
        if limit:
            query += f" LIMIT {limit * 50}"
    elif alerts_std_table:
        query = f"""
            SELECT DISTINCT
                mint,
                COALESCE(chain, 'solana') as chain,
                alert_ts_ms,
                caller_name_norm as caller_name
            FROM {alerts_std_table}
            WHERE mint IS NOT NULL
              AND mint != ''
              AND alert_ts_ms IS NOT NULL
            ORDER BY alert_ts_ms DESC
        """
        if limit:
            query += f" LIMIT {limit * 50}"
    else:
        print("ERROR: No alert/call tables found in DuckDB", file=sys.stderr)
        print("  Searched for: caller_links_d, main.caller_links_d, simulation_runs, main.simulation_runs, alerts_std, canon.alerts_std", file=sys.stderr)
        return []
    
    rows = duck_conn.execute(query).fetchall()
    
    print(f"  Scanning {len(rows)} alerts for matching parquet files...", file=sys.stderr)
    
    alerts = []
    scanned = 0
    for row in rows:
        mint, chain, alert_ts_ms, caller_name = row
        scanned += 1
        
        # Skip EVM addresses (parquet files are mostly for Solana)
        if mint.startswith('0x'):
            continue
        
        # Check if parquet exists
        parquet_path = find_matching_parquet(parquet_dir, mint, alert_ts_ms)
        
        if parquet_path:
            alerts.append({
                'mint': mint,
                'chain': chain,
                'alert_ts_ms': alert_ts_ms,
                'caller_name': caller_name,
                'parquet_path': str(parquet_path)
            })
            
            if limit and len(alerts) >= limit:
                break
    
    print(f"  Scanned {scanned} alerts, found {len(alerts)} with parquet files", file=sys.stderr)
    
    return alerts


def analyze_parquet_only(alert: Dict[str, Any], interval: str = '1m', horizon_hours: int = DEFAULT_HORIZON_HOURS) -> Dict[str, Any]:
    """
    Analyze parquet file quality only (no ClickHouse comparison).
    Useful for testing or when ClickHouse is not available.
    """
    mint = alert['mint']
    chain = alert['chain']
    alert_ts_ms = alert['alert_ts_ms']
    parquet_path = Path(alert['parquet_path'])
    
    # Calculate horizon window
    alert_ts_sec = alert_ts_ms // 1000
    horizon_end_ts_sec = alert_ts_sec + (horizon_hours * 3600)
    
    interval_seconds = INTERVAL_1M_SECONDS if interval == '1m' else INTERVAL_5M_SECONDS
    
    # Load parquet candles
    parquet_candles = load_parquet_candles(parquet_path)
    
    if not parquet_candles:
        return {
            'mint': mint,
            'alert_ts': datetime.fromtimestamp(alert_ts_sec).isoformat(),
            'error': 'Failed to load parquet',
            'comparison': None
        }
    
    # Get parquet time range
    parquet_min_ts = min(c['timestamp'] for c in parquet_candles)
    parquet_max_ts = max(c['timestamp'] for c in parquet_candles)
    
    # Split candles into horizon vs outside
    def split_by_horizon(candles):
        inside = [c for c in candles if alert_ts_sec <= c['timestamp'] <= horizon_end_ts_sec]
        before = [c for c in candles if c['timestamp'] < alert_ts_sec]
        after = [c for c in candles if c['timestamp'] > horizon_end_ts_sec]
        return inside, before, after
    
    parquet_inside, parquet_before, parquet_after = split_by_horizon(parquet_candles)
    
    # Analyze quality for each segment
    parquet_quality_inside = analyze_candle_quality(parquet_inside, interval_seconds)
    parquet_quality_before = analyze_candle_quality(parquet_before, interval_seconds)
    parquet_quality_after = analyze_candle_quality(parquet_after, interval_seconds)
    parquet_quality_total = analyze_candle_quality(parquet_candles, interval_seconds)
    
    # Calculate expected candles in horizon
    expected_horizon_candles = (horizon_hours * 3600) // interval_seconds
    
    return {
        'mint': mint,
        'chain': chain,
        'alert_ts': datetime.fromtimestamp(alert_ts_sec).isoformat(),
        'mode': 'parquet_only',
        'horizon_window': {
            'start': datetime.fromtimestamp(alert_ts_sec).isoformat(),
            'end': datetime.fromtimestamp(horizon_end_ts_sec).isoformat(),
            'hours': horizon_hours,
            'expected_candles': expected_horizon_candles
        },
        'parquet': {
            'total': parquet_quality_total,
            'inside_horizon': parquet_quality_inside,
            'before_horizon': parquet_quality_before,
            'after_horizon': parquet_quality_after,
            'time_range': {
                'start': datetime.fromtimestamp(parquet_min_ts).isoformat(),
                'end': datetime.fromtimestamp(parquet_max_ts).isoformat()
            }
        },
        'clickhouse': None,
        'comparison': {
            'inside_horizon': {
                'parquet_candles': parquet_quality_inside['total_candles'],
                'clickhouse_candles': 0,
                'parquet_quality': parquet_quality_inside['quality_score'],
                'clickhouse_quality': 0,
                'coverage_diff': parquet_quality_inside['total_candles'],
                'quality_diff': parquet_quality_inside['quality_score'],
                'parquet_better': True
            },
            'outside_horizon': {
                'parquet_candles': parquet_quality_before['total_candles'] + parquet_quality_after['total_candles'],
                'clickhouse_candles': 0,
                'ch_issues_inside_horizon': 0,
                'ch_issues_outside_horizon': 0,
            }
        }
    }


def compare_quality_for_alert(
    alert: Dict[str, Any],
    ch_client: ClickHouseClient,
    database: str,
    interval: str = '1m',
    horizon_hours: int = DEFAULT_HORIZON_HOURS
) -> Dict[str, Any]:
    """
    Compare parquet vs ClickHouse quality for a single alert.
    
    Analyzes:
    1. Within 48-hour horizon (alert → alert + 48h)
    2. Outside horizon (all other data)
    """
    mint = alert['mint']
    chain = alert['chain']
    alert_ts_ms = alert['alert_ts_ms']
    parquet_path = Path(alert['parquet_path'])
    
    # Calculate horizon window
    alert_ts_sec = alert_ts_ms // 1000
    horizon_end_ts_sec = alert_ts_sec + (horizon_hours * 3600)
    
    # Also check some time before alert (for warmup data)
    warmup_hours = 4
    warmup_ts_sec = alert_ts_sec - (warmup_hours * 3600)
    
    interval_seconds = INTERVAL_1M_SECONDS if interval == '1m' else INTERVAL_5M_SECONDS
    
    # Load parquet candles
    parquet_candles = load_parquet_candles(parquet_path)
    
    if not parquet_candles:
        return {
            'mint': mint,
            'alert_ts': datetime.fromtimestamp(alert_ts_sec).isoformat(),
            'error': 'Failed to load parquet',
            'comparison': None
        }
    
    # Get parquet time range
    parquet_min_ts = min(c['timestamp'] for c in parquet_candles)
    parquet_max_ts = max(c['timestamp'] for c in parquet_candles)
    
    # Load ClickHouse candles for same time range
    ch_candles = load_clickhouse_candles(
        ch_client, database, mint, chain,
        parquet_min_ts, parquet_max_ts, interval
    )
    
    # Split candles into horizon vs outside
    def split_by_horizon(candles):
        inside = [c for c in candles if alert_ts_sec <= c['timestamp'] <= horizon_end_ts_sec]
        before = [c for c in candles if c['timestamp'] < alert_ts_sec]
        after = [c for c in candles if c['timestamp'] > horizon_end_ts_sec]
        return inside, before, after
    
    parquet_inside, parquet_before, parquet_after = split_by_horizon(parquet_candles)
    ch_inside, ch_before, ch_after = split_by_horizon(ch_candles)
    
    # Analyze quality for each segment
    parquet_quality_inside = analyze_candle_quality(parquet_inside, interval_seconds)
    parquet_quality_before = analyze_candle_quality(parquet_before, interval_seconds)
    parquet_quality_after = analyze_candle_quality(parquet_after, interval_seconds)
    parquet_quality_total = analyze_candle_quality(parquet_candles, interval_seconds)
    
    ch_quality_inside = analyze_candle_quality(ch_inside, interval_seconds)
    ch_quality_before = analyze_candle_quality(ch_before, interval_seconds)
    ch_quality_after = analyze_candle_quality(ch_after, interval_seconds)
    ch_quality_total = analyze_candle_quality(ch_candles, interval_seconds)
    
    # Calculate expected candles in horizon
    expected_horizon_candles = (horizon_hours * 3600) // interval_seconds
    
    return {
        'mint': mint,
        'chain': chain,
        'alert_ts': datetime.fromtimestamp(alert_ts_sec).isoformat(),
        'horizon_window': {
            'start': datetime.fromtimestamp(alert_ts_sec).isoformat(),
            'end': datetime.fromtimestamp(horizon_end_ts_sec).isoformat(),
            'hours': horizon_hours,
            'expected_candles': expected_horizon_candles
        },
        'parquet': {
            'total': parquet_quality_total,
            'inside_horizon': parquet_quality_inside,
            'before_horizon': parquet_quality_before,
            'after_horizon': parquet_quality_after,
            'time_range': {
                'start': datetime.fromtimestamp(parquet_min_ts).isoformat(),
                'end': datetime.fromtimestamp(parquet_max_ts).isoformat()
            }
        },
        'clickhouse': {
            'total': ch_quality_total,
            'inside_horizon': ch_quality_inside,
            'before_horizon': ch_quality_before,
            'after_horizon': ch_quality_after,
            'time_range': {
                'start': datetime.fromtimestamp(min(c['timestamp'] for c in ch_candles)).isoformat() if ch_candles else None,
                'end': datetime.fromtimestamp(max(c['timestamp'] for c in ch_candles)).isoformat() if ch_candles else None
            } if ch_candles else None
        },
        'comparison': {
            'inside_horizon': {
                'parquet_candles': parquet_quality_inside['total_candles'],
                'clickhouse_candles': ch_quality_inside['total_candles'],
                'parquet_quality': parquet_quality_inside['quality_score'],
                'clickhouse_quality': ch_quality_inside['quality_score'],
                'coverage_diff': parquet_quality_inside['total_candles'] - ch_quality_inside['total_candles'],
                'quality_diff': parquet_quality_inside['quality_score'] - ch_quality_inside['quality_score'],
                'parquet_better': parquet_quality_inside['quality_score'] > ch_quality_inside['quality_score']
            },
            'outside_horizon': {
                'parquet_candles': parquet_quality_before['total_candles'] + parquet_quality_after['total_candles'],
                'clickhouse_candles': ch_quality_before['total_candles'] + ch_quality_after['total_candles'],
                'ch_issues_inside_horizon': ch_quality_inside['duplicates'] + ch_quality_inside['gaps'] + ch_quality_inside['distortions'],
                'ch_issues_outside_horizon': (ch_quality_before['duplicates'] + ch_quality_before['gaps'] + ch_quality_before['distortions'] +
                                               ch_quality_after['duplicates'] + ch_quality_after['gaps'] + ch_quality_after['distortions']),
            }
        }
    }


def generate_summary(comparisons: List[Dict[str, Any]], horizon_hours: int = DEFAULT_HORIZON_HOURS) -> Dict[str, Any]:
    """Generate summary statistics from all comparisons."""
    if not comparisons:
        return {'error': 'No comparisons available'}
    
    valid_comparisons = [c for c in comparisons if c.get('comparison')]
    
    if not valid_comparisons:
        return {'error': 'No valid comparisons'}
    
    # Aggregate statistics
    total_tokens = len(valid_comparisons)
    
    parquet_better_count = sum(1 for c in valid_comparisons if c['comparison']['inside_horizon']['parquet_better'])
    
    total_ch_issues_inside = sum(c['comparison']['outside_horizon']['ch_issues_inside_horizon'] for c in valid_comparisons)
    total_ch_issues_outside = sum(c['comparison']['outside_horizon']['ch_issues_outside_horizon'] for c in valid_comparisons)
    
    avg_parquet_quality_inside = sum(c['comparison']['inside_horizon']['parquet_quality'] for c in valid_comparisons) / len(valid_comparisons)
    avg_ch_quality_inside = sum(c['comparison']['inside_horizon']['clickhouse_quality'] for c in valid_comparisons) / len(valid_comparisons)
    
    avg_parquet_coverage = sum(c['comparison']['inside_horizon']['parquet_candles'] for c in valid_comparisons) / len(valid_comparisons)
    avg_ch_coverage = sum(c['comparison']['inside_horizon']['clickhouse_candles'] for c in valid_comparisons) / len(valid_comparisons)
    
    # Calculate what % of bad CH data is outside horizon
    if total_ch_issues_inside + total_ch_issues_outside > 0:
        pct_bad_outside = (total_ch_issues_outside / (total_ch_issues_inside + total_ch_issues_outside)) * 100
    else:
        pct_bad_outside = 0.0
    
    return {
        'total_tokens_compared': total_tokens,
        'horizon_hours': horizon_hours,
        'quality_comparison': {
            'parquet_better_inside_horizon_pct': (parquet_better_count / total_tokens) * 100,
            'avg_parquet_quality_inside': avg_parquet_quality_inside,
            'avg_clickhouse_quality_inside': avg_ch_quality_inside,
            'quality_difference': avg_parquet_quality_inside - avg_ch_quality_inside
        },
        'coverage_comparison': {
            'avg_parquet_candles_in_horizon': avg_parquet_coverage,
            'avg_clickhouse_candles_in_horizon': avg_ch_coverage,
            'expected_candles_in_horizon': (horizon_hours * 3600) // 60,  # 1440 for 24h, 2880 for 48h
            'avg_parquet_coverage_pct': (avg_parquet_coverage / ((horizon_hours * 3600) // 60)) * 100 if horizon_hours > 0 else 0,
            'avg_clickhouse_coverage_pct': (avg_ch_coverage / ((horizon_hours * 3600) // 60)) * 100 if horizon_hours > 0 else 0,
        },
        'duplicates': {
            'avg_parquet_duplicates': sum(c['parquet']['inside_horizon']['duplicates'] for c in valid_comparisons) / len(valid_comparisons) if valid_comparisons else 0,
            'avg_clickhouse_duplicates': sum(c['clickhouse']['inside_horizon']['duplicates'] for c in valid_comparisons if c.get('clickhouse')) / len(valid_comparisons) if valid_comparisons else 0,
        },
        'clickhouse_issues': {
            'total_issues_inside_horizon': total_ch_issues_inside,
            'total_issues_outside_horizon': total_ch_issues_outside,
            'pct_issues_outside_horizon': pct_bad_outside,
            'conclusion': (
                f"{'Most' if pct_bad_outside > 50 else 'Less than half'} of ClickHouse data quality issues "
                f"({pct_bad_outside:.1f}%) are OUTSIDE the {horizon_hours}-hour event horizon window."
            )
        }
    }


def visualize_results(summary: Dict[str, Any], comparisons: List[Dict[str, Any]]):
    """Print visualization of results."""
    print("\n" + "=" * 80)
    print("OHLCV DATA QUALITY COMPARISON: PARQUET vs CLICKHOUSE")
    print("=" * 80)
    
    print(f"\nTokens Compared: {summary['total_tokens_compared']}")
    print(f"Event Horizon Window: {summary['horizon_hours']} hours (alert → alert + {summary['horizon_hours']}h)")
    
    print("\n" + "-" * 40)
    print("QUALITY INSIDE HORIZON (Backtesting Window)")
    print("-" * 40)
    q = summary['quality_comparison']
    print(f"  Parquet quality score:    {q['avg_parquet_quality_inside']:.1f}/100")
    print(f"  ClickHouse quality score: {q['avg_clickhouse_quality_inside']:.1f}/100")
    print(f"  Quality difference:       {'+' if q['quality_difference'] > 0 else ''}{q['quality_difference']:.1f} (parquet - clickhouse)")
    print(f"  Parquet better in:        {q['parquet_better_inside_horizon_pct']:.1f}% of tokens")
    
    print("\n" + "-" * 40)
    print("COVERAGE INSIDE HORIZON")
    print("-" * 40)
    c = summary['coverage_comparison']
    print(f"  Expected candles ({summary['horizon_hours']}h @ 1m): {c['expected_candles_in_horizon']:,}")
    print(f"  Avg parquet candles:         {c['avg_parquet_candles_in_horizon']:.0f} ({c['avg_parquet_coverage_pct']:.1f}%)")
    print(f"  Avg ClickHouse candles:      {c['avg_clickhouse_candles_in_horizon']:.0f} ({c['avg_clickhouse_coverage_pct']:.1f}%)")
    
    if 'duplicates' in summary:
        d = summary['duplicates']
        if d['avg_clickhouse_duplicates'] > 0:
            print(f"  ⚠️  Avg ClickHouse DUPLICATES: {d['avg_clickhouse_duplicates']:.0f} (inflates count!)")
    
    print("\n" + "-" * 40)
    print("CLICKHOUSE DATA QUALITY ISSUES LOCATION")
    print("-" * 40)
    i = summary['clickhouse_issues']
    print(f"  Issues INSIDE horizon:  {i['total_issues_inside_horizon']:,}")
    print(f"  Issues OUTSIDE horizon: {i['total_issues_outside_horizon']:,}")
    
    pct = i['pct_issues_outside_horizon']
    if pct > 75:
        color = "\033[32m"  # Green - good
    elif pct > 50:
        color = "\033[33m"  # Yellow
    else:
        color = "\033[31m"  # Red - bad
    reset = "\033[0m"
    
    print(f"  {color}% Issues OUTSIDE horizon: {pct:.1f}%{reset}")
    print(f"\n  → {i['conclusion']}")
    
    # Show worst tokens
    valid_comparisons = [c for c in comparisons if c.get('comparison')]
    if valid_comparisons:
        print("\n" + "-" * 40)
        print("TOP 10 TOKENS WITH WORST CLICKHOUSE QUALITY (Inside Horizon)")
        print("-" * 40)
        
        sorted_by_ch_quality = sorted(
            valid_comparisons,
            key=lambda x: x['comparison']['inside_horizon']['clickhouse_quality']
        )
        
        for i, comp in enumerate(sorted_by_ch_quality[:10], 1):
            mint = comp['mint'][:12] + "..."
            ch_q = comp['comparison']['inside_horizon']['clickhouse_quality']
            pq_q = comp['comparison']['inside_horizon']['parquet_quality']
            ch_n = comp['comparison']['inside_horizon']['clickhouse_candles']
            pq_n = comp['comparison']['inside_horizon']['parquet_candles']
            
            print(f"  {i:2}. {mint} CH: {ch_q:5.1f} PQ: {pq_q:5.1f} | Candles CH: {ch_n:4} PQ: {pq_n:4}")
    
    print("\n" + "=" * 80)


def main():
    parser = argparse.ArgumentParser(
        description='Compare OHLCV data quality between Parquet files and ClickHouse',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__
    )
    parser.add_argument(
        '--duckdb',
        required=True,
        help='Path to DuckDB database with alerts'
    )
    parser.add_argument(
        '--parquet-dir',
        required=True,
        help='Directory containing parquet slice files'
    )
    parser.add_argument(
        '--output',
        default='quality_comparison_report.json',
        help='Output JSON file path (default: quality_comparison_report.json)'
    )
    parser.add_argument(
        '--limit',
        type=int,
        help='Maximum number of tokens to compare'
    )
    parser.add_argument(
        '--interval',
        default='1m',
        choices=['1m', '5m'],
        help='Candle interval (default: 1m)'
    )
    parser.add_argument(
        '--visualize',
        action='store_true',
        help='Print visualization to console'
    )
    parser.add_argument(
        '--parquet-only',
        action='store_true',
        help='Only analyze parquet files (skip ClickHouse comparison)'
    )
    parser.add_argument(
        '--horizon',
        type=int,
        default=DEFAULT_HORIZON_HOURS,
        help=f'Event horizon in hours (default: {DEFAULT_HORIZON_HOURS})'
    )
    
    args = parser.parse_args()
    
    # Connect to databases
    print("Connecting to databases...", file=sys.stderr)
    duck_conn = get_duckdb_connection(args.duckdb)
    
    ch_client = None
    ch_database = None
    
    if not args.parquet_only:
        try:
            ch_client, ch_database = get_clickhouse_client()
            print(f"ClickHouse database: {ch_database}", file=sys.stderr)
        except Exception as e:
            print(f"WARNING: Could not connect to ClickHouse: {e}", file=sys.stderr)
            print("  Continuing in parquet-only mode...", file=sys.stderr)
            args.parquet_only = True
    
    print(f"DuckDB: {args.duckdb}", file=sys.stderr)
    print(f"Parquet dir: {args.parquet_dir}", file=sys.stderr)
    if args.parquet_only:
        print("Mode: Parquet-only (ClickHouse comparison disabled)", file=sys.stderr)
    
    # Get alerts with parquet files
    print("\nFinding alerts with parquet files...", file=sys.stderr)
    alerts = get_alerts_with_parquet(duck_conn, args.parquet_dir, args.limit)
    print(f"Found {len(alerts)} alerts with parquet files", file=sys.stderr)
    
    if not alerts:
        print("ERROR: No alerts found with matching parquet files", file=sys.stderr)
        sys.exit(1)
    
    # Compare quality for each alert
    print("\nComparing data quality...", file=sys.stderr)
    comparisons = []
    
    for i, alert in enumerate(alerts):
        if i % 10 == 0:
            print(f"  Progress: {i}/{len(alerts)} alerts...", file=sys.stderr)
        
        if args.parquet_only:
            result = analyze_parquet_only(alert, args.interval, args.horizon)
        else:
            result = compare_quality_for_alert(alert, ch_client, ch_database, args.interval, args.horizon)
        comparisons.append(result)
    
    # Generate summary
    print("\nGenerating summary...", file=sys.stderr)
    summary = generate_summary(comparisons, args.horizon)
    
    # Build report
    report = {
        'generated_at': datetime.utcnow().isoformat(),
        'parameters': {
            'duckdb_path': args.duckdb,
            'parquet_dir': args.parquet_dir,
            'interval': args.interval,
            'horizon_hours': args.horizon,
            'limit': args.limit
        },
        'summary': summary,
        'comparisons': comparisons
    }
    
    # Save report
    with open(args.output, 'w') as f:
        json.dump(report, f, indent=2, default=str)
    print(f"\n✓ Report saved to {args.output}", file=sys.stderr)
    
    # Visualize if requested
    if args.visualize:
        visualize_results(summary, comparisons)
    else:
        # Print brief summary
        print("\n" + "-" * 40)
        print("SUMMARY")
        print("-" * 40)
        if 'clickhouse_issues' in summary:
            pct = summary['clickhouse_issues']['pct_issues_outside_horizon']
            print(f"ClickHouse issues OUTSIDE 48h horizon: {pct:.1f}%")
            print(summary['clickhouse_issues']['conclusion'])
        print(f"\nFull report: {args.output}")


if __name__ == '__main__':
    main()


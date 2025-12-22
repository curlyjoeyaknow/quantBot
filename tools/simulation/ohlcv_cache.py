#!/usr/bin/env python3
"""
OHLCV Cache Layer

Provides caching for OHLCV queries to reduce ClickHouse load.
Cache key: sha256(mint:chain:start:end:interval)
Cache storage: JSON files in cache/ohlcv/
Expiration: 24 hours for historical data
"""

import hashlib
import json
import os
from pathlib import Path
from typing import Dict, Any, Optional
from datetime import datetime, timedelta

try:
    from clickhouse_engine import query_ohlcv
    CLICKHOUSE_AVAILABLE = True
except ImportError:
    CLICKHOUSE_AVAILABLE = False


def generate_cache_key(
    token_address: str,
    chain: str,
    start_time: datetime,
    end_time: datetime,
    interval: str = '5m'
) -> str:
    """Generate cache key from query parameters."""
    key_string = f"{token_address}:{chain}:{start_time.isoformat()}:{end_time.isoformat()}:{interval}"
    return hashlib.sha256(key_string.encode()).hexdigest()


def get_cache_path(cache_dir: str, cache_key: str) -> Path:
    """Get cache file path for a cache key."""
    cache_path = Path(cache_dir) / 'ohlcv'
    cache_path.mkdir(parents=True, exist_ok=True)
    return cache_path / f"{cache_key}.json"


def load_from_cache(cache_path: Path) -> Optional[Dict[str, Any]]:
    """Load cached data if not expired."""
    if not cache_path.exists():
        return None
    
    try:
        with open(cache_path, 'r') as f:
            cached = json.load(f)
        
        # Check expiration
        expires_at = datetime.fromisoformat(cached.get('expires_at', ''))
        if datetime.now() > expires_at:
            # Cache expired, delete file
            cache_path.unlink()
            return None
        
        return cached
    except (json.JSONDecodeError, ValueError, KeyError):
        # Invalid cache file, delete it
        cache_path.unlink()
        return None


def save_to_cache(cache_path: Path, data: Dict[str, Any], expiration_hours: int = 24) -> None:
    """Save data to cache with expiration."""
    expires_at = datetime.now() + timedelta(hours=expiration_hours)
    
    cache_data = {
        'candles': data.get('candles', []),
        'count': data.get('count', 0),
        'expires_at': expires_at.isoformat(),
        'cached_at': datetime.now().isoformat(),
    }
    
    with open(cache_path, 'w') as f:
        json.dump(cache_data, f)


def query_ohlcv_with_cache(
    client,
    cache_dir: str,
    token_address: str,
    chain: str,
    start_time: datetime,
    end_time: datetime,
    interval: str = '5m',
    expiration_hours: int = 24
) -> Dict[str, Any]:
    """
    Query OHLCV with caching.
    
    Args:
        client: ClickHouse client
        cache_dir: Directory for cache files
        token_address: Token address
        chain: Chain name
        start_time: Start time
        end_time: End time
        interval: Candle interval
        expiration_hours: Cache expiration in hours (default: 24)
    
    Returns:
        Dict with 'success', 'candles', 'count', and 'cached' keys
    """
    # Generate cache key
    cache_key = generate_cache_key(token_address, chain, start_time, end_time, interval)
    cache_path = get_cache_path(cache_dir, cache_key)
    
    # Check cache
    cached = load_from_cache(cache_path)
    if cached:
        return {
            'success': True,
            'candles': cached['candles'],
            'count': cached['count'],
            'cached': True,
        }
    
    # Query ClickHouse
    if not CLICKHOUSE_AVAILABLE:
        return {
            'success': False,
            'error': 'ClickHouse engine not available',
            'cached': False,
        }
    
    result = query_ohlcv(client, token_address, chain, start_time, end_time, interval)
    
    # Cache result if successful
    if result.get('success') and result.get('candles'):
        save_to_cache(cache_path, result, expiration_hours)
    
    return {**result, 'cached': False}


def clear_cache(cache_dir: str, older_than_hours: Optional[int] = None) -> int:
    """
    Clear cache files.
    
    Args:
        cache_dir: Directory for cache files
        older_than_hours: If provided, only clear files older than this (None = clear all)
    
    Returns:
        Number of files deleted
    """
    cache_path = Path(cache_dir) / 'ohlcv'
    if not cache_path.exists():
        return 0
    
    deleted = 0
    cutoff_time = datetime.now() - timedelta(hours=older_than_hours) if older_than_hours else None
    
    for cache_file in cache_path.glob('*.json'):
        if cutoff_time:
            # Check file modification time
            file_mtime = datetime.fromtimestamp(cache_file.stat().st_mtime)
            if file_mtime > cutoff_time:
                continue
        
        try:
            cache_file.unlink()
            deleted += 1
        except OSError:
            pass
    
    return deleted


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='OHLCV Cache Management')
    parser.add_argument('--cache-dir', default='./cache', help='Cache directory')
    parser.add_argument('--clear', action='store_true', help='Clear cache')
    parser.add_argument('--clear-older-than', type=int, help='Clear cache older than N hours')
    
    args = parser.parse_args()
    
    if args.clear or args.clear_older_than:
        deleted = clear_cache(args.cache_dir, args.clear_older_than)
        print(f"Deleted {deleted} cache files")
    else:
        print("Use --clear to clear all cache or --clear-older-than N to clear cache older than N hours")


"""
Cache utilities for auto-detecting and validating baseline cache files.
"""

from pathlib import Path
from datetime import datetime, timezone
from typing import Optional, Tuple, Dict, Any
import json


def find_baseline_cache(
    date_from: datetime,
    date_to: datetime,
    cache_dir: str = "results",
    pattern: Optional[str] = None,
) -> Optional[Path]:
    """
    Auto-detect baseline cache file based on date range.
    
    Args:
        date_from: Start date
        date_to: End date
        cache_dir: Directory to search for cache files
        pattern: Optional custom pattern (default: baseline_cache_YYYYMMDD_YYYYMMDD*.parquet)
    
    Returns:
        Path to cache file if found, None otherwise
    """
    cache_path = Path(cache_dir)
    if not cache_path.exists():
        return None
    
    if pattern:
        cache_pattern = pattern
    else:
        date_from_str = date_from.strftime('%Y%m%d')
        date_to_str = date_to.strftime('%Y%m%d')
        cache_pattern = f"baseline_cache_{date_from_str}_{date_to_str}*.parquet"
    
    matches = list(cache_path.glob(cache_pattern))
    if matches:
        # Return most recent if multiple matches
        return max(matches, key=lambda p: p.stat().st_mtime)
    
    return None


def find_per_alert_cache(
    cache_dir: str = "results/per_alert",
) -> Optional[Path]:
    """
    Check if per-alert cache directory exists and has files.
    
    Args:
        cache_dir: Directory containing per-alert parquet files
    
    Returns:
        Path to cache directory if exists and has files, None otherwise
    """
    cache_path = Path(cache_dir)
    if cache_path.exists() and cache_path.is_dir():
        parquet_files = list(cache_path.glob("alert_*.parquet"))
        if parquet_files:
            return cache_path
    return None


def find_per_caller_cache(
    cache_dir: str = "results/per_caller",
) -> Optional[Path]:
    """
    Check if per-caller cache directory exists and has files.
    
    Args:
        cache_dir: Directory containing per-caller parquet files
    
    Returns:
        Path to cache directory if exists and has files, None otherwise
    """
    cache_path = Path(cache_dir)
    if cache_path.exists() and cache_path.is_dir():
        parquet_files = list(cache_path.glob("caller_*.parquet"))
        if parquet_files:
            return cache_path
    return None


def get_cache_metadata_path(cache_path: Path) -> Path:
    """Get path to metadata file for a cache."""
    return cache_path.parent / f"{cache_path.stem}.metadata.json"

def read_cache_metadata(cache_path: Path) -> Optional[Dict[str, Any]]:
    """Read cache metadata if it exists."""
    metadata_path = get_cache_metadata_path(cache_path)
    if metadata_path.exists():
        try:
            with open(metadata_path, 'r') as f:
                return json.load(f)
        except Exception:
            return None
    return None

def write_cache_metadata(cache_path: Path, metadata: Dict[str, Any]) -> None:
    """Write cache metadata to a JSON file."""
    metadata_path = get_cache_metadata_path(cache_path)
    with open(metadata_path, 'w') as f:
        json.dump(metadata, f, indent=2, default=str)

def create_cache_metadata(
    date_from: datetime,
    date_to: datetime,
    interval_seconds: int = 60,
    horizon_hours: int = 48,
    version: str = "1.0",
) -> Dict[str, Any]:
    """Create cache metadata dict."""
    return {
        "version": version,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "date_from": date_from.isoformat(),
        "date_to": date_to.isoformat(),
        "interval_seconds": interval_seconds,
        "horizon_hours": horizon_hours,
    }

def is_cache_stale(
    cache_path: Path,
    max_age_days: int = 7,
    check_params: bool = True,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    interval_seconds: Optional[int] = None,
    horizon_hours: Optional[int] = None,
) -> Tuple[bool, Optional[str]]:
    """
    Check if cache is stale based on age or parameter mismatch.
    
    Args:
        cache_path: Path to cache file
        max_age_days: Maximum age in days before cache is considered stale
        check_params: Whether to check parameter mismatch
        date_from: Expected start date (if checking params)
        date_to: Expected end date (if checking params)
        interval_seconds: Expected interval (if checking params)
        horizon_hours: Expected horizon (if checking params)
    
    Returns:
        (is_stale, reason)
    """
    if not cache_path.exists():
        return True, "Cache file does not exist"
    
    # Check file age
    file_mtime = datetime.fromtimestamp(cache_path.stat().st_mtime, tz=timezone.utc)
    age_days = (datetime.now(timezone.utc) - file_mtime).days
    if age_days > max_age_days:
        return True, f"Cache is {age_days} days old (max: {max_age_days} days)"
    
    # Check metadata if available
    metadata = read_cache_metadata(cache_path)
    if metadata and check_params:
        if date_from and date_to:
            meta_date_from = datetime.fromisoformat(metadata.get("date_from", ""))
            meta_date_to = datetime.fromisoformat(metadata.get("date_to", ""))
            if meta_date_from.date() != date_from.date() or meta_date_to.date() != date_to.date():
                return True, f"Cache date range mismatch: {meta_date_from.date()} to {meta_date_to.date()} vs {date_from.date()} to {date_to.date()}"
        
        if interval_seconds and metadata.get("interval_seconds") != interval_seconds:
            return True, f"Cache interval mismatch: {metadata.get('interval_seconds')} vs {interval_seconds}"
        
        if horizon_hours and metadata.get("horizon_hours") != horizon_hours:
            return True, f"Cache horizon mismatch: {metadata.get('horizon_hours')} vs {horizon_hours}"
    
    return False, None

def validate_baseline_cache(
    cache_path: Path,
    date_from: datetime,
    date_to: datetime,
    interval_seconds: int = 60,
    horizon_hours: int = 48,
    force_recompute: bool = False,
    auto_invalidate_stale: bool = True,
    max_age_days: int = 7,
) -> Tuple[bool, Optional[str]]:
    """
    Validate that baseline cache matches expected parameters.
    
    Args:
        cache_path: Path to baseline cache parquet file
        date_from: Expected start date
        date_to: Expected end date
        interval_seconds: Expected interval (for future validation)
        horizon_hours: Expected horizon (for future validation)
        force_recompute: If True, always return False (force recomputation)
        auto_invalidate_stale: If True, automatically invalidate stale caches
        max_age_days: Maximum age in days before cache is considered stale
    
    Returns:
        (is_valid, error_message)
    """
    if force_recompute:
        return False, "Force recompute requested"
    
    # Check if cache is stale
    if auto_invalidate_stale:
        is_stale, stale_reason = is_cache_stale(
            cache_path,
            max_age_days=max_age_days,
            check_params=True,
            date_from=date_from,
            date_to=date_to,
            interval_seconds=interval_seconds,
            horizon_hours=horizon_hours,
        )
        if is_stale:
            return False, f"Cache is stale: {stale_reason}"
    
    try:
        import pandas as pd
        
        df = pd.read_parquet(cache_path)
        
        if len(df) == 0:
            return False, "Cache file is empty"
        
        # Check date range matches (approximate)
        if 'alert_ts_utc' in df.columns:
            cache_dates = pd.to_datetime(df['alert_ts_utc'])
            cache_min = cache_dates.min()
            cache_max = cache_dates.max()
            
            # Convert to timezone-naive for comparison
            if cache_min.tz is not None:
                cache_min = cache_min.tz_localize(None)
            if cache_max.tz is not None:
                cache_max = cache_max.tz_localize(None)
            
            date_from_ts = pd.Timestamp(date_from)
            date_to_ts = pd.Timestamp(date_to)
            
            # Make timezone-naive if needed
            if date_from_ts.tz is not None:
                date_from_ts = date_from_ts.tz_localize(None)
            if date_to_ts.tz is not None:
                date_to_ts = date_to_ts.tz_localize(None)
            
            # Allow some tolerance (cache might have alerts slightly outside range)
            if cache_min > date_to_ts or cache_max < date_from_ts:
                return False, f"Cache date range ({cache_min.date()} to {cache_max.date()}) doesn't match requested ({date_from.date()} to {date_to.date()})"
        
        # Check required columns exist
        required_cols = ['alert_id', 'mint', 'caller', 'entry_price', 'ath_mult', 'dd_initial']
        missing_cols = [col for col in required_cols if col not in df.columns]
        if missing_cols:
            return False, f"Cache missing required columns: {missing_cols}"
        
        return True, None
        
    except Exception as e:
        return False, f"Failed to validate cache: {e}"


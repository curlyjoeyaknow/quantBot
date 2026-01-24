"""
ClickHouse slice exporter.

Streams candle data from ClickHouse to Parquet with:
- Batched IN() queries to avoid query string explosions
- Parallel batch fetching with ThreadPoolExecutor
- Streaming row iteration to avoid RAM exhaustion
- Batched DuckDB inserts for speed
- Quality validation and gap detection
- Optional gap filling for small gaps
"""

from __future__ import annotations

import hashlib
import json
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from queue import Queue, Empty as QueueEmpty
from typing import Any, Dict, List, Optional, Set, Tuple

# Add tools directory to path for shared imports (needed for tools.shared.duckdb_adapter)
_tools_dir = Path(__file__).resolve().parent.parent.parent.parent
if str(_tools_dir) not in sys.path:
    sys.path.insert(0, str(_tools_dir))

from .helpers import batched, dt_to_ch, sql_escape  # noqa: E402
from .slice_quality import QualityMetrics, analyze_candles  # noqa: E402

UTC = timezone.utc

# Optional import - may not be installed
try:
    from clickhouse_driver import Client as ClickHouseClient
except ImportError:
    ClickHouseClient = None  # type: ignore


@dataclass(frozen=True)
class ClickHouseCfg:
    """ClickHouse connection configuration."""

    host: str
    port: int
    database: str
    table: str
    user: str
    password: str
    connect_timeout: int = 10
    send_receive_timeout: int = 300

    def get_client(self):
        """Create a ClickHouse client from this configuration."""
        if ClickHouseClient is None:
            raise SystemExit("clickhouse-driver not installed. Run: pip install clickhouse-driver")
        return ClickHouseClient(
            host=self.host,
            port=self.port,
            database=self.database,
            user=self.user,
            password=self.password,
            connect_timeout=self.connect_timeout,
            send_receive_timeout=self.send_receive_timeout,
        )


def query_coverage_batched(
    cfg: ClickHouseCfg,
    chain: str,
    mints: Set[str],
    interval_seconds: int,
    date_from: datetime,
    date_to: datetime,
    ch_batch: int = 1000,
    parallel: int = 4,
) -> Dict[str, int]:
    """
    Query candle counts per token from ClickHouse.

    Uses batched IN() lists to avoid query string explosions.
    Runs batches in parallel for speed.

    Args:
        cfg: ClickHouse configuration
        chain: Chain name
        mints: Set of mint addresses to check
        interval_seconds: Candle interval
        date_from: Start date
        date_to: End date (exclusive of next day)
        ch_batch: Max mints per IN() clause
        parallel: Number of parallel workers

    Returns:
        Dict mapping mint address to candle count
    """
    if not mints:
        return {}

    chain_q = sql_escape(chain)
    mints_list = sorted(mints)
    chunks = list(batched(mints_list, ch_batch))

    def fetch_chunk(chunk: List[str]) -> List[Tuple[str, int]]:
        client = cfg.get_client()
        mint_list = ", ".join(f"'{sql_escape(m)}'" for m in chunk)
        sql = f"""
SELECT
  token_address,
  count() as candle_count
FROM {cfg.database}.{cfg.table}
WHERE chain = '{chain_q}'
  AND token_address IN ({mint_list})
  AND interval_seconds = {int(interval_seconds)}
  AND timestamp >= toDateTime('{dt_to_ch(date_from)}')
  AND timestamp <  toDateTime('{dt_to_ch(date_to + timedelta(days=1))}')
GROUP BY token_address
""".strip()
        return client.execute(sql)

    out: Dict[str, int] = {}

    if len(chunks) == 1 or parallel <= 1:
        # Single-threaded for small datasets
        for chunk in chunks:
            rows = fetch_chunk(chunk)
            for token_address, candle_count in rows:
                out[str(token_address)] = int(candle_count)
    else:
        # Parallel execution
        with ThreadPoolExecutor(max_workers=min(parallel, len(chunks))) as executor:
            futures = {executor.submit(fetch_chunk, chunk): i for i, chunk in enumerate(chunks)}
            for future in as_completed(futures):
                rows = future.result()
                for token_address, candle_count in rows:
                    out[str(token_address)] = int(candle_count)

    return out


def _fetch_chunk_streaming(
    cfg: ClickHouseCfg,
    chain_q: str,
    chunk: List[str],
    interval_seconds: int,
    expanded_from: datetime,
    expanded_to: datetime,
    queue: Queue,
    chunk_idx: int,
) -> int:
    """Fetch a chunk of mints from ClickHouse and put rows in queue."""
    client = cfg.get_client()
    mint_list = ", ".join(f"'{sql_escape(m)}'" for m in chunk)
    sql = f"""
SELECT
  token_address,
  timestamp,
  open,
  high,
  low,
  close,
  volume
FROM {cfg.database}.{cfg.table}
WHERE chain = '{chain_q}'
  AND token_address IN ({mint_list})
  AND interval_seconds = {int(interval_seconds)}
  AND timestamp >= toDateTime('{dt_to_ch(expanded_from)}')
  AND timestamp <  toDateTime('{dt_to_ch(expanded_to)}')
ORDER BY token_address, timestamp
""".strip()

    count = 0
    batch: List[Tuple[Any, ...]] = []
    batch_size = 10_000

    for row in client.execute_iter(sql):
        batch.append(row)
        count += 1
        if len(batch) >= batch_size:
            queue.put(batch)
            batch = []

    if batch:
        queue.put(batch)

    return count


@dataclass
class ExportResult:
    """Result of a slice export operation."""
    
    row_count: int
    quality: Optional[QualityMetrics] = None
    output_path: Optional[Path] = None
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization."""
        return {
            "row_count": self.row_count,
            "output_path": str(self.output_path) if self.output_path else None,
            "quality": self.quality.to_dict() if self.quality else None,
        }


def export_slice_streaming(
    cfg: ClickHouseCfg,
    chain: str,
    mints: Set[str],
    interval_seconds: int,
    date_from: datetime,
    date_to: datetime,
    output_path: Path,
    ch_batch: int = 1000,
    pre_window_minutes: int = 60,
    post_window_hours: int = 72,
    parallel: int = 4,
    verbose: bool = False,
    validate: bool = True,
    deduplicate: bool = True,
) -> int:
    """
    Stream candles from ClickHouse to a Parquet file.

    Uses parallel batch fetching and streaming DuckDB inserts.

    IMPORTANT: date_to is treated as the start of that day (midnight).
    To include the full end day, we add 1 day before adding post_window_hours.

    Args:
        cfg: ClickHouse configuration
        chain: Chain name
        mints: Set of mint addresses to export
        interval_seconds: Candle interval
        date_from: Start date
        date_to: End date (inclusive - full day included)
        output_path: Path to output Parquet file
        ch_batch: Max mints per query
        pre_window_minutes: Minutes before date_from to include
        post_window_hours: Hours after date_to to include
        parallel: Number of parallel CH fetch workers
        verbose: Print progress
        validate: Run quality validation after export
        deduplicate: Use GROUP BY to deduplicate candles

    Returns:
        Number of rows exported
    """
    result = export_slice_streaming_with_quality(
        cfg=cfg,
        chain=chain,
        mints=mints,
        interval_seconds=interval_seconds,
        date_from=date_from,
        date_to=date_to,
        output_path=output_path,
        ch_batch=ch_batch,
        pre_window_minutes=pre_window_minutes,
        post_window_hours=post_window_hours,
        parallel=parallel,
        verbose=verbose,
        validate=validate,
        deduplicate=deduplicate,
    )
    return result.row_count


def export_slice_streaming_with_quality(
    cfg: ClickHouseCfg,
    chain: str,
    mints: Set[str],
    interval_seconds: int,
    date_from: datetime,
    date_to: datetime,
    output_path: Path,
    ch_batch: int = 1000,
    pre_window_minutes: int = 60,
    post_window_hours: int = 72,
    parallel: int = 4,
    verbose: bool = False,
    validate: bool = True,
    deduplicate: bool = True,
) -> ExportResult:
    """
    Stream candles from ClickHouse to a Parquet file with quality validation.

    Uses parallel batch fetching and streaming DuckDB inserts.

    IMPORTANT: date_to is treated as the start of that day (midnight).
    To include the full end day, we add 1 day before adding post_window_hours.

    Args:
        cfg: ClickHouse configuration
        chain: Chain name
        mints: Set of mint addresses to export
        interval_seconds: Candle interval
        date_from: Start date
        date_to: End date (inclusive - full day included)
        output_path: Path to output Parquet file
        ch_batch: Max mints per query
        pre_window_minutes: Minutes before date_from to include
        post_window_hours: Hours after date_to to include
        parallel: Number of parallel CH fetch workers
        verbose: Print progress
        validate: Run quality validation after export
        deduplicate: Use GROUP BY to deduplicate candles

    Returns:
        ExportResult with row count and quality metrics
    """
    if not mints:
        return ExportResult(row_count=0, output_path=output_path)

    chain_q = sql_escape(chain)

    # Calculate time range
    expanded_from = date_from - timedelta(minutes=pre_window_minutes)
    # IMPORTANT: date_to is midnight-start; include the whole end day, then post window
    expanded_to = (date_to + timedelta(days=1)) + timedelta(hours=post_window_hours)

    output_path.parent.mkdir(parents=True, exist_ok=True)

    mints_list = sorted(mints)
    chunks = list(batched(mints_list, ch_batch))

    if verbose:
        print(f"[clickhouse] exporting {len(mints)} tokens in {len(chunks)} chunks (parallel={parallel})", file=sys.stderr)

    # For small datasets or single worker, use simple sequential approach
    if len(chunks) <= 2 or parallel <= 1:
        count, quality = _export_sequential(
            cfg, chain_q, chunks, interval_seconds, expanded_from, expanded_to, 
            output_path, verbose, validate, deduplicate
        )
        return ExportResult(row_count=count, quality=quality, output_path=output_path)

    # For larger datasets, use parallel fetching with queue-based DuckDB insertion
    count, quality = _export_parallel(
        cfg, chain_q, chunks, interval_seconds, expanded_from, expanded_to, 
        output_path, parallel, verbose, validate
    )
    return ExportResult(row_count=count, quality=quality, output_path=output_path)


def _export_sequential(
    cfg: ClickHouseCfg,
    chain_q: str,
    chunks: List[List[str]],
    interval_seconds: int,
    expanded_from: datetime,
    expanded_to: datetime,
    output_path: Path,
    verbose: bool,
    validate: bool = True,
    deduplicate: bool = True,
) -> Tuple[int, Optional[QualityMetrics]]:
    """
    Sequential export for small datasets.
    
    Improvements:
    - Optional deduplication using GROUP BY in query
    - Quality validation after export
    - Returns quality metrics for caller inspection
    
    Returns:
        Tuple of (row_count, quality_metrics)
    """
    from tools.shared.duckdb_adapter import get_connection
    client = cfg.get_client()
    all_rows: List[Tuple[Any, ...]] = []  # Keep for validation
    
    with get_connection(":memory:", read_only=False) as con:
        con.execute("""
            CREATE TABLE candles (
                token_address VARCHAR,
                timestamp TIMESTAMP,
                open DOUBLE,
                high DOUBLE,
                low DOUBLE,
                close DOUBLE,
                volume DOUBLE
            )
        """)

        inserted = 0
        row_batch: List[Tuple[Any, ...]] = []
        row_batch_size = 50_000

        for i, chunk in enumerate(chunks):
            mint_list = ", ".join(f"'{sql_escape(m)}'" for m in chunk)
            
            # Use GROUP BY for deduplication if enabled
            # Using any() picks one value per group, max(volume) keeps highest volume
            # Note: argMax would be better but some ClickHouse versions don't support it
            if deduplicate:
                sql = f"""
SELECT
  token_address,
  timestamp,
  any(open) as open,
  any(high) as high,
  any(low) as low,
  any(close) as close,
  max(volume) as volume
FROM {cfg.database}.{cfg.table}
WHERE chain = '{chain_q}'
  AND token_address IN ({mint_list})
  AND interval_seconds = {int(interval_seconds)}
  AND timestamp >= toDateTime('{dt_to_ch(expanded_from)}')
  AND timestamp <  toDateTime('{dt_to_ch(expanded_to)}')
GROUP BY token_address, timestamp
ORDER BY token_address, timestamp
""".strip()
            else:
                sql = f"""
SELECT
  token_address,
  timestamp,
  open,
  high,
  low,
  close,
  volume
FROM {cfg.database}.{cfg.table}
WHERE chain = '{chain_q}'
  AND token_address IN ({mint_list})
  AND interval_seconds = {int(interval_seconds)}
  AND timestamp >= toDateTime('{dt_to_ch(expanded_from)}')
  AND timestamp <  toDateTime('{dt_to_ch(expanded_to)}')
ORDER BY token_address, timestamp
""".strip()

            if verbose:
                print(f"[clickhouse] chunk {i+1}/{len(chunks)} tokens={len(chunk)}", file=sys.stderr)

            for row in client.execute_iter(sql):
                row_batch.append(row)
                if validate:
                    all_rows.append(row)
                if len(row_batch) >= row_batch_size:
                    con.executemany("INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?)", row_batch)
                    inserted += len(row_batch)
                    row_batch.clear()

        if row_batch:
            con.executemany("INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?)", row_batch)
            inserted += len(row_batch)
            row_batch.clear()

        con.execute(f"COPY candles TO '{sql_escape(str(output_path))}' (FORMAT PARQUET, COMPRESSION 'zstd')")
        count = int(con.execute("SELECT count(*) FROM candles").fetchone()[0])

        # Validate quality
        quality = None
        if validate and all_rows:
            expected_start = int(expanded_from.timestamp())
            expected_end = int(expanded_to.timestamp())
            quality = analyze_candles(all_rows, interval_seconds, expected_start, expected_end)
            
            if verbose:
                print(f"[clickhouse] quality: coverage={quality.coverage_pct:.1f}%, "
                      f"gaps={quality.gaps}, duplicates={quality.duplicates}", file=sys.stderr)

        if verbose:
            print(f"[clickhouse] exported {count:,} candles -> {output_path}", file=sys.stderr)

        return count, quality


def _export_parallel(
    cfg: ClickHouseCfg,
    chain_q: str,
    chunks: List[List[str]],
    interval_seconds: int,
    expanded_from: datetime,
    expanded_to: datetime,
    output_path: Path,
    parallel: int,
    verbose: bool,
    validate: bool = True,
) -> Tuple[int, Optional[QualityMetrics]]:
    """
    Parallel export with producer-consumer pattern.
    
    Fixed race conditions:
    - Uses QueueEmpty exception specifically (not bare except)
    - Ensures all data is drained before joining producer
    - Validates quality after export
    
    Returns:
        Tuple of (row_count, quality_metrics)
    """
    queue: Queue = Queue(maxsize=100)  # Limit memory usage
    done_event = threading.Event()
    total_fetched = [0]  # Use list for mutable capture
    fetch_errors: List[Exception] = []

    def producer():
        """Fetch chunks in parallel and put batches in queue."""
        try:
            with ThreadPoolExecutor(max_workers=min(parallel, len(chunks))) as executor:
                futures = {
                    executor.submit(
                        _fetch_chunk_streaming,
                        cfg, chain_q, chunk, interval_seconds, expanded_from, expanded_to, queue, i
                    ): i
                    for i, chunk in enumerate(chunks)
                }
                for future in as_completed(futures):
                    try:
                        count = future.result()
                        total_fetched[0] += count
                        if verbose:
                            chunk_idx = futures[future]
                            print(f"[clickhouse] chunk {chunk_idx+1}/{len(chunks)} fetched {count:,} rows", file=sys.stderr)
                    except Exception as e:
                        fetch_errors.append(e)
        finally:
            done_event.set()

    # Start producer thread
    producer_thread = threading.Thread(target=producer, daemon=True)
    producer_thread.start()

    # Consumer: insert into DuckDB
    from tools.shared.duckdb_adapter import get_connection
    all_rows: List[Tuple[Any, ...]] = []  # Keep for validation
    
    with get_connection(":memory:", read_only=False) as con:
        con.execute("""
            CREATE TABLE candles (
                token_address VARCHAR,
                timestamp TIMESTAMP,
                open DOUBLE,
                high DOUBLE,
                low DOUBLE,
                close DOUBLE,
                volume DOUBLE
            )
        """)

        inserted = 0
        
        # Main consumption loop - uses specific QueueEmpty exception
        while True:
            # Check if producer is done AND queue is empty
            if done_event.is_set() and queue.empty():
                break
                
            try:
                batch = queue.get(timeout=0.1)
                con.executemany("INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?)", batch)
                inserted += len(batch)
                if validate:
                    all_rows.extend(batch)
            except QueueEmpty:
                # Queue is temporarily empty, continue waiting
                continue
            except Exception as e:
                # Log unexpected errors but continue
                if verbose:
                    print(f"[clickhouse] consumer error: {e}", file=sys.stderr)
                continue

        # Final drain - ensure nothing is left in queue
        drain_count = 0
        while not queue.empty():
            try:
                batch = queue.get_nowait()
                con.executemany("INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?)", batch)
                inserted += len(batch)
                drain_count += len(batch)
                if validate:
                    all_rows.extend(batch)
            except QueueEmpty:
                break
        
        if verbose and drain_count > 0:
            print(f"[clickhouse] drained {drain_count:,} additional rows from queue", file=sys.stderr)

        # Wait for producer to fully complete
        producer_thread.join(timeout=30)
        if producer_thread.is_alive():
            print("[clickhouse] WARNING: producer thread did not complete in time", file=sys.stderr)

        if fetch_errors:
            raise fetch_errors[0]

        con.execute(f"COPY candles TO '{sql_escape(str(output_path))}' (FORMAT PARQUET, COMPRESSION 'zstd')")
        count = int(con.execute("SELECT count(*) FROM candles").fetchone()[0])

        # Validate quality
        quality = None
        if validate and all_rows:
            expected_start = int(expanded_from.timestamp())
            expected_end = int(expanded_to.timestamp())
            quality = analyze_candles(all_rows, interval_seconds, expected_start, expected_end)
            
            if verbose:
                print(f"[clickhouse] quality: coverage={quality.coverage_pct:.1f}%, "
                      f"gaps={quality.gaps}, duplicates={quality.duplicates}", file=sys.stderr)

        if verbose:
            print(f"[clickhouse] exported {count:,} candles (parallel) -> {output_path}", file=sys.stderr)

        return count, quality


# =============================================================================
# Parquet Lake v1 - Core Functions
# =============================================================================


def compute_mint_bucket(mint: str) -> str:
    """
    Compute mint bucket using SHA-1 first byte.
    
    Returns hex-encoded first byte (00..ff).
    This prevents per-token directory explosion.
    
    Args:
        mint: Token mint address
        
    Returns:
        2-character hex string (00-ff)
    """
    sha1_hash = hashlib.sha1(mint.encode()).digest()
    first_byte = sha1_hash[0]
    return f"{first_byte:02x}"


def floor_to_interval(ts_ms: int, interval_s: int) -> int:
    """
    Floor timestamp to interval boundary.
    
    Args:
        ts_ms: Timestamp in milliseconds
        interval_s: Interval in seconds
        
    Returns:
        Floored timestamp in milliseconds
    """
    step_ms = interval_s * 1000
    return (ts_ms // step_ms) * step_ms


def compute_window_slice(
    alert_ts_ms: int,
    interval_s: int,
    pre_candles: int,
    post_candles: int,
) -> Dict[str, int]:
    """
    Compute window slice around alert timestamp.
    
    Anchor candle is the candle that contains the alert timestamp.
    Window includes pre_candles before anchor and post_candles after.
    
    Args:
        alert_ts_ms: Alert timestamp in milliseconds
        interval_s: Candle interval in seconds
        pre_candles: Number of candles before anchor
        post_candles: Number of candles after anchor
        
    Returns:
        Dict with 'anchor_ts', 'start_ts', 'end_ts' (all in milliseconds)
    """
    anchor_ts = floor_to_interval(alert_ts_ms, interval_s)
    interval_ms = interval_s * 1000
    
    start_ts = anchor_ts - (pre_candles * interval_ms)
    end_ts = anchor_ts + ((post_candles + 1) * interval_ms)  # +1 to include anchor
    
    return {
        "anchor_ts": anchor_ts,
        "start_ts": start_ts,
        "end_ts": end_ts,
    }


@dataclass
class LakeCorpusConfig:
    """Configuration for global corpus export."""
    
    data_root: str
    interval: str  # e.g., "1s", "5s", "1m", "5m"
    date_from: str  # YYYY-MM-DD
    date_to: str  # YYYY-MM-DD (exclusive)
    engine: str = "ch"  # Source engine
    compression: str = "zstd"  # zstd, snappy, none
    target_file_mb: int = 512  # Target file size in MB
    mint_filter: Optional[List[str]] = None  # Optional mint filter list


@dataclass
class LakeRunSliceConfig:
    """Configuration for run-scoped slice export."""
    
    data_root: str
    run_id: str
    interval: str  # e.g., "1s", "5s", "1m"
    window: str  # e.g., "pre52_post4948"
    alerts_path: str  # Path to alerts.parquet or alerts.csv
    chain: str = "solana"
    compression: str = "zstd"  # zstd, snappy, none
    target_file_mb: int = 512  # Target file size in MB
    strict_coverage: bool = False  # Drop slices that don't meet coverage thresholds
    min_required_pre: int = 52  # Minimum pre-candles required
    target_total: int = 5000  # Target total candles per alert


def parse_window_spec(window: str) -> Tuple[int, int]:
    """
    Parse window spec string (e.g., "pre52_post4948").
    
    Args:
        window: Window spec string
        
    Returns:
        Tuple of (pre_candles, post_candles)
    """
    if not window.startswith("pre") or "_post" not in window:
        raise ValueError(f"Invalid window spec: {window}. Expected format: pre<N>_post<M>")
    
    parts = window.split("_post")
    pre_part = parts[0]
    post_part = parts[1]
    
    pre_candles = int(pre_part[3:])  # Remove "pre" prefix
    post_candles = int(post_part)
    
    return pre_candles, post_candles


def parse_config_from_json(config_path: Path) -> Dict[str, Any]:
    """
    Parse JSON config file for lake export.
    
    Args:
        config_path: Path to JSON config file
        
    Returns:
        Parsed config dictionary
    """
    with open(config_path, "r") as f:
        return json.load(f)


# =============================================================================
# Parquet Lake v1 - ClickHouse Query + Parquet Write
# =============================================================================

def interval_to_seconds(interval: str) -> int:
    """
    Convert interval string to seconds.
    
    Args:
        interval: Interval string (e.g., "1s", "5s", "1m", "5m", "1h")
        
    Returns:
        Interval in seconds
    """
    interval = interval.lower().strip()
    
    if interval.endswith("s"):
        return int(interval[:-1])
    elif interval.endswith("m"):
        return int(interval[:-1]) * 60
    elif interval.endswith("h"):
        return int(interval[:-1]) * 3600
    elif interval.endswith("d"):
        return int(interval[:-1]) * 86400
    else:
        # Try parsing as integer seconds
        return int(interval)


def _build_lake_query(
    mints: List[str],
    interval_s: int,
    time_range: Dict[str, datetime],
    chain: str,
    table: str,
) -> str:
    """
    Build ClickHouse query for lake export.
    
    Args:
        mints: List of mint addresses
        interval_s: Interval in seconds
        time_range: Dict with 'from' and 'to' datetime objects
        chain: Chain name
        table: ClickHouse table name
        
    Returns:
        SQL query string
    """
    mint_list = ", ".join(f"'{sql_escape(m)}'" for m in mints)
    from_dt = dt_to_ch(time_range["from"])
    to_dt = dt_to_ch(time_range["to"])
    
    query = f"""
SELECT
    token_address,
    timestamp,
    open,
    high,
    low,
    close,
    volume,
    interval_seconds
FROM {table}
WHERE chain = '{sql_escape(chain)}'
  AND token_address IN ({mint_list})
  AND interval_seconds = {interval_s}
  AND timestamp >= toDateTime('{from_dt}')
  AND timestamp < toDateTime('{to_dt}')
ORDER BY token_address, timestamp
""".strip()
    
    return query


def _write_partitioned_parquet(
    rows: List[Tuple[Any, ...]],
    output_dir: Path,
    bucket_fn: callable,
    compression: str = "zstd",
    target_file_mb: int = 512,
    verbose: bool = False,
) -> Dict[str, List[str]]:
    """
    Write partitioned Parquet files by mint_bucket.
    
    Creates directory structure:
    output_dir/mint_bucket=00/part-0000.parquet
    output_dir/mint_bucket=00/part-0001.parquet
    output_dir/mint_bucket=01/part-0000.parquet
    ...
    
    Args:
        rows: List of candle tuples (token_address, timestamp, open, high, low, close, volume, interval_seconds)
        output_dir: Base output directory
        bucket_fn: Function to compute bucket from mint (compute_mint_bucket)
        compression: Compression type (zstd, snappy, none)
        target_file_mb: Target file size in MB
        verbose: Print progress
        
    Returns:
        Dict mapping bucket (e.g., "00") to list of file paths created
    """
    from tools.shared.duckdb_adapter import get_connection
    
    # Group rows by bucket
    buckets: Dict[str, List[Tuple[Any, ...]]] = {}
    for row in rows:
        mint = row[0]  # token_address is first column
        bucket = bucket_fn(mint)
        if bucket not in buckets:
            buckets[bucket] = []
        buckets[bucket].append(row)
    
    # Write each bucket to its own directory
    bucket_files: Dict[str, List[str]] = {}
    # target_bytes reserved for future file size chunking logic
    
    with get_connection(":memory:", read_only=False) as con:
        # Set compression
        if compression != "none":
            con.execute(f"SET parquet_compression = '{compression}'")
        
        for bucket, bucket_rows in sorted(buckets.items()):
            bucket_dir = output_dir / f"mint_bucket={bucket}"
            bucket_dir.mkdir(parents=True, exist_ok=True)
            
            bucket_files[bucket] = []
            
            # Create temp table with mint_bucket column
            con.execute("""
                CREATE TABLE temp_candles (
                    mint VARCHAR,
                    ts TIMESTAMP,
                    open DOUBLE,
                    high DOUBLE,
                    low DOUBLE,
                    close DOUBLE,
                    volume DOUBLE,
                    interval_s INTEGER,
                    mint_bucket VARCHAR
                )
            """)
            
            # Insert rows with bucket column
            for row in bucket_rows:
                mint, ts, open_val, high, low, close, volume, interval_s = row
                bucket_val = bucket_fn(mint)
                con.execute(
                    "INSERT INTO temp_candles VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (mint, ts, open_val, high, low, close, volume, interval_s, bucket_val)
                )
            
            # Write Parquet files, chunking if needed
            # For now, write single file per bucket (can be enhanced later for chunking)
            part_idx = 0
            file_path = bucket_dir / f"part-{part_idx:04d}.parquet"
            
            # Select columns matching OHLCV spec: mint, ts, interval_s, open, high, low, close, volume, source
            # Note: source column not in ClickHouse data, will be added as constant or left out
            con.execute(f"""
                COPY (
                    SELECT 
                        mint,
                        ts,
                        interval_s,
                        open,
                        high,
                        low,
                        close,
                        volume
                    FROM temp_candles
                    ORDER BY mint, ts
                )
                TO '{sql_escape(str(file_path))}'
                (FORMAT PARQUET)
            """)
            
            bucket_files[bucket].append(str(file_path))
            
            if verbose:
                count = len(bucket_rows)
                print(f"[lake] bucket {bucket}: {count:,} rows -> {file_path.name}", file=sys.stderr)
            
            con.execute("DROP TABLE temp_candles")
    
    return bucket_files


# =============================================================================
# Parquet Lake v1 - Coverage Tracking + Manifest Sealing
# =============================================================================

@dataclass
class AlertCoverage:
    """Coverage metrics for a single alert."""
    
    alert_id: str
    mint: str
    anchor_ts_ms: int
    available_pre: int  # Number of candles before anchor
    available_post: int  # Number of candles after anchor
    available_total: int  # Total candles available
    first_ts_ms: Optional[int]  # First candle timestamp (ms)
    last_ts_ms: Optional[int]  # Last candle timestamp (ms)
    status: str  # "complete", "partial", "insufficient"


def compute_coverage(
    alerts: List[Dict[str, Any]],
    candles_by_mint: Dict[str, List[Tuple[Any, ...]]],
    interval_s: int,
    pre_candles: int,
    post_candles: int,
) -> List[AlertCoverage]:
    """
    Compute coverage metrics for each alert.
    
    Args:
        alerts: List of alert dicts with 'alert_id', 'mint', 'ts_ms' keys
        candles_by_mint: Dict mapping mint to list of candle tuples (mint, ts, open, high, low, close, volume, interval_s)
        interval_s: Candle interval in seconds
        pre_candles: Required candles before anchor
        post_candles: Required candles after anchor
        
    Returns:
        List of AlertCoverage objects
    """
    coverage_list = []
    # interval_ms reserved for future use
    
    for alert in alerts:
        alert_id = alert["alert_id"]
        mint = alert["mint"]
        alert_ts_ms = alert["ts_ms"]
        
        # Compute anchor and window
        anchor_ts = floor_to_interval(alert_ts_ms, interval_s)
        window = compute_window_slice(alert_ts_ms, interval_s, pre_candles, post_candles)
        
        # Get candles for this mint
        candles = candles_by_mint.get(mint, [])
        
        if not candles:
            # No candles available
            coverage_list.append(AlertCoverage(
                alert_id=alert_id,
                mint=mint,
                anchor_ts_ms=anchor_ts,
                available_pre=0,
                available_post=0,
                available_total=0,
                first_ts_ms=None,
                last_ts_ms=None,
                status="insufficient",
            ))
            continue
        
        # Convert candle timestamps to ms (assuming they're datetime objects)
        candle_ts_ms_list = []
        for candle in candles:
            ts = candle[1]  # timestamp is second column
            if isinstance(ts, datetime):
                ts_ms = int(ts.timestamp() * 1000)
            else:
                ts_ms = int(ts)  # Assume already in ms
            candle_ts_ms_list.append(ts_ms)
        
        # Filter candles within window
        window_candles = [
            ts_ms for ts_ms in candle_ts_ms_list
            if window["start_ts"] <= ts_ms < window["end_ts"]
        ]
        
        if not window_candles:
            coverage_list.append(AlertCoverage(
                alert_id=alert_id,
                mint=mint,
                anchor_ts_ms=anchor_ts,
                available_pre=0,
                available_post=0,
                available_total=0,
                first_ts_ms=None,
                last_ts_ms=None,
                status="insufficient",
            ))
            continue
        
        # Count candles before and after anchor
        # Note: We count all candles in the window, not just those within pre/post limits
        available_pre = sum(1 for ts_ms in window_candles if ts_ms < anchor_ts)
        available_post = sum(1 for ts_ms in window_candles if ts_ms >= anchor_ts)
        available_total = len(window_candles)
        
        first_ts_ms = min(window_candles)
        last_ts_ms = max(window_candles)
        
        # Determine status
        # Complete: has enough pre and total candles
        # Partial: has some candles but not enough
        # Insufficient: no candles
        if available_total == 0:
            status = "insufficient"
        elif available_pre >= pre_candles and available_total >= (pre_candles + post_candles):
            status = "complete"
        else:
            status = "partial"
        
        coverage_list.append(AlertCoverage(
            alert_id=alert_id,
            mint=mint,
            anchor_ts_ms=anchor_ts,
            available_pre=available_pre,
            available_post=available_post,
            available_total=available_total,
            first_ts_ms=first_ts_ms,
            last_ts_ms=last_ts_ms,
            status=status,
        ))
    
    return coverage_list


def _write_coverage_parquet(
    coverage_list: List[AlertCoverage],
    output_path: Path,
    compression: str = "zstd",
) -> None:
    """
    Write coverage metrics to Parquet file.
    
    Args:
        coverage_list: List of AlertCoverage objects
        output_path: Path to output Parquet file
        compression: Compression type
    """
    from tools.shared.duckdb_adapter import get_connection
    
    with get_connection(":memory:", read_only=False) as con:
        if compression != "none":
            con.execute(f"SET parquet_compression = '{compression}'")
        
        # Create table
        con.execute("""
            CREATE TABLE coverage (
                alert_id VARCHAR,
                mint VARCHAR,
                anchor_ts_ms BIGINT,
                available_pre INTEGER,
                available_post INTEGER,
                available_total INTEGER,
                first_ts_ms BIGINT,
                last_ts_ms BIGINT,
                status VARCHAR
            )
        """)
        
        # Insert coverage data
        for cov in coverage_list:
            con.execute(
                "INSERT INTO coverage VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    cov.alert_id,
                    cov.mint,
                    cov.anchor_ts_ms,
                    cov.available_pre,
                    cov.available_post,
                    cov.available_total,
                    cov.first_ts_ms,
                    cov.last_ts_ms,
                    cov.status,
                )
            )
        
        # Write Parquet
        con.execute(f"""
            COPY coverage
            TO '{sql_escape(str(output_path))}'
            (FORMAT PARQUET)
        """)
        
        con.execute("DROP TABLE coverage")


def write_manifest_json(
    manifest: Dict[str, Any],
    manifest_path: Path,
) -> None:
    """
    Write manifest.json atomically (temp file + rename).
    
    This ensures manifest is only written after all Parquet files are complete.
    
    Args:
        manifest: Manifest dictionary
        manifest_path: Path to manifest.json
    """
    # Write to temp file first
    temp_path = manifest_path.with_suffix(".json.tmp")
    
    with open(temp_path, "w") as f:
        json.dump(manifest, f, indent=2)
    
    # Atomic rename
    temp_path.replace(manifest_path)


def _load_alerts_from_file(alerts_path: Path) -> List[Dict[str, Any]]:
    """
    Load alerts from parquet or csv file.
    
    Args:
        alerts_path: Path to alerts.parquet or alerts.csv
        
    Returns:
        List of alert dicts with 'alert_id', 'mint', 'ts_ms' keys
    """
    alerts_path = Path(alerts_path)
    
    if alerts_path.suffix == ".parquet":
        import pandas as pd
        df = pd.read_parquet(alerts_path)
        
        # Convert to list of dicts
        alerts = []
        for _, row in df.iterrows():
            # Handle different column name variations
            alert_id = row.get("alert_id") or row.get("id") or str(hash((row.get("mint"), row.get("ts"))))
            mint = row.get("mint") or row.get("token_address")
            ts = row.get("ts") or row.get("timestamp") or row.get("ts_ms")
            
            # Convert timestamp to ms if needed
            if isinstance(ts, datetime):
                ts_ms = int(ts.timestamp() * 1000)
            elif isinstance(ts, (int, float)):
                # Assume already in ms if > 1e12, otherwise seconds
                ts_ms = int(ts * 1000) if ts < 1e12 else int(ts)
            else:
                raise ValueError(f"Invalid timestamp format: {ts}")
            
            alerts.append({
                "alert_id": str(alert_id),
                "mint": str(mint),
                "ts_ms": ts_ms,
            })
        
        return alerts
    
    elif alerts_path.suffix == ".csv":
        import csv
        alerts = []
        with open(alerts_path, "r") as f:
            reader = csv.DictReader(f)
            for row in reader:
                alert_id = row.get("alert_id") or row.get("id") or str(hash((row.get("mint"), row.get("ts"))))
                mint = row.get("mint") or row.get("token_address")
                ts_str = row.get("ts") or row.get("timestamp") or row.get("ts_ms")
                
                # Parse timestamp
                try:
                    ts_dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
                    ts_ms = int(ts_dt.timestamp() * 1000)
                except ValueError:
                    # Try as integer
                    ts_ms = int(float(ts_str))
                    if ts_ms < 1e12:
                        ts_ms = ts_ms * 1000
                
                alerts.append({
                    "alert_id": str(alert_id),
                    "mint": str(mint),
                    "ts_ms": ts_ms,
                })
        
        return alerts
    
    else:
        raise ValueError(f"Unsupported alerts file format: {alerts_path.suffix}")


def export_lake_run_slices(
    config: LakeRunSliceConfig,
    ch_cfg: ClickHouseCfg,
    verbose: bool = False,
) -> Dict[str, Any]:
    """
    Main entry point for run-scoped slice export.
    
    Implements full Parquet Lake v1 export workflow:
    1. Load alerts from parquet/csv
    2. Query ClickHouse for OHLCV window ranges
    3. Write partitioned Parquet by mint_bucket
    4. Compute coverage metrics
    5. Write coverage.parquet
    6. Write manifest.json last (seal)
    
    Args:
        config: LakeRunSliceConfig
        ch_cfg: ClickHouse configuration
        verbose: Print progress
        
    Returns:
        Export result dict with manifest info
    """
    # Parse window spec
    pre_candles, post_candles = parse_window_spec(config.window)
    interval_s = interval_to_seconds(config.interval)
    
    # Build output paths
    data_root = Path(config.data_root)
    lake_root = data_root / "lake"
    run_dir = lake_root / "runs" / f"run_id={config.run_id}"
    slices_dir = run_dir / "slices" / "ohlcv" / f"interval={config.interval}" / f"window={config.window}"
    inputs_dir = run_dir / "inputs"
    outputs_dir = run_dir / "outputs"
    
    # Create directories
    slices_dir.mkdir(parents=True, exist_ok=True)
    inputs_dir.mkdir(parents=True, exist_ok=True)
    outputs_dir.mkdir(parents=True, exist_ok=True)
    
    # 1. Load alerts
    alerts_path = Path(config.alerts_path)
    alerts = _load_alerts_from_file(alerts_path)
    
    if verbose:
        print(f"[lake] loaded {len(alerts)} alerts from {alerts_path}", file=sys.stderr)
    
    # Copy alerts to inputs directory
    import shutil
    alerts_input_path = inputs_dir / "alerts.parquet"
    if alerts_path.suffix == ".parquet":
        shutil.copy2(alerts_path, alerts_input_path)
    else:
        # Convert CSV to Parquet
        import pandas as pd
        df = pd.read_csv(alerts_path)
        df.to_parquet(alerts_input_path)
    
    # 2. Query ClickHouse for candles
    mints = list(set(alert["mint"] for alert in alerts))
    
    # Compute time range from alerts
    all_ts_ms = [alert["ts_ms"] for alert in alerts]
    min_ts_ms = min(all_ts_ms)
    max_ts_ms = max(all_ts_ms)
    
    # Expand window for all alerts
    earliest_window = compute_window_slice(min_ts_ms, interval_s, pre_candles, post_candles)
    latest_window = compute_window_slice(max_ts_ms, interval_s, pre_candles, post_candles)
    
    time_range = {
        "from": datetime.fromtimestamp(earliest_window["start_ts"] / 1000, tz=UTC),
        "to": datetime.fromtimestamp(latest_window["end_ts"] / 1000, tz=UTC),
    }
    
    if verbose:
        print(f"[lake] querying ClickHouse for {len(mints)} mints, time range: {time_range['from']} to {time_range['to']}", file=sys.stderr)
    
    # Query ClickHouse
    client = ch_cfg.get_client()
    query = _build_lake_query(mints, interval_s, time_range, config.chain, f"{ch_cfg.database}.{ch_cfg.table}")
    
    all_rows: List[Tuple[Any, ...]] = []
    for row in client.execute_iter(query):
        all_rows.append(row)
    
    if verbose:
        print(f"[lake] fetched {len(all_rows):,} candles from ClickHouse", file=sys.stderr)
    
    # Group candles by mint
    candles_by_mint: Dict[str, List[Tuple[Any, ...]]] = {}
    for row in all_rows:
        mint = row[0]  # token_address
        if mint not in candles_by_mint:
            candles_by_mint[mint] = []
        candles_by_mint[mint].append(row)
    
    # 3. Write partitioned Parquet files
    bucket_files = _write_partitioned_parquet(
        all_rows,
        slices_dir,
        compute_mint_bucket,
        compression=config.compression,
        target_file_mb=config.target_file_mb,
        verbose=verbose,
    )
    
    # 4. Compute coverage
    coverage_list = compute_coverage(
        alerts,
        candles_by_mint,
        interval_s,
        pre_candles,
        post_candles,
    )
    
    # Filter alerts if strict mode
    if config.strict_coverage:
        kept_alerts = [
            alert for alert, cov in zip(alerts, coverage_list)
            if cov.available_pre >= config.min_required_pre
            and cov.available_total >= config.target_total
        ]
        dropped_count = len(alerts) - len(kept_alerts)
        if verbose and dropped_count > 0:
            print(f"[lake] strict mode: dropped {dropped_count} alerts with insufficient coverage", file=sys.stderr)
    else:
        kept_alerts = alerts
        dropped_count = 0
    
    # 5. Write coverage.parquet
    coverage_path = outputs_dir / "coverage.parquet"
    _write_coverage_parquet(coverage_list, coverage_path, compression=config.compression)
    
    # 6. Generate manifest
    # Compute SHA-256 hash of alerts file
    import hashlib
    alerts_hash = hashlib.sha256()
    with open(alerts_input_path, "rb") as f:
        alerts_hash.update(f.read())
    alerts_sha256 = alerts_hash.hexdigest()
    
    # Count total rows and files
    total_rows = len(all_rows)
    total_files = sum(len(files) for files in bucket_files.values())
    total_bytes = sum(
        Path(f).stat().st_size
        for files in bucket_files.values()
        for f in files
    )
    
    manifest = {
        "lake_version": "v1",
        "run_id": config.run_id,
        "created_at": datetime.now(UTC).isoformat(),
        "exporter": {
            "name": "slice_exporter",
            "version": "1.0.0",
        },
        "inputs": {
            "alerts": {
                "path": "inputs/alerts.parquet",
                "sha256": alerts_sha256,
                "rows": len(alerts),
            },
            "source_snapshot": {
                "clickhouse": {
                    "cluster": ch_cfg.host,
                    "database": ch_cfg.database,
                    "table": ch_cfg.table,
                    "as_of": datetime.now(UTC).isoformat(),
                },
            },
        },
        "slice_spec": {
            "dataset": "ohlcv",
            "interval": config.interval,
            "window": config.window,
            "anchor_rule": "floor_to_interval(ts, interval)",
        },
        "outputs": {
            f"slices/ohlcv/interval={config.interval}/window={config.window}": {
                "mint_buckets": sorted(bucket_files.keys()),
                "files": total_files,
                "rows": total_rows,
            },
        },
        "coverage": {
            "min_required_pre": config.min_required_pre,
            "target_total": config.target_total,
            "kept_events": len(kept_alerts),
            "dropped_events": dropped_count,
        },
    }
    
    # 7. Write manifest.json LAST (seal)
    manifest_path = run_dir / "manifest.json"
    write_manifest_json(manifest, manifest_path)
    
    if verbose:
        print(f"[lake] export complete: {total_rows:,} rows, {total_files} files, manifest sealed", file=sys.stderr)
    
    return {
        "manifest": manifest,
        "manifest_path": str(manifest_path),
        "coverage_path": str(coverage_path),
        "total_rows": total_rows,
        "total_files": total_files,
        "total_bytes": total_bytes,
    }

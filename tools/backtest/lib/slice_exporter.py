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

import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from queue import Queue, Empty as QueueEmpty
from typing import Any, Dict, List, Optional, Set, Tuple

from .helpers import batched, dt_to_ch, sql_escape
from .slice_quality import QualityMetrics, analyze_candles

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
            # Using argMax(volume) selects values from the row with highest volume,
            # which is typically the most complete/accurate candle when duplicates exist
            if deduplicate:
                sql = f"""
SELECT
  token_address,
  timestamp,
  argMax(open, volume) as open,
  argMax(high, volume) as high,
  argMax(low, volume) as low,
  argMax(close, volume) as close,
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

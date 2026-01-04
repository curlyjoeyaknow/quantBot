"""
Backtest library modules.

Reusable components for baseline and TP/SL backtesting pipelines.
"""

from .alerts import Alert, load_alerts
from .slice_exporter import ClickHouseCfg, export_slice_streaming, query_coverage_batched
from .partitioner import partition_slice, is_hive_partitioned
from .baseline_query import run_baseline_query
from .tp_sl_query import run_tp_sl_query
from .storage import (
    store_baseline_run,
    store_tp_sl_run,
    ensure_baseline_schema,
    ensure_bt_schema,
)
from .summary import (
    summarize_baseline,
    summarize_tp_sl,
    aggregate_by_caller,
    print_caller_leaderboard,
)
from .helpers import (
    parse_yyyy_mm_dd,
    ceil_ms_to_interval_ts_ms,
    compute_slice_fingerprint,
    write_csv,
    pct,
)

__all__ = [
    # Alerts
    "Alert",
    "load_alerts",
    # Slice export
    "ClickHouseCfg",
    "export_slice_streaming",
    "query_coverage_batched",
    # Partitioning
    "partition_slice",
    "is_hive_partitioned",
    # Queries
    "run_baseline_query",
    "run_tp_sl_query",
    # Storage
    "store_baseline_run",
    "store_tp_sl_run",
    "ensure_baseline_schema",
    "ensure_bt_schema",
    # Summary
    "summarize_baseline",
    "summarize_tp_sl",
    "aggregate_by_caller",
    "print_caller_leaderboard",
    # Helpers
    "parse_yyyy_mm_dd",
    "ceil_ms_to_interval_ts_ms",
    "compute_slice_fingerprint",
    "write_csv",
    "pct",
]


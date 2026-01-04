#!/usr/bin/env python3
"""
Baseline per-alert backtest: ATH multiples, drawdowns, time-to-2x, simple TP/SL.

Architecture:
1. Load alerts from DuckDB
2. Query ClickHouse ONCE for coverage stats (which tokens have sufficient candles)
3. Filter alerts to only those with coverage
4. Export candle slice to Parquet (materialized, reproducible)
5. Run backtest from Parquet via DuckDB (offline, no ClickHouse during hot path)

Usage:
  # Console output (default)
  python alert_baseline_backtest.py --from 2025-05-01 --to 2025-05-31

  # JSON output for CLI integration
  python alert_baseline_backtest.py --from 2025-05-01 --to 2025-05-31 --output-format json

  # Skip slice export if already exists
  python alert_baseline_backtest.py --from 2025-05-01 --to 2025-05-31 --reuse-slice
"""
from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
import hashlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from statistics import median
from typing import Any, Dict, List, Optional, Set

import duckdb

try:
    from clickhouse_driver import Client as ClickHouseClient  # type: ignore[import-untyped]
except ImportError:
    print("ERROR: clickhouse-driver not installed. Run: pip install clickhouse-driver", file=sys.stderr)
    sys.exit(1)

# Rich TUI (optional, graceful fallback)
try:
    from rich.console import Console, Group
    from rich.live import Live
    from rich.panel import Panel
    from rich.progress import Progress, SpinnerColumn, BarColumn, TextColumn, TimeElapsedColumn
    from rich.table import Table
    from rich.text import Text
    from rich.layout import Layout
    RICH_AVAILABLE = True
except ImportError:
    RICH_AVAILABLE = False


# -----------------------------
# Helpers
# -----------------------------

UTC = timezone.utc


def parse_yyyy_mm_dd(s: str) -> datetime:
    """Parse date string (inclusive lower bound in UTC at 00:00)"""
    return datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=UTC)


def dt_to_ch(dt: datetime) -> str:
    """Format datetime for ClickHouse (YYYY-MM-DD HH:MM:SS)"""
    return dt.astimezone(UTC).strftime("%Y-%m-%d %H:%M:%S")


def ceil_to_interval(dt: datetime, interval_seconds: int) -> datetime:
    """Ceil datetime to next interval boundary"""
    ts = dt.timestamp()
    q = int(math.ceil(ts / interval_seconds) * interval_seconds)
    return datetime.fromtimestamp(q, tz=UTC)


def pct(x: float) -> float:
    """Convert ratio to percentage"""
    return 100.0 * x


def safe_sql_string(s: str) -> str:
    """Escape single quotes for SQL"""
    return s.replace("'", "''")


@dataclass(frozen=True)
class Alert:
    mint: str
    ts_ms: int
    caller: str

    @property
    def ts(self) -> datetime:
        return datetime.fromtimestamp(self.ts_ms / 1000.0, tz=UTC)


@dataclass
class Candle:
    ts: datetime
    o: float
    h: float
    l: float
    c: float
    v: float


# -----------------------------
# DuckDB: read alerts
# -----------------------------


def duckdb_table_exists(conn: duckdb.DuckDBPyConnection, table_name: str) -> bool:
    q = """
    SELECT COUNT(*)::INT
    FROM information_schema.tables
    WHERE table_name = ?
    """
    return conn.execute(q, [table_name]).fetchone()[0] > 0


def load_alerts(
    duckdb_path: str, chain: str, date_from: datetime, date_to: datetime
) -> List[Alert]:
    """
    Pull alerts from caller_links_d or user_calls_d.
    Dynamically detects schema columns.
    """
    conn = duckdb.connect(duckdb_path, read_only=True)

    from_ms = int(date_from.timestamp() * 1000)
    end_excl = date_to + timedelta(days=1)
    to_ms_excl = int(end_excl.timestamp() * 1000)

    has_caller_links = duckdb_table_exists(conn, "caller_links_d")
    has_user_calls = duckdb_table_exists(conn, "user_calls_d")

    if not has_caller_links and not has_user_calls:
        raise SystemExit(
            f"No alerts source found in DuckDB: {duckdb_path}\n"
            "Expected caller_links_d or user_calls_d."
        )

    alerts: List[Alert] = []

    if has_caller_links:
        cols = [
            r[1].lower()
            for r in conn.execute("PRAGMA table_info('caller_links_d')").fetchall()
        ]
        has_chain = "chain" in cols
        has_trigger_from_name = "trigger_from_name" in cols
        has_caller_name = "caller_name" in cols

        if has_trigger_from_name:
            caller_expr = "COALESCE(trigger_from_name, '')::TEXT AS caller"
        elif has_caller_name:
            caller_expr = "COALESCE(caller_name, '')::TEXT AS caller"
        else:
            caller_expr = "''::TEXT AS caller"

        sql = f"""
        SELECT DISTINCT
          mint::TEXT AS mint,
          trigger_ts_ms::BIGINT AS ts_ms,
          {caller_expr}
        FROM caller_links_d
        WHERE mint IS NOT NULL
          AND trigger_ts_ms >= ?
          AND trigger_ts_ms <  ?
        """
        params: List[Any] = [from_ms, to_ms_excl]
        if has_chain:
            sql += " AND lower(chain) = lower(?)"
            params.append(chain)

        rows = conn.execute(sql, params).fetchall()
        for mint, ts_ms, caller in rows:
            if mint:
                alerts.append(Alert(mint=mint, ts_ms=int(ts_ms), caller=caller or ""))

    if (not alerts) and has_user_calls:
        cols = [
            r[1].lower()
            for r in conn.execute("PRAGMA table_info('user_calls_d')").fetchall()
        ]
        has_chain = "chain" in cols
        has_caller_name = "caller_name" in cols
        has_trigger_from_name = "trigger_from_name" in cols
        has_call_ts_ms = "call_ts_ms" in cols
        has_trigger_ts_ms = "trigger_ts_ms" in cols
        ts_col = (
            "call_ts_ms"
            if has_call_ts_ms
            else "trigger_ts_ms" if has_trigger_ts_ms else None
        )

        if ts_col is None:
            raise SystemExit(f"No timestamp column found in user_calls_d: {cols}")

        if has_caller_name:
            caller_expr = "COALESCE(caller_name, '')::TEXT AS caller"
        elif has_trigger_from_name:
            caller_expr = "COALESCE(trigger_from_name, '')::TEXT AS caller"
        else:
            caller_expr = "''::TEXT AS caller"

        sql = f"""
        SELECT DISTINCT
          mint::TEXT AS mint,
          {ts_col}::BIGINT AS ts_ms,
          {caller_expr}
        FROM user_calls_d
        WHERE mint IS NOT NULL
          AND {ts_col} >= ?
          AND {ts_col} <  ?
        """
        params = [from_ms, to_ms_excl]
        if has_chain:
            sql += " AND lower(chain) = lower(?)"
            params.append(chain)

        rows = conn.execute(sql, params).fetchall()
        for mint, ts_ms, caller in rows:
            if mint:
                alerts.append(Alert(mint=mint, ts_ms=int(ts_ms), caller=caller or ""))

    conn.close()
    alerts.sort(key=lambda a: (a.ts_ms, a.mint))
    return alerts


# -----------------------------
# ClickHouse: coverage check and slice export
# -----------------------------


@dataclass(frozen=True)
class ClickHouseCfg:
    host: str
    port: int
    database: str
    table: str
    user: str
    password: str
    connect_timeout: int
    send_receive_timeout: int

    def get_client(self) -> ClickHouseClient:
        """Create a ClickHouse client connection."""
        return ClickHouseClient(
            host=self.host,
            port=self.port,
            database=self.database,
            user=self.user,
            password=self.password,
            connect_timeout=self.connect_timeout,
            send_receive_timeout=self.send_receive_timeout,
        )


def ch_query_rows(cfg: ClickHouseCfg, sql: str) -> List[Dict[str, Any]]:
    """Execute ClickHouse query and return rows as dicts."""
    client = cfg.get_client()
    result = client.execute(sql, with_column_types=True)
    rows_data, columns = result
    col_names = [col[0] for col in columns]
    return [dict(zip(col_names, row)) for row in rows_data]


def query_coverage(
    cfg: ClickHouseCfg,
    chain: str,
    mints: Set[str],
    interval_seconds: int,
    date_from: datetime,
    date_to: datetime,
    min_coverage_pct: float = 0.8,
) -> Dict[str, int]:
    """
    Query ClickHouse ONCE to get candle counts per token.
    Returns {mint: candle_count} for tokens meeting minimum coverage.
    """
    if not mints:
        return {}

    # Calculate required candles for coverage
    horizon_seconds = (date_to - date_from).total_seconds() + 86400  # +1 day inclusive
    required_candles = int((horizon_seconds / interval_seconds) * min_coverage_pct)

    chain_q = safe_sql_string(chain)

    # Build mint list for IN clause (batched to avoid huge queries)
    mint_list = ", ".join(f"'{safe_sql_string(m)}'" for m in mints)

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
HAVING candle_count >= {required_candles}
""".strip()

    rows = ch_query_rows(cfg, sql)
    return {row["token_address"]: int(row["candle_count"]) for row in rows}


def export_slice_to_parquet(
    cfg: ClickHouseCfg,
    chain: str,
    mints: Set[str],
    interval_seconds: int,
    date_from: datetime,
    date_to: datetime,
    output_path: Path,
) -> int:
    """
    Export candles for specified mints to Parquet file.
    Returns number of rows exported.
    """
    if not mints:
        return 0

    chain_q = safe_sql_string(chain)
    mint_list = ", ".join(f"'{safe_sql_string(m)}'" for m in mints)

    # Query all candles for covered mints
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
  AND timestamp >= toDateTime('{dt_to_ch(date_from)}')
  AND timestamp <  toDateTime('{dt_to_ch(date_to + timedelta(days=1))}')
ORDER BY token_address, timestamp
""".strip()

    client = cfg.get_client()
    result = client.execute(sql, with_column_types=True)
    rows_data, columns = result
    col_names = [col[0] for col in columns]

    if not rows_data:
        return 0

    output_path.parent.mkdir(parents=True, exist_ok=True)

    # Write to Parquet using DuckDB (avoids pandas dependency)
    conn = duckdb.connect(":memory:")

    # Create table with schema
    conn.execute("""
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

    # Insert data in batches
    batch_size = 10000
    for i in range(0, len(rows_data), batch_size):
        batch = rows_data[i : i + batch_size]
        conn.executemany(
            "INSERT INTO candles VALUES (?, ?, ?, ?, ?, ?, ?)", batch
        )

    # Export to Parquet
    conn.execute(f"COPY candles TO '{output_path}' (FORMAT PARQUET)")
    count = conn.execute("SELECT count(*) FROM candles").fetchone()[0]
    conn.close()

    return count


def load_candles_from_parquet(
    parquet_path: Path, mint: str, start_ts: datetime, end_ts: datetime
) -> List[Candle]:
    """Load candles for a specific mint from Parquet file using DuckDB."""
    conn = duckdb.connect(":memory:")

    sql = f"""
    SELECT timestamp, open, high, low, close, volume
    FROM '{parquet_path}'
    WHERE token_address = ?
      AND timestamp >= ?
      AND timestamp < ?
    ORDER BY timestamp
    """

    rows = conn.execute(
        sql, [mint, start_ts.strftime("%Y-%m-%d %H:%M:%S"), end_ts.strftime("%Y-%m-%d %H:%M:%S")]
    ).fetchall()
    conn.close()

    candles = []
    for row in rows:
        ts_val = row[0]
        if isinstance(ts_val, str):
            ts = datetime.strptime(ts_val, "%Y-%m-%d %H:%M:%S").replace(tzinfo=UTC)
        else:
            ts = ts_val.replace(tzinfo=UTC) if ts_val.tzinfo is None else ts_val
        candles.append(
            Candle(
                ts=ts,
                o=float(row[1]),
                h=float(row[2]),
                l=float(row[3]),
                c=float(row[4]),
                v=float(row[5]) if row[5] else 0.0,
            )
        )
    return candles


# -----------------------------
# Metrics + simple backtest policies
# -----------------------------


def compute_core_metrics(entry_price: float, candles: List[Candle]) -> Dict[str, Any]:
    highs = [c.h for c in candles]
    lows = [c.l for c in candles]
    closes = [c.c for c in candles]

    max_high = max(highs)
    min_low = min(lows)
    end_close = closes[-1]

    ath_mult = max_high / entry_price if entry_price > 0 else float("nan")
    dd_overall = (min_low / entry_price) - 1.0 if entry_price > 0 else float("nan")
    ret_end = (end_close / entry_price) - 1.0 if entry_price > 0 else float("nan")

    t2x_s: Optional[int] = None
    dd_pre2x: Optional[float] = None
    hit_idx: Optional[int] = None
    target = entry_price * 2.0

    for i, c in enumerate(candles):
        if c.h >= target:
            hit_idx = i
            t2x_s = int((c.ts - candles[0].ts).total_seconds())
            break

    if hit_idx is not None:
        pre_lows = [c.l for c in candles[: hit_idx + 1]]
        dd_pre2x = (min(pre_lows) / entry_price) - 1.0

    return {
        "ath_mult": ath_mult,
        "dd_overall": dd_overall,
        "ret_end": ret_end,
        "time_to_2x_s": t2x_s,
        "dd_pre2x": dd_pre2x,
    }


def simulate_tp_sl(
    entry_price: float,
    candles: List[Candle],
    tp_mult: float,
    sl_mult: float,
    intrabar_order: str,
    fee_bps: float,
    slippage_bps: float,
) -> Dict[str, Any]:
    """Simple candle-based TP/SL trigger model."""
    tp_price = entry_price * tp_mult
    sl_price = entry_price * sl_mult

    exit_reason = "horizon"
    exit_price = candles[-1].c

    for c in candles[1:]:
        hit_tp = c.h >= tp_price
        hit_sl = c.l <= sl_price

        if hit_tp and hit_sl:
            if intrabar_order == "tp_first":
                exit_reason, exit_price = "tp", tp_price
            else:
                exit_reason, exit_price = "sl", sl_price
            break
        elif hit_sl:
            exit_reason, exit_price = "sl", sl_price
            break
        elif hit_tp:
            exit_reason, exit_price = "tp", tp_price
            break

    cost_mult = 1.0 - (fee_bps + slippage_bps) / 10000.0
    entry_eff = entry_price * (1.0 + (slippage_bps / 10000.0))
    exit_eff = exit_price * cost_mult
    ret = (exit_eff / entry_eff) - 1.0

    return {
        "tp_sl_exit_reason": exit_reason,
        "tp_sl_ret": ret,
    }


# -----------------------------
# TUI Dashboard (rich-based) with file-based logging
# -----------------------------


class BacktestLogger:
    """File-based activity logger with optional TUI display."""

    def __init__(self, log_path: Path):
        self.log_path = log_path
        self.log_path.parent.mkdir(parents=True, exist_ok=True)
        # Clear/create log file
        self.log_path.write_text("")
        self._file = open(self.log_path, "a", buffering=1)  # Line buffered

    def write(self, msg: str) -> None:
        """Write a line to the log file."""
        timestamp = datetime.now(UTC).strftime("%H:%M:%S")
        self._file.write(f"[{timestamp}] {msg}\n")
        self._file.flush()

    def close(self) -> None:
        """Close the log file."""
        self._file.close()

    def tail(self, n: int = 20) -> List[str]:
        """Read the last n lines from the log file."""
        try:
            with open(self.log_path, "r") as f:
                lines = f.readlines()
                return [line.rstrip() for line in lines[-n:]]
        except Exception:
            return []


class BacktestTUI:
    """Live terminal UI for backtest progress and metrics."""

    def __init__(self, total_alerts: int, config: Dict[str, Any], logger: BacktestLogger):
        self.total = total_alerts
        self.processed = 0
        self.config = config
        self.logger = logger

        # Running metrics
        self.ok_count = 0
        self.skip_count = 0
        self.error_count = 0
        self.returns: List[float] = []
        self.ath_mults: List[float] = []
        self.hit_2x_count = 0

        self.max_log_lines = 18
        self.console = Console()

    def log(self, msg: str) -> None:
        """Write to log file."""
        self.logger.write(msg)

    def update(self, result: Dict[str, Any]) -> None:
        """Update metrics with a processed alert result."""
        self.processed += 1
        status = result.get("status", "error")

        if status == "ok":
            self.ok_count += 1
            if result.get("tp_sl_ret") is not None:
                self.returns.append(result["tp_sl_ret"])
            if result.get("ath_mult") is not None:
                self.ath_mults.append(result["ath_mult"])
            if result.get("time_to_2x_s") is not None:
                self.hit_2x_count += 1
            self.log(f"✓ {result.get('caller', '?')[:12]:12} | {result.get('mint', '?')[:8]}... | ATH {result.get('ath_mult', 0):.2f}x | ret {result.get('tp_sl_ret', 0)*100:+.1f}%")
        elif status == "no_coverage":
            self.skip_count += 1
            self.log(f"○ {result.get('caller', '?')[:12]:12} | {result.get('mint', '?')[:8]}... | skipped (no coverage)")
        else:
            self.error_count += 1
            self.log(f"✗ {result.get('caller', '?')[:12]:12} | {result.get('mint', '?')[:8]}... | {status}")

    def _make_metrics_table(self) -> Table:
        """Create the metrics table for the dashboard."""
        table = Table(show_header=False, box=None, padding=(0, 2))
        table.add_column("Label", style="dim")
        table.add_column("Value", style="bold cyan")
        table.add_column("Label2", style="dim")
        table.add_column("Value2", style="bold cyan")

        # Row 1: Progress and counts
        pct = (self.processed / self.total * 100) if self.total > 0 else 0
        table.add_row(
            "Progress", f"{self.processed:,} / {self.total:,} ({pct:.1f}%)",
            "OK / Skip / Err", f"{self.ok_count:,} / {self.skip_count:,} / {self.error_count:,}"
        )

        # Row 2: Performance metrics
        med_ret = median(self.returns) * 100 if self.returns else 0
        med_ath = median(self.ath_mults) if self.ath_mults else 0
        hit_2x_pct = (self.hit_2x_count / self.ok_count * 100) if self.ok_count > 0 else 0
        table.add_row(
            "Median Return", f"{med_ret:+.2f}%",
            "Median ATH", f"{med_ath:.2f}x"
        )
        table.add_row(
            "Hit 2x Rate", f"{hit_2x_pct:.1f}%",
            "Win Rate", f"{sum(1 for r in self.returns if r > 0) / len(self.returns) * 100:.1f}%" if self.returns else "—"
        )

        return table

    def _make_progress_bar(self) -> Text:
        """Create a simple progress bar."""
        width = 50
        filled = int((self.processed / self.total) * width) if self.total > 0 else 0
        bar = "█" * filled + "░" * (width - filled)
        pct = (self.processed / self.total * 100) if self.total > 0 else 0
        return Text(f"[{bar}] {pct:.1f}%", style="green")

    def _make_config_line(self) -> Text:
        """Show config summary."""
        cfg = self.config
        return Text(
            f"📅 {cfg.get('date_from', '?')} → {cfg.get('date_to', '?')} | "
            f"⏱ {cfg.get('interval_seconds', 60)}s / {cfg.get('horizon_hours', 48)}h | "
            f"🎯 TP {cfg.get('tp_mult', 2)}x SL {cfg.get('sl_mult', 0.5)}x",
            style="dim"
        )

    def _make_log_panel(self) -> Panel:
        """Create the scrolling activity log panel (tails log file)."""
        log_lines = self.logger.tail(self.max_log_lines)
        log_text = "\n".join(log_lines) if log_lines else "(waiting for alerts...)"
        return Panel(
            Text(log_text, style="white"),
            title=f"[bold]Activity Log[/bold] [dim]({self.logger.log_path})[/dim]",
            border_style="dim",
            height=self.max_log_lines + 2,
        )

    def render(self) -> Group:
        """Render the full dashboard."""
        # Header
        header = Panel(
            Group(
                self._make_config_line(),
                Text(""),
                self._make_progress_bar(),
                Text(""),
                self._make_metrics_table(),
            ),
            title="[bold blue]📊 Backtest Dashboard[/bold blue]",
            border_style="blue",
        )

        return Group(header, self._make_log_panel())


# -----------------------------
# Summary
# -----------------------------


def summarize(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    ok = [r for r in rows if r.get("status") == "ok"]
    missing = [r for r in rows if r.get("status") != "ok"]

    def take(field: str) -> List[float]:
        xs = []
        for r in ok:
            v = r.get(field)
            if v is None:
                continue
            if isinstance(v, (int, float)) and (not math.isnan(v)):
                xs.append(float(v))
        return xs

    ath = take("ath_mult")
    dd = take("dd_overall")
    ret_end = take("ret_end")
    tp_sl = take("tp_sl_ret")
    t2x = [float(r["time_to_2x_s"]) for r in ok if r.get("time_to_2x_s") is not None]

    def fmt_med(xs: List[float]) -> Optional[float]:
        return median(xs) if xs else None

    def fmt_pct_hit_2x() -> float:
        if not ok:
            return 0.0
        hit = sum(1 for r in ok if r.get("time_to_2x_s") is not None)
        return hit / len(ok)

    return {
        "alerts_total": len(rows),
        "alerts_ok": len(ok),
        "alerts_missing": len(missing),
        "median_ath_mult": fmt_med(ath),
        "median_dd_overall": fmt_med(dd),
        "median_ret_end": fmt_med(ret_end),
        "median_tp_sl_ret": fmt_med(tp_sl),
        "pct_hit_2x": fmt_pct_hit_2x(),
        "median_time_to_2x_s": fmt_med(t2x),
    }


# -----------------------------
# Main
# -----------------------------


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Baseline per-alert backtest: ATH, drawdowns, time-to-2x, simple TP/SL."
    )

    # Core parameters
    ap.add_argument("--duckdb", default=os.getenv("DUCKDB_PATH", "data/alerts.duckdb"))
    ap.add_argument("--chain", default="solana")
    ap.add_argument("--from", dest="date_from", help="YYYY-MM-DD (inclusive)")
    ap.add_argument("--to", dest="date_to", help="YYYY-MM-DD (inclusive)")
    ap.add_argument("--interval-seconds", type=int, choices=[60, 300], default=60)
    ap.add_argument("--horizon-hours", type=int, default=48)
    ap.add_argument("--threads", type=int, default=16)
    ap.add_argument(
        "--min-coverage-pct",
        type=float,
        default=0.8,
        help="Minimum coverage percentage required (0.0-1.0)",
    )

    # Slice management
    ap.add_argument(
        "--slice-dir",
        default=os.getenv("SLICE_DIR", "slices"),
        help="Directory for Parquet slice files",
    )
    ap.add_argument(
        "--reuse-slice",
        action="store_true",
        help="Reuse existing slice if available",
    )

    # Output options
    ap.add_argument("--out-csv", help="Output CSV path")
    ap.add_argument("--out-dir", default=os.getenv("BACKTEST_OUT_DIR", "results"))
    ap.add_argument(
        "--output-format",
        choices=["console", "json"],
        default="console",
    )
    ap.add_argument(
        "--tui",
        action="store_true",
        help="Enable live TUI dashboard (requires rich library)",
    )
    ap.add_argument(
        "--log-file",
        help="Activity log file path (default: <out-dir>/backtest_<date>.log)",
    )

    # ClickHouse
    # ClickHouse native protocol connection
    ap.add_argument("--ch-host", default=os.getenv("CLICKHOUSE_HOST", "127.0.0.1"))
    ap.add_argument("--ch-port", type=int, default=int(os.getenv("CLICKHOUSE_PORT", "19000")))
    ap.add_argument("--ch-db", default=os.getenv("CLICKHOUSE_DATABASE", os.getenv("CH_DB", "quantbot")))
    ap.add_argument("--ch-table", default=os.getenv("CH_TABLE", "ohlcv_candles"))
    ap.add_argument("--ch-user", default=os.getenv("CLICKHOUSE_USER", os.getenv("CH_USER", "default")))
    ap.add_argument("--ch-pass", default=os.getenv("CLICKHOUSE_PASSWORD", os.getenv("CH_PASSWORD", "")))
    ap.add_argument(
        "--ch-connect-timeout", type=int, default=int(os.getenv("CH_CONNECT_TIMEOUT", "10"))
    )
    ap.add_argument(
        "--ch-timeout-s", type=int, default=int(os.getenv("CH_TIMEOUT_S", "300"))
    )

    # Policy
    ap.add_argument("--tp-mult", type=float, default=2.0)
    ap.add_argument("--sl-mult", type=float, default=0.5)
    ap.add_argument(
        "--intrabar-order", choices=["sl_first", "tp_first"], default="sl_first"
    )
    ap.add_argument("--fee-bps", type=float, default=30.0)
    ap.add_argument("--slippage-bps", type=float, default=50.0)

    args = ap.parse_args()

    # Compute default dates if not provided
    now = datetime.now(UTC)
    if args.date_from:
        date_from = parse_yyyy_mm_dd(args.date_from)
    else:
        date_from = (now - timedelta(days=30)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )

    if args.date_to:
        date_to = parse_yyyy_mm_dd(args.date_to)
    else:
        date_to = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Compute output CSV path
    if args.out_csv:
        out_csv = args.out_csv
    else:
        date_str = now.strftime("%Y%m%d")
        out_csv = os.path.join(
            args.out_dir,
            f"backtest_{date_str}_{args.interval_seconds}s_{args.horizon_hours}h.csv",
        )

    cfg = ClickHouseCfg(
        host=args.ch_host,
        port=args.ch_port,
        database=args.ch_db,
        table=args.ch_table,
        user=args.ch_user,
        password=args.ch_pass,
        connect_timeout=args.ch_connect_timeout,
        send_receive_timeout=args.ch_timeout_s,
    )

    horizon = timedelta(hours=args.horizon_hours)

    def log(msg: str) -> None:
        if args.output_format != "json":
            print(msg, file=sys.stderr)

    # ─────────────────────────────────────────────────────────────
    # STEP 1: Load alerts from DuckDB
    # ─────────────────────────────────────────────────────────────
    log(f"[1/5] Loading alerts from {args.duckdb}...")
    try:
        alerts = load_alerts(args.duckdb, args.chain, date_from, date_to)
    except Exception as e:
        if args.output_format == "json":
            print(json.dumps({"success": False, "error": str(e), "summary": None, "csv_path": None}))
            sys.exit(1)
        raise

    if not alerts:
        error_msg = f"No alerts found for {date_from.strftime('%Y-%m-%d')} to {date_to.strftime('%Y-%m-%d')}"
        if args.output_format == "json":
            print(json.dumps({"success": False, "error": error_msg, "summary": None, "csv_path": None}))
            sys.exit(1)
        raise SystemExit(error_msg)

    log(f"    Found {len(alerts)} alerts")
    unique_mints = set(a.mint for a in alerts)
    log(f"    Unique tokens: {len(unique_mints)}")

    # ─────────────────────────────────────────────────────────────
    # STEP 2: Query coverage from ClickHouse (ONE query)
    # ─────────────────────────────────────────────────────────────
    # Compute slice hash for caching
    slice_hash = hashlib.md5(
        f"{args.chain}:{date_from}:{date_to}:{args.interval_seconds}:{args.horizon_hours}:{sorted(unique_mints)}".encode()
    ).hexdigest()[:12]
    slice_path = Path(args.slice_dir) / f"slice_{slice_hash}.parquet"

    if args.reuse_slice and slice_path.exists():
        log(f"[2/5] Reusing existing slice: {slice_path}")
        # Load covered mints from slice
        conn = duckdb.connect(":memory:")
        covered_mints_rows = conn.execute(
            f"SELECT DISTINCT token_address FROM '{slice_path}'"
        ).fetchall()
        conn.close()
        coverage = {row[0]: -1 for row in covered_mints_rows}  # -1 = unknown count
    else:
        log(f"[2/5] Querying coverage from ClickHouse...")
        try:
            coverage = query_coverage(
                cfg,
                args.chain,
                unique_mints,
                args.interval_seconds,
                date_from,
                date_to + horizon,  # Need coverage through horizon
                args.min_coverage_pct,
            )
        except Exception as e:
            if args.output_format == "json":
                print(json.dumps({"success": False, "error": f"ClickHouse coverage query failed: {e}", "summary": None, "csv_path": None}))
                sys.exit(1)
            raise

        log(f"    Tokens with sufficient coverage: {len(coverage)} / {len(unique_mints)}")

    # ─────────────────────────────────────────────────────────────
    # STEP 3: Filter alerts to only covered tokens
    # ─────────────────────────────────────────────────────────────
    log(f"[3/5] Filtering alerts to covered tokens...")
    covered_alerts = [a for a in alerts if a.mint in coverage]
    skipped_alerts = [a for a in alerts if a.mint not in coverage]

    log(f"    Covered alerts: {len(covered_alerts)}")
    log(f"    Skipped (no coverage): {len(skipped_alerts)}")

    if not covered_alerts:
        error_msg = "No alerts have sufficient candle coverage"
        if args.output_format == "json":
            print(json.dumps({
                "success": False,
                "error": error_msg,
                "summary": {
                    "alerts_total": len(alerts),
                    "alerts_ok": 0,
                    "alerts_missing": len(alerts),
                },
                "csv_path": None,
            }))
            sys.exit(1)
        raise SystemExit(error_msg)

    # ─────────────────────────────────────────────────────────────
    # STEP 4: Export slice to Parquet (if not reusing)
    # ─────────────────────────────────────────────────────────────
    if not (args.reuse_slice and slice_path.exists()):
        log(f"[4/5] Exporting slice to {slice_path}...")
        covered_mints = set(a.mint for a in covered_alerts)
        try:
            row_count = export_slice_to_parquet(
                cfg,
                args.chain,
                covered_mints,
                args.interval_seconds,
                date_from,
                date_to + horizon,
                slice_path,
            )
            log(f"    Exported {row_count} candles to Parquet")
        except Exception as e:
            if args.output_format == "json":
                print(json.dumps({"success": False, "error": f"Slice export failed: {e}", "summary": None, "csv_path": None}))
                sys.exit(1)
            raise
    else:
        log(f"[4/5] Skipped (reusing slice)")

    # ─────────────────────────────────────────────────────────────
    # STEP 5: Run backtest from Parquet (OFFLINE - no ClickHouse)
    # ─────────────────────────────────────────────────────────────
    log(f"[5/5] Running backtest from Parquet...")

    os.makedirs(os.path.dirname(out_csv) or ".", exist_ok=True)

    fieldnames = [
        "mint",
        "caller",
        "alert_ts_utc",
        "entry_ts_utc",
        "interval_seconds",
        "horizon_hours",
        "status",
        "candles",
        "entry_price",
        "ath_mult",
        "dd_overall",
        "ret_end",
        "time_to_2x_s",
        "dd_pre2x",
        "tp_sl_exit_reason",
        "tp_sl_ret",
    ]

    rows_out: List[Dict[str, Any]] = []

    # Add skipped alerts as "no_coverage"
    for a in skipped_alerts:
        rows_out.append({
            "mint": a.mint,
            "caller": a.caller,
            "alert_ts_utc": dt_to_ch(a.ts),
            "entry_ts_utc": "",
            "interval_seconds": args.interval_seconds,
            "horizon_hours": args.horizon_hours,
            "status": "no_coverage",
            "candles": 0,
        })

    # TUI config for dashboard
    tui_config = {
        "date_from": date_from.strftime("%Y-%m-%d"),
        "date_to": date_to.strftime("%Y-%m-%d"),
        "interval_seconds": args.interval_seconds,
        "horizon_hours": args.horizon_hours,
        "tp_mult": args.tp_mult,
        "sl_mult": args.sl_mult,
    }

    def process_alert(a: Alert) -> Dict[str, Any]:
        """Process a single alert and return result dict."""
        alert_ts = a.ts
        entry_ts = ceil_to_interval(alert_ts, args.interval_seconds)
        end_ts = entry_ts + horizon

        base = {
            "mint": a.mint,
            "caller": a.caller,
            "alert_ts_utc": dt_to_ch(alert_ts),
            "entry_ts_utc": dt_to_ch(entry_ts),
            "interval_seconds": args.interval_seconds,
            "horizon_hours": args.horizon_hours,
        }

        try:
            candles = load_candles_from_parquet(slice_path, a.mint, entry_ts, end_ts)

            if len(candles) < 2:
                return {**base, "status": "missing", "candles": len(candles)}

            entry_price = candles[0].o
            if entry_price <= 0:
                return {
                    **base,
                    "status": "bad_entry",
                    "candles": len(candles),
                    "entry_price": entry_price,
                }

            core = compute_core_metrics(entry_price, candles)
            pol = simulate_tp_sl(
                entry_price=entry_price,
                candles=candles,
                tp_mult=args.tp_mult,
                sl_mult=args.sl_mult,
                intrabar_order=args.intrabar_order,
                fee_bps=args.fee_bps,
                slippage_bps=args.slippage_bps,
            )
            return {
                **base,
                "status": "ok",
                "candles": len(candles),
                "entry_price": entry_price,
                **core,
                **pol,
            }
        except Exception as e:
            return {**base, "status": "error", "error": str(e)}

    # Determine log file path
    if args.log_file:
        log_file_path = Path(args.log_file)
    else:
        date_str = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
        log_file_path = Path(args.out_dir) / f"backtest_{date_str}.log"

    # Check if TUI mode is enabled and rich is available
    use_tui = args.tui and RICH_AVAILABLE and args.output_format != "json"

    if use_tui:
        # TUI mode with live dashboard + file logging
        total_alerts = len(covered_alerts) + len(skipped_alerts)
        logger = BacktestLogger(log_file_path)
        tui = BacktestTUI(total_alerts, tui_config, logger)

        # Log startup info
        logger.write(f"=== Backtest started ===")
        logger.write(f"Date range: {tui_config['date_from']} to {tui_config['date_to']}")
        logger.write(f"Alerts: {len(covered_alerts)} covered, {len(skipped_alerts)} skipped")
        logger.write(f"---")

        # Pre-populate skipped alerts in TUI
        for row in rows_out:
            tui.update(row)

        try:
            with Live(tui.render(), console=tui.console, refresh_per_second=4) as live:
                for a in covered_alerts:
                    result = process_alert(a)
                    rows_out.append(result)
                    tui.update(result)
                    live.update(tui.render())

            # Log completion
            logger.write(f"---")
            logger.write(f"=== Backtest complete ===")
            logger.write(f"Results: {out_csv}")
        finally:
            logger.close()

        log(f"Activity log: {log_file_path}")
    else:
        # Standard mode with periodic log updates
        done = 0
        for a in covered_alerts:
            result = process_alert(a)
            rows_out.append(result)
            done += 1
            if done % 100 == 0:
                log(f"    Progress: {done}/{len(covered_alerts)} alerts")

    # Write CSV
    with open(out_csv, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=fieldnames, extrasaction="ignore")
        w.writeheader()
        for row in rows_out:
            w.writerow(row)

    # Compute summary
    s = summarize(rows_out)

    if args.output_format == "json":
        result = {
            "success": True,
            "error": None,
            "csv_path": out_csv,
            "slice_path": str(slice_path),
            "log_path": str(log_file_path),
            "summary": {
                "alerts_total": s["alerts_total"],
                "alerts_ok": s["alerts_ok"],
                "alerts_missing": s["alerts_missing"],
                "median_ath_mult": s["median_ath_mult"],
                "median_dd_overall_pct": (
                    pct(s["median_dd_overall"])
                    if s["median_dd_overall"] is not None
                    else None
                ),
                "median_ret_end_pct": (
                    pct(s["median_ret_end"])
                    if s["median_ret_end"] is not None
                    else None
                ),
                "pct_hit_2x": pct(s["pct_hit_2x"]),
                "median_time_to_2x_hours": (
                    s["median_time_to_2x_s"] / 3600.0
                    if s["median_time_to_2x_s"] is not None
                    else None
                ),
                "median_tp_sl_ret_pct": (
                    pct(s["median_tp_sl_ret"])
                    if s["median_tp_sl_ret"] is not None
                    else None
                ),
            },
            "config": {
                "date_from": date_from.strftime("%Y-%m-%d"),
                "date_to": date_to.strftime("%Y-%m-%d"),
                "interval_seconds": args.interval_seconds,
                "horizon_hours": args.horizon_hours,
                "chain": args.chain,
                "tp_mult": args.tp_mult,
                "sl_mult": args.sl_mult,
                "fee_bps": args.fee_bps,
                "slippage_bps": args.slippage_bps,
            },
        }
        print(json.dumps(result))
    else:
        print("\n" + "=" * 60)
        print("BACKTEST SUMMARY")
        print("=" * 60)
        print(f"Date range: {date_from.strftime('%Y-%m-%d')} to {date_to.strftime('%Y-%m-%d')}")
        print(f"Slice: {slice_path}")
        print(f"Alerts: {s['alerts_total']} total, {s['alerts_ok']} ok, {s['alerts_missing']} missing/skipped")
        if s["median_ath_mult"] is not None:
            print(f"Median ATH multiple: {s['median_ath_mult']:.3f}x")
        if s["median_dd_overall"] is not None:
            print(f"Median max drawdown: {pct(s['median_dd_overall']):.2f}%")
        if s["median_ret_end"] is not None:
            print(f"Median return (hold-to-horizon): {pct(s['median_ret_end']):.2f}%")
        print(f"% that hit 2x: {pct(s['pct_hit_2x']):.2f}%")
        if s["median_time_to_2x_s"] is not None:
            print(f"Median time-to-2x: {s['median_time_to_2x_s']/3600.0:.2f} hours")
        if s["median_tp_sl_ret"] is not None:
            print(f"Median return (TP/SL policy): {pct(s['median_tp_sl_ret']):.2f}%")
        print(f"\nResults: {out_csv}")


if __name__ == "__main__":
    main()

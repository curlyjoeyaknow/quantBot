#!/usr/bin/env python3
"""
qbreport.py — QuantBot human report generator

Outputs:
- console (default)
- json
- html (single file, interactive, no external libs)

Design goals:
- Works even if your schema is partially present (it will degrade gracefully)
- Event-filtered summaries (phases/events if tables exist)
- Portfolio metrics from trades if trades table exists

Usage:
  python3 tools/qbreport.py --duckdb data/alerts.duckdb --run-id RUN123 --format console
  python3 tools/qbreport.py --duckdb data/alerts.duckdb --run-id RUN123 --format json  --out out/report_RUN123.json
  python3 tools/qbreport.py --duckdb data/alerts.duckdb --run-id RUN123 --format html  --out out/report_RUN123.html
  python3 tools/qbreport.py --duckdb data/alerts.duckdb --format console --latest
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Tuple

try:
    import duckdb  # type: ignore
except Exception as e:
    print("ERROR: duckdb is required. Install with: python3 -m pip install duckdb", file=sys.stderr)
    raise


# ----------------------------
# Small helpers
# ----------------------------

def iso_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()

def safe_int(x: Any) -> Optional[int]:
    try:
        if x is None:
            return None
        return int(x)
    except Exception:
        return None

def safe_float(x: Any) -> Optional[float]:
    try:
        if x is None:
            return None
        return float(x)
    except Exception:
        return None

def clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))

def fmt_pct(x: Optional[float]) -> str:
    if x is None:
        return "—"
    return f"{x*100:.2f}%"

def fmt_num(x: Optional[float], digits: int = 2) -> str:
    if x is None:
        return "—"
    return f"{x:.{digits}f}"

def fmt_int(x: Optional[int]) -> str:
    if x is None:
        return "—"
    return str(x)

def sparkline(values: List[float], width: int = 28) -> str:
    # Minimal unicode sparkline (no deps)
    if not values:
        return ""
    blocks = "▁▂▃▄▅▆▇█"
    mn = min(values)
    mx = max(values)
    if mx == mn:
        return blocks[0] * min(width, len(values))
    # downsample to width
    if len(values) > width:
        step = len(values) / width
        sampled = []
        for i in range(width):
            a = int(i * step)
            b = int((i + 1) * step)
            b = max(b, a + 1)
            chunk = values[a:b]
            sampled.append(sum(chunk) / len(chunk))
        values = sampled
    out = []
    for v in values:
        t = (v - mn) / (mx - mn)
        idx = int(round(t * (len(blocks) - 1)))
        out.append(blocks[idx])
    return "".join(out)

def ascii_gauge(label: str, value: Optional[float], lo: float, hi: float, width: int = 24, invert: bool = False) -> str:
    """
    Render a simple gauge bar.
    - invert=True means "lower is better" (e.g., drawdown)
    """
    if value is None or math.isnan(value):
        return f"{label:<14} [{'?' * width}]  —"
    v = clamp(value, lo, hi)
    t = (v - lo) / (hi - lo) if hi != lo else 0.0
    if invert:
        t = 1.0 - t
    filled = int(round(t * width))
    bar = "█" * filled + "░" * (width - filled)
    return f"{label:<14} [{bar}] {value:.4f}"

def mkdirp(path: str) -> None:
    os.makedirs(path, exist_ok=True)


# ----------------------------
# Schema probing + table selection
# ----------------------------

@dataclass
class TableRef:
    schema: str
    name: str

    @property
    def fq(self) -> str:
        if self.schema and self.schema.lower() not in ("main",):
            return f"{self.schema}.{self.name}"
        return self.name

def list_tables(con) -> List[TableRef]:
    rows = con.execute("""
        SELECT table_schema, table_name
        FROM information_schema.tables
        WHERE table_type='BASE TABLE'
        ORDER BY table_schema, table_name
    """).fetchall()
    out: List[TableRef] = []
    for sch, nm in rows:
        out.append(TableRef(schema=str(sch), name=str(nm)))
    return out

def table_exists(tables: List[TableRef], pattern: str) -> List[TableRef]:
    rx = re.compile(pattern, re.IGNORECASE)
    return [t for t in tables if rx.search(t.fq)]

def pick_first(tables: List[TableRef], patterns: List[str]) -> Optional[TableRef]:
    for pat in patterns:
        hits = table_exists(tables, pat)
        if hits:
            return hits[0]
    return None

def get_columns(con, table_fq: str) -> List[str]:
    rows = con.execute("""
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = ?
        ORDER BY ordinal_position
    """, [table_fq.split(".")[-1]]).fetchall()
    cols = [str(r[0]) for r in rows]
    # DuckDB info_schema.columns ignores schema filtering in some setups; do a fallback query
    if not cols:
        try:
            rows2 = con.execute(f"DESCRIBE {table_fq}").fetchall()
            cols = [str(r[0]) for r in rows2]
        except Exception:
            cols = []
    return cols

def find_col(cols: List[str], candidates: List[str]) -> Optional[str]:
    lower = {c.lower(): c for c in cols}
    for cand in candidates:
        if cand.lower() in lower:
            return lower[cand.lower()]
    # fuzzy
    for cand in candidates:
        for c in cols:
            if cand.lower() in c.lower():
                return c
    return None


# ----------------------------
# Metrics
# ----------------------------

def compute_equity_curve(trades: List[Dict[str, Any]], pnl_key: str, ts_key: Optional[str]) -> Dict[str, Any]:
    """
    trades: list dicts, assumed ordered or orderable
    returns: points {x, y}, plus stats
    """
    # sort
    if ts_key and all(t.get(ts_key) is not None for t in trades):
        trades = sorted(trades, key=lambda t: t.get(ts_key))
    equity = 0.0
    points = []
    for i, t in enumerate(trades):
        pnl = safe_float(t.get(pnl_key)) or 0.0
        equity += pnl
        x = t.get(ts_key) if ts_key else i
        points.append({"x": x, "y": equity})
    return {"points": points, "final_equity": equity}

def compute_drawdown(points: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not points:
        return {"max_drawdown": None, "max_drawdown_pct": None, "drawdown_series": []}
    peak = -1e18
    dd_series = []
    max_dd = 0.0  # negative numbers as drawdown, store min
    for p in points:
        y = float(p["y"])
        if y > peak:
            peak = y
        dd = y - peak  # <= 0
        dd_series.append({"x": p["x"], "y": dd})
        if dd < max_dd:
            max_dd = dd
    # pct drawdown is not well-defined without starting capital; we approximate vs peak abs
    max_dd_pct = None
    # find peak value where max dd occurred
    # (approx: use max peak across series, then compute max_dd/peak if peak>0)
    max_peak = max(float(p["y"]) for p in points)
    if max_peak > 0:
        max_dd_pct = max_dd / max_peak
    return {"max_drawdown": max_dd, "max_drawdown_pct": max_dd_pct, "drawdown_series": dd_series}

def compute_trade_stats(trades: List[Dict[str, Any]], pnl_key: str) -> Dict[str, Any]:
    pnls = [safe_float(t.get(pnl_key)) for t in trades]
    pnls = [p for p in pnls if p is not None]
    if not pnls:
        return {
            "trades": 0, "wins": 0, "losses": 0, "win_rate": None,
            "sum_pnl": None, "avg_pnl": None, "median_pnl": None,
            "avg_win": None, "avg_loss": None, "profit_factor": None,
            "best_trade": None, "worst_trade": None
        }
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p < 0]
    win_rate = (len(wins) / len(pnls)) if pnls else None
    sum_pnl = sum(pnls)
    avg_pnl = sum_pnl / len(pnls)
    med_pnl = sorted(pnls)[len(pnls)//2]
    avg_win = (sum(wins)/len(wins)) if wins else None
    avg_loss = (sum(losses)/len(losses)) if losses else None
    profit_factor = None
    if wins and losses:
        profit_factor = sum(wins) / abs(sum(losses)) if sum(losses) != 0 else None
    return {
        "trades": len(pnls),
        "wins": len(wins),
        "losses": len(losses),
        "win_rate": win_rate,
        "sum_pnl": sum_pnl,
        "avg_pnl": avg_pnl,
        "median_pnl": med_pnl,
        "avg_win": avg_win,
        "avg_loss": avg_loss,
        "profit_factor": profit_factor,
        "best_trade": max(pnls),
        "worst_trade": min(pnls),
    }


# ----------------------------
# Load data from DuckDB (best-effort)
# ----------------------------

def load_latest_run_id(con, runs_table: Optional[TableRef]) -> Optional[str]:
    if not runs_table:
        return None
    cols = get_columns(con, runs_table.fq)
    run_col = find_col(cols, ["run_id", "id", "backtest_run_id"])
    ts_col = find_col(cols, ["completed_at", "finished_at", "ended_at", "created_at", "started_at", "start_ts_ms", "start_ts"])
    if not run_col:
        return None
    if ts_col:
        try:
            row = con.execute(f"SELECT {run_col} FROM {runs_table.fq} ORDER BY {ts_col} DESC LIMIT 1").fetchone()
            return str(row[0]) if row else None
        except Exception:
            pass
    try:
        row = con.execute(f"SELECT {run_col} FROM {runs_table.fq} LIMIT 1").fetchone()
        return str(row[0]) if row else None
    except Exception:
        return None

def load_trades(con, trades_table: TableRef, run_id: Optional[str], since: Optional[str], until: Optional[str]) -> Tuple[List[Dict[str, Any]], Dict[str, str]]:
    cols = get_columns(con, trades_table.fq)
    mapping: Dict[str, str] = {}

    run_col = find_col(cols, ["run_id", "backtest_run_id", "simulation_id"])
    pnl_col = find_col(cols, ["pnl", "pnl_usd", "profit", "net_pnl", "pnl_after_fees", "realized_return_bps"])
    exit_ts_col = find_col(cols, ["exit_ts_ms", "exit_ts", "exit_time", "closed_at", "sold_ts_ms", "sell_ts_ms"])
    entry_ts_col = find_col(cols, ["entry_ts_ms", "entry_ts", "entry_time", "opened_at", "buy_ts_ms"])
    entry_px_col = find_col(cols, ["entry_px", "entry_price", "buy_price"])
    exit_px_col = find_col(cols, ["exit_px", "exit_price", "sell_price"])

    if pnl_col:
        mapping["pnl"] = pnl_col
    if run_col:
        mapping["run_id"] = run_col
    if exit_ts_col:
        mapping["exit_ts"] = exit_ts_col
    if entry_ts_col:
        mapping["entry_ts"] = entry_ts_col
    if entry_px_col:
        mapping["entry_px"] = entry_px_col
    if exit_px_col:
        mapping["exit_px"] = exit_px_col

    where = []
    params: List[Any] = []
    if run_id and run_col:
        where.append(f"{run_col} = ?")
        params.append(run_id)
    # since/until apply to exit_ts if available else entry_ts else ignored
    ts_filter_col = exit_ts_col or entry_ts_col
    # since/until are ISO dates or datetimes; convert to comparable by duckdb
    if since and ts_filter_col:
        where.append(f"{ts_filter_col} >= ?")
        params.append(since)
    if until and ts_filter_col:
        where.append(f"{ts_filter_col} <= ?")
        params.append(until)

    sql = f"SELECT * FROM {trades_table.fq}"
    if where:
        sql += " WHERE " + " AND ".join(where)

    # Try not to pull the entire universe by accident
    sql += " LIMIT 200000"

    rows = con.execute(sql, params).fetchall()
    # get column names
    desc = con.execute(f"SELECT * FROM {trades_table.fq} LIMIT 0").description
    colnames = [d[0] for d in desc]
    out: List[Dict[str, Any]] = []
    for r in rows:
        out.append({colnames[i]: r[i] for i in range(len(colnames))})
    return out, mapping

def load_phase_events(con, phases_table: TableRef, run_id: Optional[str]) -> Dict[str, Any]:
    cols = get_columns(con, phases_table.fq)
    run_col = find_col(cols, ["run_id", "backtest_run_id"])
    status_col = find_col(cols, ["status"])
    phase_col = find_col(cols, ["phase_name", "name", "phase"])
    dur_col = find_col(cols, ["duration_ms", "duration", "elapsed_ms"])
    started_col = find_col(cols, ["started_at", "start_time"])
    completed_col = find_col(cols, ["completed_at", "end_time"])

    where = []
    params: List[Any] = []
    if run_id and run_col:
        where.append(f"{run_col} = ?")
        params.append(run_id)

    sql = f"SELECT * FROM {phases_table.fq}"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " LIMIT 5000"

    rows = con.execute(sql, params).fetchall()
    desc = con.execute(f"SELECT * FROM {phases_table.fq} LIMIT 0").description
    colnames = [d[0] for d in desc]
    events = [{colnames[i]: r[i] for i in range(len(colnames))} for r in rows]

    # Aggregate
    by_status: Dict[str, int] = {}
    durations: List[float] = []
    for e in events:
        st = str(e.get(status_col)) if status_col else "UNKNOWN"
        by_status[st] = by_status.get(st, 0) + 1
        d = safe_float(e.get(dur_col)) if dur_col else None
        if d is not None:
            durations.append(d)

    return {
        "table": phases_table.fq,
        "count": len(events),
        "by_status": by_status,
        "avg_duration_ms": (sum(durations)/len(durations)) if durations else None,
        "p95_duration_ms": percentile(durations, 0.95) if durations else None,
        "sample": summarize_phase_rows(events, phase_col, status_col, dur_col, started_col, completed_col),
    }

def percentile(values: List[float], p: float) -> Optional[float]:
    if not values:
        return None
    v = sorted(values)
    idx = int(round((len(v)-1)*p))
    idx = clamp(idx, 0, len(v)-1)
    return float(v[int(idx)])

def summarize_phase_rows(events: List[Dict[str, Any]],
                         phase_col: Optional[str],
                         status_col: Optional[str],
                         dur_col: Optional[str],
                         started_col: Optional[str],
                         completed_col: Optional[str],
                         limit: int = 12) -> List[Dict[str, Any]]:
    out = []
    for e in events[:limit]:
        out.append({
            "phase": e.get(phase_col) if phase_col else None,
            "status": e.get(status_col) if status_col else None,
            "duration_ms": e.get(dur_col) if dur_col else None,
            "started_at": e.get(started_col) if started_col else None,
            "completed_at": e.get(completed_col) if completed_col else None,
        })
    return out


# ----------------------------
# Rendering
# ----------------------------

def render_console(report: Dict[str, Any]) -> str:
    lines: List[str] = []

    meta = report.get("meta", {})
    lines.append("=" * 92)
    lines.append(f"QuantBot Report  |  generated={meta.get('generated_at')}  |  run_id={meta.get('run_id') or '—'}")
    lines.append("=" * 92)
    lines.append("")

    # Portfolio summary
    port = report.get("portfolio", {})
    lines.append("PORTFOLIO SUMMARY")
    lines.append("-" * 92)
    lines.append(f"Trades: {fmt_int(port.get('trades'))}  |  Wins: {fmt_int(port.get('wins'))}  |  Losses: {fmt_int(port.get('losses'))}")
    lines.append(f"Win rate: {fmt_pct(port.get('win_rate'))}  |  Profit factor: {fmt_num(port.get('profit_factor'))}  |  Total PnL: {fmt_num(port.get('sum_pnl'))}")
    lines.append(f"Avg pnl: {fmt_num(port.get('avg_pnl'))}  |  Median pnl: {fmt_num(port.get('median_pnl'))}  |  Best/Worst: {fmt_num(port.get('best_trade'))}/{fmt_num(port.get('worst_trade'))}")
    lines.append("")

    # Gauges
    gauges = report.get("gauges", {})
    lines.append("GAUGES (quick smell test)")
    lines.append("-" * 92)
    # normalize to 0..1-ish scales
    win_rate = port.get("win_rate")
    mdd = report.get("drawdown", {}).get("max_drawdown")  # negative
    # max drawdown gauge uses abs
    mdd_abs = abs(mdd) if isinstance(mdd, (int, float)) else None
    lines.append(ascii_gauge("win_rate", win_rate, 0.0, 1.0, width=30, invert=False))
    # For drawdown: lo=0 (best), hi=some cap (worst). Cap at 10k to avoid silly bars; still shows raw value.
    lines.append(ascii_gauge("max_dd_abs", mdd_abs, 0.0, float(gauges.get("dd_cap", 10000.0)), width=30, invert=True))
    lines.append("")

    # Equity curve sparkline
    eq = report.get("equity_curve", {})
    pts = eq.get("points", [])
    ys = [float(p["y"]) for p in pts[-120:]] if pts else []
    lines.append("EQUITY CURVE (sparkline)")
    lines.append("-" * 92)
    lines.append(sparkline(ys, width=80) if ys else "— (no trades/equity points found)")
    lines.append("")

    # Events/phases
    phases = report.get("phases")
    if phases:
        lines.append("PIPELINE PHASES / EVENTS")
        lines.append("-" * 92)
        lines.append(f"Table: {phases.get('table')} | rows: {phases.get('count')}")
        lines.append("By status:")
        for k, v in sorted((phases.get('by_status') or {}).items(), key=lambda kv: (-kv[1], kv[0])):
            lines.append(f"  - {k}: {v}")
        lines.append(f"Avg duration (ms): {fmt_num(phases.get('avg_duration_ms'))} | P95 duration (ms): {fmt_num(phases.get('p95_duration_ms'))}")
        lines.append("Sample rows:")
        for r in phases.get("sample", []):
            lines.append(f"  - phase={r.get('phase')} status={r.get('status')} dur_ms={r.get('duration_ms')}")
        lines.append("")

    # Warnings
    warns = report.get("warnings", [])
    if warns:
        lines.append("WARNINGS / MISSING PIECES")
        lines.append("-" * 92)
        for w in warns:
            lines.append(f"- {w}")
        lines.append("")

    lines.append("=" * 92)
    return "\n".join(lines)

def render_html(report: Dict[str, Any]) -> str:
    # single-file HTML with canvas charts + embedded JSON
    payload = json.dumps(report, default=str)
    # minimal inline app
    return f"""<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>QuantBot Report</title>
  <style>
    body {{ font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 0; background: #0b0f14; color: #e6edf3; }}
    .wrap {{ max-width: 1100px; margin: 0 auto; padding: 20px; }}
    .row {{ display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }}
    .card {{ background: #111826; border: 1px solid #1f2a3a; border-radius: 14px; padding: 14px; box-shadow: 0 8px 24px rgba(0,0,0,0.25); }}
    h1 {{ font-size: 18px; margin: 0 0 6px 0; }}
    h2 {{ font-size: 14px; margin: 0 0 10px 0; color: #cbd5e1; font-weight: 600; }}
    .muted {{ color: #9aa4b2; font-size: 12px; }}
    .kpi {{ display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-top: 10px; }}
    .k {{ background: #0e1521; border: 1px solid #1f2a3a; border-radius: 12px; padding: 10px; }}
    .k .t {{ font-size: 11px; color: #9aa4b2; }}
    .k .v {{ font-size: 16px; margin-top: 6px; font-weight: 700; }}
    canvas {{ width: 100%; height: 240px; background: #0e1521; border: 1px solid #1f2a3a; border-radius: 12px; }}
    .gaugeRow {{ display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }}
    .smallCanvas {{ height: 180px; }}
    pre {{ white-space: pre-wrap; word-break: break-word; background: #0e1521; border: 1px solid #1f2a3a; border-radius: 12px; padding: 10px; color: #cbd5e1; }}
    .pill {{ display:inline-block; padding: 2px 8px; border-radius: 999px; border: 1px solid #1f2a3a; background:#0e1521; font-size: 12px; color:#cbd5e1; }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="card">
      <h1>QuantBot Report <span class="pill" id="runPill"></span></h1>
      <div class="muted" id="metaLine"></div>
      <div class="kpi" id="kpi"></div>
    </div>

    <div style="height: 14px;"></div>

    <div class="row">
      <div class="card">
        <h2>Equity Curve</h2>
        <canvas id="equity"></canvas>
      </div>
      <div class="card">
        <h2>Drawdown</h2>
        <canvas id="dd"></canvas>
      </div>
    </div>

    <div style="height: 14px;"></div>

    <div class="card">
      <h2>Gauges</h2>
      <div class="gaugeRow">
        <canvas class="smallCanvas" id="gWin"></canvas>
        <canvas class="smallCanvas" id="gDD"></canvas>
      </div>
    </div>

    <div style="height: 14px;"></div>

    <div class="row">
      <div class="card">
        <h2>Pipeline Phases / Events</h2>
        <pre id="phasesBox"></pre>
      </div>
      <div class="card">
        <h2>Warnings / Missing Pieces</h2>
        <pre id="warnBox"></pre>
      </div>
    </div>
  </div>

<script>
const REPORT = {payload};

function fmt(n, d=2) {{
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return Number(n).toFixed(d);
}}
function pct(x, d=2) {{
  if (x === null || x === undefined || Number.isNaN(x)) return "—";
  return (Number(x)*100).toFixed(d) + "%";
}}

function kpi() {{
  const port = REPORT.portfolio || {{}};
  const meta = REPORT.meta || {{}};
  document.getElementById("runPill").textContent = meta.run_id ? ("run " + meta.run_id) : "no run_id";
  document.getElementById("metaLine").textContent = `generated=${{meta.generated_at || "—"}}`;

  const items = [
    ["Trades", port.trades],
    ["Win rate", pct(port.win_rate)],
    ["Profit factor", fmt(port.profit_factor)],
    ["Total PnL", fmt(port.sum_pnl)],
    ["Max DD", fmt((REPORT.drawdown||{{}}).max_drawdown)],
    ["Final equity", fmt((REPORT.equity_curve||{{}}).final_equity)],
  ];
  const el = document.getElementById("kpi");
  el.innerHTML = "";
  for (const [t, v] of items) {{
    const div = document.createElement("div");
    div.className = "k";
    div.innerHTML = `<div class="t">${{t}}</div><div class="v">${{v}}</div>`;
    el.appendChild(div);
  }}
}}

function plotLine(canvasId, points, label) {{
  const c = document.getElementById(canvasId);
  const ctx = c.getContext("2d");
  // handle DPR
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  c.width = Math.floor(w * dpr);
  c.height = Math.floor(h * dpr);
  ctx.scale(dpr, dpr);

  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = "#0e1521";
  ctx.fillRect(0,0,w,h);

  if (!points || points.length < 2) {{
    ctx.fillStyle = "#9aa4b2";
    ctx.font = "12px system-ui";
    ctx.fillText("no data", 12, 18);
    return;
  }}

  const ys = points.map(p => Number(p.y));
  let ymin = Math.min(...ys), ymax = Math.max(...ys);
  if (ymin === ymax) {{ ymin -= 1; ymax += 1; }}

  const pad = 14;
  const x0 = pad, y0 = pad, x1 = w - pad, y1 = h - pad;

  // grid
  ctx.strokeStyle = "#1f2a3a";
  ctx.lineWidth = 1;
  for (let i=0;i<=4;i++) {{
    const y = y0 + (y1-y0)*(i/4);
    ctx.beginPath(); ctx.moveTo(x0,y); ctx.lineTo(x1,y); ctx.stroke();
  }}

  // line
  ctx.strokeStyle = "#7dd3fc";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i=0;i<points.length;i++) {{
    const t = i/(points.length-1);
    const x = x0 + (x1-x0)*t;
    const yv = Number(points[i].y);
    const yn = (yv - ymin) / (ymax - ymin);
    const y = y1 - (y1-y0)*yn;
    if (i===0) ctx.moveTo(x,y);
    else ctx.lineTo(x,y);
  }}
  ctx.stroke();

  // label
  ctx.fillStyle = "#cbd5e1";
  ctx.font = "12px system-ui";
  ctx.fillText(label + `  (min=${{ymin.toFixed(2)}}, max=${{ymax.toFixed(2)}})`, 12, 18);
}}

function gauge(canvasId, title, value01) {{
  const c = document.getElementById(canvasId);
  const ctx = c.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = c.clientWidth, h = c.clientHeight;
  c.width = Math.floor(w*dpr); c.height = Math.floor(h*dpr);
  ctx.scale(dpr, dpr);

  ctx.clearRect(0,0,w,h);
  ctx.fillStyle = "#0e1521";
  ctx.fillRect(0,0,w,h);

  const cx = w/2, cy = h*0.62;
  const r = Math.min(w,h)*0.36;

  // base arc
  ctx.lineWidth = 16;
  ctx.strokeStyle = "#1f2a3a";
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, 2*Math.PI);
  ctx.stroke();

  let v = value01;
  if (v === null || v === undefined || Number.isNaN(v)) v = 0;
  v = Math.max(0, Math.min(1, Number(v)));

  // value arc
  ctx.strokeStyle = "#86efac";
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI, Math.PI + Math.PI*v);
  ctx.stroke();

  ctx.fillStyle = "#cbd5e1";
  ctx.font = "12px system-ui";
  ctx.fillText(title, 12, 18);

  ctx.font = "18px system-ui";
  ctx.fillText((v*100).toFixed(1) + "%", cx-26, cy+8);
}}

function renderPhases() {{
  const p = REPORT.phases;
  const el = document.getElementById("phasesBox");
  if (!p) {{
    el.textContent = "— (no phases table found)";
    return;
  }}
  el.textContent = JSON.stringify(p, null, 2);
}}

function renderWarnings() {{
  const w = REPORT.warnings || [];
  const el = document.getElementById("warnBox");
  el.textContent = w.length ? w.join("\\n") : "—";
}}

function run() {{
  kpi();
  plotLine("equity", (REPORT.equity_curve||{{}}).points, "Equity");
  plotLine("dd", (REPORT.drawdown||{{}}).drawdown_series, "Drawdown (<=0)");
  const port = REPORT.portfolio || {{}};
  gauge("gWin", "Win rate", port.win_rate);
  // drawdown gauge: map abs(drawdown) to 0..1 (cap)
  const dd = (REPORT.drawdown||{{}}).max_drawdown;
  const cap = (REPORT.gauges||{{}}).dd_cap || 10000.0;
  const ddAbs = Math.min(Math.abs(Number(dd||0)), cap);
  const dd01 = 1.0 - (ddAbs / cap);
  gauge("gDD", "Drawdown health", dd01);
  renderPhases();
  renderWarnings();
}}

run();
window.addEventListener("resize", run);
</script>
</body>
</html>
"""

def write_out(path: str, content: str) -> None:
    mkdirp(os.path.dirname(path) or ".")
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)


# ----------------------------
# Main report builder
# ----------------------------

def build_report(duckdb_path: str,
                 run_id: Optional[str],
                 latest: bool,
                 since: Optional[str],
                 until: Optional[str]) -> Dict[str, Any]:
    warnings: List[str] = []

    con = duckdb.connect(duckdb_path, read_only=True)
    tables = list_tables(con)

    # common patterns in your repo/world
    runs_table = pick_first(tables, [
        r"^main\.backtest_runs$",
        r"^backtest_runs$",
        r"\bbacktest_runs_f\b",
        r"\bruns_f\b",
        r"\bbacktest_runs\b",
        r"\bruns\b",
    ])

    trades_table = pick_first(tables, [
        r"^main\.backtest_policy_results$",
        r"^backtest_policy_results$",
        r"^main\.backtest_call_results$",
        r"^backtest_call_results$",
        r"\bbacktest_trades_f\b",
        r"\btrades_f\b",
        r"\bbacktest_trades\b",
        r"\btrades\b",
    ])

    phases_table = pick_first(tables, [
        r"\boptimizer\.pipeline_phases_f\b",
        r"\bpipeline_phases_f\b",
        r"\bphases_f\b",
    ])

    # If user wants latest and we can infer a run_id
    if latest and not run_id:
        inferred = load_latest_run_id(con, runs_table)
        if inferred:
            run_id = inferred
        else:
            warnings.append("Requested --latest but could not infer run_id (no runs table or missing run_id column).")

    # Trades
    portfolio: Dict[str, Any] = {}
    equity_curve: Dict[str, Any] = {"points": [], "final_equity": None}
    drawdown: Dict[str, Any] = {"max_drawdown": None, "max_drawdown_pct": None, "drawdown_series": []}

    if trades_table:
        trades, mapping = load_trades(con, trades_table, run_id, since, until)
        pnl_col = mapping.get("pnl")
        ts_col = mapping.get("exit_ts") or mapping.get("entry_ts")

        if not pnl_col:
            warnings.append(f"Trades table found ({trades_table.fq}) but could not find a pnl column (tried: pnl/pnl_usd/profit/net_pnl/...).")
        else:
            portfolio = compute_trade_stats(trades, pnl_col)
            equity_curve = compute_equity_curve(trades, pnl_col, ts_col)
            drawdown = compute_drawdown(equity_curve.get("points", []))
    else:
        warnings.append("No trades table found. Looked for backtest_trades_f / trades_f / trades / backtest_trades.")

    # Phases / events
    phases = None
    if phases_table:
        try:
            phases = load_phase_events(con, phases_table, run_id)
        except Exception as e:
            warnings.append(f"Found phases table ({phases_table.fq}) but failed to load: {e}")
    else:
        warnings.append("No pipeline phases/events table found (optional). Looked for optimizer.pipeline_phases_f / pipeline_phases_f / phases_f.")

    # Meta + caps for gauges
    report = {
        "meta": {
            "generated_at": iso_now(),
            "duckdb_path": duckdb_path,
            "run_id": run_id,
            "tables_detected": [t.fq for t in tables],
            "tables_used": {
                "runs": runs_table.fq if runs_table else None,
                "trades": trades_table.fq if trades_table else None,
                "phases": phases_table.fq if phases_table else None,
            },
            "filters": {"since": since, "until": until},
        },
        "portfolio": portfolio,
        "equity_curve": equity_curve,
        "drawdown": drawdown,
        "phases": phases,
        "gauges": {
            "dd_cap": 10000.0
        },
        "warnings": warnings,
    }

    return report


def main() -> None:
    ap = argparse.ArgumentParser(description="QuantBot report generator (console/json/html)")
    ap.add_argument("--duckdb", required=True, help="Path to DuckDB file, e.g. data/alerts.duckdb")
    ap.add_argument("--run-id", default=None, help="Run identifier (if your trades/phases tables have run_id)")
    ap.add_argument("--latest", action="store_true", help="Infer latest run_id from runs table (best-effort)")
    ap.add_argument("--since", default=None, help="Filter by timestamp (best-effort). ISO date or datetime.")
    ap.add_argument("--until", default=None, help="Filter by timestamp (best-effort). ISO date or datetime.")
    ap.add_argument("--format", choices=["console", "json", "html"], default="console")
    ap.add_argument("--out", default=None, help="Output file path (for json/html). If omitted, prints to stdout (json) or writes ./out/report.html (html).")
    args = ap.parse_args()

    report = build_report(
        duckdb_path=args.duckdb,
        run_id=args.run_id,
        latest=args.latest,
        since=args.since,
        until=args.until,
    )

    if args.format == "console":
        print(render_console(report))
        return

    if args.format == "json":
        out = json.dumps(report, indent=2, default=str)
        if args.out:
            write_out(args.out, out)
            print(args.out)
        else:
            print(out)
        return

    if args.format == "html":
        html = render_html(report)
        out_path = args.out or "./out/report.html"
        write_out(out_path, html)
        print(out_path)
        return


if __name__ == "__main__":
    main()


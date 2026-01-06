#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import sys
from typing import Any, Dict, List, Optional

import duckdb


def _fmt(x: Any, kind: str = "num") -> str:
    if x is None:
        return "-"
    if isinstance(x, float) and (math.isnan(x) or math.isinf(x)):
        return "-"
    if kind == "pct":
        return f"{x:6.2f}%"
    if kind == "x":
        return f"{x:6.2f}x"
    if kind == "int":
        return f"{int(x):6d}"
    if kind == "num":
        return f"{x:8.4f}"
    return str(x)


def _print_table(rows: List[Dict[str, Any]], limit: int) -> None:
    if not rows:
        print("No rows.", file=sys.stderr)
        return

    headers = [
        ("rank", "int"),
        ("caller", "str"),
        ("n", "int"),
        ("hit2x_pct", "pct"),
        ("hit4x_pct", "pct"),
        ("median_ath", "x"),
        ("median_peak_pnl_pct", "pct"),
        ("p25_tp_sl_ret_pct", "pct"),
        ("p75_tp_sl_ret_pct", "pct"),
        ("median_tp_sl_ret_pct", "pct"),
        ("avg_tp_sl_ret_pct", "pct"),
        ("profit_factor", "num"),
        ("expectancy_pct", "pct"),
        ("worst_dd_pct", "pct"),
    ]

    col_widths: Dict[str, int] = {k: max(len(k), 8) for k, _ in headers}

    for r in rows[:limit]:
        for key, kind in headers:
            if key == "caller":
                v = (r.get("caller") or "-").strip()
                col_widths[key] = max(col_widths[key], min(28, len(v)))
            else:
                v = r.get(key)
                if kind == "pct":
                    txt = _fmt(v, "pct")
                elif kind == "x":
                    txt = _fmt(v, "x")
                elif kind == "int":
                    txt = _fmt(v, "int")
                else:
                    txt = _fmt(v, "num")
                col_widths[key] = max(col_widths[key], len(txt))

    line = "  ".join(k.ljust(col_widths[k]) for k, _ in headers)
    print(line)
    print("-" * len(line))

    for r in rows[:limit]:
        parts = []
        for key, kind in headers:
            if key == "caller":
                v = (r.get("caller") or "-").strip()[: col_widths[key]]
                parts.append(v.ljust(col_widths[key]))
            else:
                v = r.get(key)
                if kind == "pct":
                    txt = _fmt(v, "pct")
                elif kind == "x":
                    txt = _fmt(v, "x")
                elif kind == "int":
                    txt = _fmt(v, "int")
                else:
                    txt = _fmt(v, "num")
                parts.append(txt.rjust(col_widths[key]))
        print("  ".join(parts))


def _latest_run_id(con: duckdb.DuckDBPyConnection) -> Optional[str]:
    try:
        row = con.execute("""
            SELECT run_id::VARCHAR
            FROM bt.runs_d
            ORDER BY created_at DESC
            LIMIT 1
        """).fetchone()
        return row[0] if row else None
    except Exception:
        return None


def leaderboard_from_bt(
    con: duckdb.DuckDBPyConnection,
    run_id: Optional[str],
    min_trades: int,
    order_by: str,
) -> List[Dict[str, Any]]:
    where_run = ""
    params: List[Any] = []
    if run_id:
        where_run = "WHERE s.run_id = ?::UUID"
        params.append(run_id)

    order_expr = {
        "expectancy": "expectancy_pct DESC NULLS LAST, n DESC",
        "profit_factor": "profit_factor DESC NULLS LAST, n DESC",
        "hit2x": "hit2x_pct DESC NULLS LAST, n DESC",
        "hit4x": "hit4x_pct DESC NULLS LAST, n DESC",
        "median_ath": "median_ath DESC NULLS LAST, n DESC",
        "avg_ret": "avg_tp_sl_ret_pct DESC NULLS LAST, n DESC",
        "median_ret": "median_tp_sl_ret_pct DESC NULLS LAST, n DESC",
        "p75": "p75_tp_sl_ret_pct DESC NULLS LAST, n DESC",
    }.get(order_by, "expectancy_pct DESC NULLS LAST, n DESC")

    sql = f"""
WITH base AS (
  SELECT
    s.caller_name AS caller,
    o.ath_multiple AS ath_mult,
    o.hit_2x AS hit_2x,
    o.max_drawdown_pct AS max_dd_pct,

    try_cast(json_extract(o.details_json, '$.peak_pnl_pct') AS DOUBLE) AS peak_pnl_pct,
    try_cast(json_extract(o.details_json, '$.tp_sl_ret') AS DOUBLE) AS tp_sl_ret,
    try_cast(json_extract(o.details_json, '$.time_to_4x_s') AS DOUBLE) AS time_to_4x_s
  FROM bt.alert_scenarios_d s
  JOIN bt.alert_outcomes_f o USING (scenario_id)
  {where_run}
),
filtered AS (
  SELECT *
  FROM base
  WHERE caller IS NOT NULL AND caller <> ''
    AND tp_sl_ret IS NOT NULL
)
SELECT
  caller,
  count(*)::BIGINT AS n,

  avg(CASE WHEN hit_2x THEN 1.0 ELSE 0.0 END) * 100.0 AS hit2x_pct,
  avg(CASE WHEN time_to_4x_s IS NOT NULL THEN 1.0 ELSE 0.0 END) * 100.0 AS hit4x_pct,

  median(ath_mult) AS median_ath,
  median(peak_pnl_pct) AS median_peak_pnl_pct,

  quantile_cont(tp_sl_ret, 0.25) * 100.0 AS p25_tp_sl_ret_pct,
  quantile_cont(tp_sl_ret, 0.75) * 100.0 AS p75_tp_sl_ret_pct,
  median(tp_sl_ret) * 100.0 AS median_tp_sl_ret_pct,
  avg(tp_sl_ret) * 100.0 AS avg_tp_sl_ret_pct,

  CASE
    WHEN abs(sum(CASE WHEN tp_sl_ret < 0 THEN tp_sl_ret ELSE 0 END)) = 0
      THEN CASE WHEN sum(CASE WHEN tp_sl_ret > 0 THEN tp_sl_ret ELSE 0 END) > 0 THEN 999999.0 ELSE NULL END
    ELSE
      sum(CASE WHEN tp_sl_ret > 0 THEN tp_sl_ret ELSE 0 END)
      /
      abs(sum(CASE WHEN tp_sl_ret < 0 THEN tp_sl_ret ELSE 0 END))
  END AS profit_factor,

  avg(tp_sl_ret) * 100.0 AS expectancy_pct,

  min(max_dd_pct) AS worst_dd_pct

FROM filtered
GROUP BY caller
HAVING count(*) >= {int(min_trades)}
ORDER BY {order_expr}
    """.strip()

    rows = con.execute(sql, params).fetchall()
    cols = [d[0] for d in con.description]

    out: List[Dict[str, Any]] = []
    for i, r in enumerate(rows, start=1):
        d = dict(zip(cols, r))
        d["rank"] = i
        out.append(d)
    return out


def leaderboard_from_csv(
    con: duckdb.DuckDBPyConnection,
    csv_path: str,
    min_trades: int,
    order_by: str,
) -> List[Dict[str, Any]]:
    order_expr = {
        "expectancy": "expectancy_pct DESC NULLS LAST, n DESC",
        "profit_factor": "profit_factor DESC NULLS LAST, n DESC",
        "hit2x": "hit2x_pct DESC NULLS LAST, n DESC",
        "hit4x": "hit4x_pct DESC NULLS LAST, n DESC",
        "median_ath": "median_ath DESC NULLS LAST, n DESC",
        "avg_ret": "avg_tp_sl_ret_pct DESC NULLS LAST, n DESC",
        "median_ret": "median_tp_sl_ret_pct DESC NULLS LAST, n DESC",
        "p75": "p75_tp_sl_ret_pct DESC NULLS LAST, n DESC",
    }.get(order_by, "expectancy_pct DESC NULLS LAST, n DESC")

    sql = f"""
WITH x AS (
  SELECT *
  FROM read_csv_auto(?, header=true)
),
ok AS (
  SELECT
    caller,
    ath_mult::DOUBLE AS ath_mult,
    peak_pnl_pct::DOUBLE AS peak_pnl_pct,
    CASE WHEN time_to_2x_s IS NULL OR trim(cast(time_to_2x_s AS VARCHAR)) = '' THEN FALSE ELSE TRUE END AS hit_2x,
    CASE WHEN time_to_4x_s IS NULL OR trim(cast(time_to_4x_s AS VARCHAR)) = '' THEN FALSE ELSE TRUE END AS hit_4x,
    tp_sl_ret::DOUBLE AS tp_sl_ret,
    (dd_overall::DOUBLE) * 100.0 AS dd_overall_pct
  FROM x
  WHERE status = 'ok'
    AND caller IS NOT NULL AND caller <> ''
    AND tp_sl_ret IS NOT NULL
)
SELECT
  caller,
  count(*)::BIGINT AS n,

  avg(CASE WHEN hit_2x THEN 1.0 ELSE 0.0 END) * 100.0 AS hit2x_pct,
  avg(CASE WHEN hit_4x THEN 1.0 ELSE 0.0 END) * 100.0 AS hit4x_pct,

  median(ath_mult) AS median_ath,
  median(peak_pnl_pct) AS median_peak_pnl_pct,

  quantile_cont(tp_sl_ret, 0.25) * 100.0 AS p25_tp_sl_ret_pct,
  quantile_cont(tp_sl_ret, 0.75) * 100.0 AS p75_tp_sl_ret_pct,
  median(tp_sl_ret) * 100.0 AS median_tp_sl_ret_pct,
  avg(tp_sl_ret) * 100.0 AS avg_tp_sl_ret_pct,

  CASE
    WHEN abs(sum(CASE WHEN tp_sl_ret < 0 THEN tp_sl_ret ELSE 0 END)) = 0
      THEN CASE WHEN sum(CASE WHEN tp_sl_ret > 0 THEN tp_sl_ret ELSE 0 END) > 0 THEN 999999.0 ELSE NULL END
    ELSE
      sum(CASE WHEN tp_sl_ret > 0 THEN tp_sl_ret ELSE 0 END)
      /
      abs(sum(CASE WHEN tp_sl_ret < 0 THEN tp_sl_ret ELSE 0 END))
  END AS profit_factor,

  avg(tp_sl_ret) * 100.0 AS expectancy_pct,

  min(dd_overall_pct) AS worst_dd_pct

FROM ok
GROUP BY caller
HAVING count(*) >= {int(min_trades)}
ORDER BY {order_expr}
    """.strip()

    rows = con.execute(sql, [csv_path]).fetchall()
    cols = [d[0] for d in con.description]

    out: List[Dict[str, Any]] = []
    for i, r in enumerate(rows, start=1):
        d = dict(zip(cols, r))
        d["rank"] = i
        out.append(d)
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description="Caller leaderboard for backtests (DuckDB bt.* or CSV).")
    ap.add_argument("--duckdb", default="data/alerts.duckdb")
    ap.add_argument("--run-id", default=None, help="Run ID (UUID). If omitted, uses latest bt.runs_d.")
    ap.add_argument("--csv", default=None, help="Backtest CSV path (CSV mode instead of bt.* tables).")
    ap.add_argument("--min-trades", type=int, default=25)
    ap.add_argument("--top", type=int, default=30)
    ap.add_argument("--order-by",
                    choices=["expectancy", "profit_factor", "hit2x", "hit4x", "median_ath", "avg_ret", "median_ret", "p75"],
                    default="expectancy")
    ap.add_argument("--output-format", choices=["console", "json"], default="console")
    args = ap.parse_args()

    con = duckdb.connect(args.duckdb, read_only=True)
    try:
        if args.csv:
            rows = leaderboard_from_csv(con, args.csv, args.min_trades, args.order_by)
            if args.output_format == "json":
                print(json.dumps({
                    "success": True,
                    "source": "csv",
                    "csv": args.csv,
                    "min_trades": args.min_trades,
                    "order_by": args.order_by,
                    "rows": rows[: args.top],
                }))
                return
            print(f"[leaderboard] source=csv  file={args.csv}  min_trades={args.min_trades}  order_by={args.order_by}")
            _print_table(rows, args.top)
            return

        run_id = args.run_id or _latest_run_id(con)
        if not run_id:
            raise SystemExit("[err] No bt.runs_d found. Run a backtest with storage or pass --csv.")

        rows = leaderboard_from_bt(con, run_id, args.min_trades, args.order_by)

        if args.output_format == "json":
            print(json.dumps({
                "success": True,
                "source": "bt",
                "run_id": run_id,
                "min_trades": args.min_trades,
                "order_by": args.order_by,
                "rows": rows[: args.top],
            }))
            return

        print(f"[leaderboard] source=bt  run_id={run_id}  min_trades={args.min_trades}  order_by={args.order_by}")
        _print_table(rows, args.top)

    finally:
        con.close()


if __name__ == "__main__":
    main()

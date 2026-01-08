#!/usr/bin/env python3
"""
TP/SL Backtest CLI

Path metrics + take-profit/stop-loss exit simulation.

Usage:
  # Full pipeline (ClickHouse export + backtest)
  python3 run_tp_sl.py --from 2025-12-01 --to 2025-12-24 --store-duckdb

  # With existing slice (skip ClickHouse)
  python3 run_tp_sl.py --from 2025-12-01 --to 2025-12-24 --slice slices/slice.parquet

  # Custom TP/SL
  python3 run_tp_sl.py --from 2025-12-01 --to 2025-12-24 --tp-mult 3.0 --sl-mult 0.3
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import uuid
from pathlib import Path

# Add lib to path
sys.path.insert(0, str(Path(__file__).parent))

from lib import (
    Alert,
    load_alerts,
    ClickHouseCfg,
    export_slice_streaming,
    query_coverage_batched,
    partition_slice,
    is_hive_partitioned,
    run_tp_sl_query,
    store_tp_sl_run,
    summarize_tp_sl,
    aggregate_by_caller,
    print_caller_leaderboard,
    parse_yyyy_mm_dd,
    compute_slice_fingerprint,
    write_csv,
    pct,
)


def main() -> None:
    ap = argparse.ArgumentParser(description="TP/SL backtest: path metrics + exit simulation")

    # Date range
    ap.add_argument("--from", dest="date_from", required=True, help="Start date (YYYY-MM-DD)")
    ap.add_argument("--to", dest="date_to", required=True, help="End date (YYYY-MM-DD)")

    # Data sources
    ap.add_argument("--duckdb", default=os.getenv("DUCKDB_PATH", "data/alerts.duckdb"))
    ap.add_argument("--chain", default="solana")

    # ClickHouse (for slice export)
    ap.add_argument("--ch-host", default=os.getenv("CLICKHOUSE_HOST", "localhost"))
    ap.add_argument("--ch-port", type=int, default=int(os.getenv("CLICKHOUSE_PORT", "9000")))
    ap.add_argument("--ch-database", default=os.getenv("CLICKHOUSE_DATABASE", "default"))
    ap.add_argument("--ch-table", default=os.getenv("CLICKHOUSE_TABLE", "ohlcv_candles"))
    ap.add_argument("--ch-user", default=os.getenv("CLICKHOUSE_USER", "default"))
    ap.add_argument("--ch-password", default=os.getenv("CLICKHOUSE_PASSWORD", ""))
    ap.add_argument("--ch-batch", type=int, default=1000, help="Max mints per ClickHouse IN() chunk")
    ap.add_argument("--ch-parallel", type=int, default=4, help="Parallel ClickHouse fetch workers")

    # Backtest params
    ap.add_argument("--interval-seconds", type=int, choices=[60, 300], default=60)
    ap.add_argument("--horizon-hours", type=int, default=48)

    # TP/SL params
    ap.add_argument("--tp-mult", type=float, default=2.0, help="Take-profit multiplier (e.g., 2.0 = 2x)")
    ap.add_argument("--sl-mult", type=float, default=0.5, help="Stop-loss multiplier (e.g., 0.5 = -50%)")
    ap.add_argument("--intrabar-order", choices=["sl_first", "tp_first"], default="sl_first",
                    help="Which exit to take if both TP and SL hit in same candle")
    ap.add_argument("--fee-bps", type=float, default=30.0, help="Trading fees in basis points")
    ap.add_argument("--slippage-bps", type=float, default=50.0, help="Slippage in basis points")

    # Slice handling
    ap.add_argument("--slice-dir", default="slices")
    ap.add_argument("--slice", default=None, help="Use specific slice (skip ClickHouse export)")
    ap.add_argument("--reuse-slice", action="store_true", help="Reuse cached slice if exists")
    ap.add_argument("--partition", action="store_true", help="Partition slice by token_address")

    # Output
    ap.add_argument("--out", default="results/tp_sl_results.csv")
    ap.add_argument("--min-trades", type=int, default=10)
    ap.add_argument("--top", type=int, default=50)

    # Execution
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--output-format", choices=["console", "json"], default="console")
    ap.add_argument("--verbose", action="store_true")

    # Storage
    ap.add_argument("--store-duckdb", action="store_true", default=True,
                    help="Store to bt.* schema (default: True)")
    ap.add_argument("--no-store-duckdb", action="store_false", dest="store_duckdb",
                    help="Disable storing to DuckDB")
    ap.add_argument("--run-name", default=None)

    args = ap.parse_args()

    date_from = parse_yyyy_mm_dd(args.date_from)
    date_to = parse_yyyy_mm_dd(args.date_to)
    verbose = args.verbose or args.output_format != "json"

    # Step 1: Load alerts
    if verbose:
        print(f"[1/5] Loading alerts from {args.duckdb}...", file=sys.stderr)
    alerts = load_alerts(args.duckdb, args.chain, date_from, date_to)
    if not alerts:
        raise SystemExit("No alerts found for that date range.")
    if verbose:
        print(f"      Found {len(alerts)} alerts", file=sys.stderr)

    mints = set(a.mint for a in alerts)

    # Step 2: Get or create slice
    if args.slice:
        slice_path = Path(args.slice)
        if not slice_path.exists():
            raise SystemExit(f"Slice not found: {slice_path}")
        if verbose:
            print(f"[2/5] Using provided slice: {slice_path}", file=sys.stderr)
    else:
        # Need ClickHouse
        try:
            from clickhouse_driver import Client as ClickHouseClient
        except ImportError:
            raise SystemExit("clickhouse-driver not installed. Run: pip install clickhouse-driver")

        ch_cfg = ClickHouseCfg(
            host=args.ch_host,
            port=args.ch_port,
            database=args.ch_database,
            table=args.ch_table,
            user=args.ch_user,
            password=args.ch_password,
        )

        fingerprint = compute_slice_fingerprint(mints, args.chain, date_from, date_to, args.interval_seconds)
        slice_path = Path(args.slice_dir) / f"slice_{date_from.strftime('%Y%m%d')}_{date_to.strftime('%Y%m%d')}_{fingerprint}.parquet"

        if args.reuse_slice and slice_path.exists():
            if verbose:
                print(f"[2/5] Reusing cached slice: {slice_path}", file=sys.stderr)
        else:
            if verbose:
                print("[2/5] Querying ClickHouse coverage (batched)...", file=sys.stderr)
            t0 = time.time()
            coverage = query_coverage_batched(
                ch_cfg, args.chain, mints, args.interval_seconds, date_from, date_to,
                ch_batch=args.ch_batch, parallel=args.ch_parallel
            )
            covered_mints = {m for m, cnt in coverage.items() if cnt > 0}
            if verbose:
                print(f"      Coverage: {len(covered_mints)}/{len(mints)} tokens ({time.time()-t0:.1f}s)", file=sys.stderr)
            if not covered_mints:
                raise SystemExit("No tokens have candle data for this period.")

            if verbose:
                print("[3/5] Exporting slice (streaming)...", file=sys.stderr)
            t0 = time.time()
            row_count = export_slice_streaming(
                ch_cfg,
                args.chain,
                covered_mints,
                args.interval_seconds,
                date_from,
                date_to,
                slice_path,
                ch_batch=args.ch_batch,
                pre_window_minutes=60,
                post_window_hours=int(args.horizon_hours) + 24,
                parallel=args.ch_parallel,
                verbose=verbose,
            )
            if verbose:
                print(f"      Exported {row_count:,} candles in {time.time()-t0:.1f}s", file=sys.stderr)

    # Step 3: Partition if needed
    is_partitioned = is_hive_partitioned(slice_path)
    if args.partition and not is_partitioned:
        if verbose:
            print("[4/5] Partitioning slice...", file=sys.stderr)
        part_path = slice_path.parent / f"{slice_path.stem}_part"
        t0 = time.time()
        partition_slice(slice_path, part_path, args.threads, verbose=verbose)
        if verbose:
            print(f"      Partitioned in {time.time()-t0:.1f}s", file=sys.stderr)
        slice_path = part_path
        is_partitioned = True
    elif verbose:
        mode = "partitioned" if is_partitioned else "single file"
        print(f"[4/5] Using slice ({mode}): {slice_path}", file=sys.stderr)

    # Step 4: Run backtest
    if verbose:
        print(f"[5/5] Running TP/SL backtest (tp={args.tp_mult}x, sl={args.sl_mult}x)...", file=sys.stderr)
    t0 = time.time()
    out_rows = run_tp_sl_query(
        alerts=alerts,
        slice_path=slice_path,
        is_partitioned=is_partitioned,
        interval_seconds=args.interval_seconds,
        horizon_hours=args.horizon_hours,
        tp_mult=args.tp_mult,
        sl_mult=args.sl_mult,
        intrabar_order=args.intrabar_order,
        fee_bps=args.fee_bps,
        slippage_bps=args.slippage_bps,
        threads=args.threads,
        verbose=verbose,
    )
    if verbose:
        print(f"      Query completed in {time.time()-t0:.1f}s", file=sys.stderr)

    # Step 5: Summarize
    summary = summarize_tp_sl(out_rows)
    caller_agg = aggregate_by_caller(out_rows, min_trades=args.min_trades)

    # Write CSV
    result_fields = [
        "alert_id", "mint", "caller", "alert_ts_utc", "entry_ts_utc",
        "interval_seconds", "horizon_hours", "status", "candles", "entry_price",
        "ath_mult", "time_to_ath_s", "time_to_2x_s", "time_to_3x_s", "time_to_4x_s",
        "time_to_5x_s", "time_to_10x_s",
        "dd_initial", "dd_overall", "dd_pre2x", "dd_after_2x", "dd_after_3x",
        "dd_after_4x", "dd_after_5x", "dd_after_10x", "dd_after_ath",
        "peak_pnl_pct", "ret_end",
        "tp_sl_exit_reason", "tp_sl_ret"
    ]
    write_csv(args.out, result_fields, out_rows)

    # Storage
    run_id = uuid.uuid4().hex
    stored = False

    if args.store_duckdb:
        run_name = args.run_name or f"tp_sl:{args.chain}:{args.date_from}->{args.date_to}:tp{args.tp_mult}:sl{args.sl_mult}"
        config = {
            "date_from": date_from.strftime("%Y-%m-%d"),
            "date_to": date_to.strftime("%Y-%m-%d"),
            "interval_seconds": int(args.interval_seconds),
            "horizon_hours": int(args.horizon_hours),
            "chain": args.chain,
            "tp_mult": float(args.tp_mult),
            "sl_mult": float(args.sl_mult),
            "intrabar_order": args.intrabar_order,
            "fee_bps": float(args.fee_bps),
            "slippage_bps": float(args.slippage_bps),
        }
        store_tp_sl_run(
            args.duckdb,
            run_id,
            run_name,
            config,
            out_rows,
            summary,
        )
        stored = True
        if verbose:
            print(f"[stored] bt.* run_id={run_id}", file=sys.stderr)

    # Output
    if args.output_format == "json":
        print(json.dumps({
            "success": True,
            "run_id": run_id,
            "stored": stored,
            "slice_path": str(slice_path),
            "out": args.out,
            "summary": summary,
            "callers_count": len(caller_agg),
        }))
        return

    # Console output
    print()
    print("=" * 70)
    print("TP/SL BACKTEST COMPLETE")
    print("=" * 70)
    print(f"Date range: {date_from.strftime('%Y-%m-%d')} to {date_to.strftime('%Y-%m-%d')}")
    print(f"Horizon: {args.horizon_hours} hours | Interval: {args.interval_seconds}s")
    print(f"TP: {args.tp_mult}x | SL: {args.sl_mult}x | Fees: {args.fee_bps}bps | Slippage: {args.slippage_bps}bps")
    print(f"Slice: {slice_path}")
    print(f"Alerts: {summary['alerts_total']} total, {summary['alerts_ok']} ok, {summary['alerts_missing']} missing")
    print(f"Run ID: {run_id} (stored: {stored})")
    print()

    print("--- PATH METRICS ---")
    if summary["median_ath_mult"] is not None:
        print(f"Median ATH: {summary['median_ath_mult']:.2f}x")
    print(f"% hit 2x: {pct(summary['pct_hit_2x']):.1f}%")
    print(f"% hit 4x: {pct(summary['pct_hit_4x']):.1f}%")
    if summary["median_time_to_2x_s"] is not None:
        print(f"Median time-to-2x: {summary['median_time_to_2x_s']/3600:.2f} hours")
    if summary["median_dd_initial"] is not None:
        print(f"Median initial DD: {summary['median_dd_initial']*100:.1f}%")
    if summary["median_dd_overall"] is not None:
        print(f"Median overall DD: {summary['median_dd_overall']*100:.1f}%")
    print()

    print("--- TP/SL POLICY ---")
    print(f"Total return: {summary['tp_sl_total_return_pct']:.1f}%")
    print(f"Avg return: {summary['tp_sl_avg_return_pct']:.2f}%")
    print(f"Win rate: {summary['tp_sl_win_rate']*100:.1f}%")
    print(f"Avg win: {summary['tp_sl_avg_win_pct']:.2f}%")
    print(f"Avg loss: {summary['tp_sl_avg_loss_pct']:.2f}%")
    pf = summary["tp_sl_profit_factor"]
    pf_str = f"{pf:.2f}" if pf != float("inf") else "∞"
    print(f"Profit factor: {pf_str}")
    print(f"Expectancy: {summary['tp_sl_expectancy_pct']:.2f}%")
    print()

    print(f"--- CALLER LEADERBOARD (min {args.min_trades} trades, top {args.top}) ---")
    print_caller_leaderboard(caller_agg, limit=args.top)
    print()
    print(f"Results CSV: {args.out}")


if __name__ == "__main__":
    main()


#!/usr/bin/env python3
"""
Strategy Backtest Pipeline

End-to-end workflow with configurable exit strategies:
1. Load alerts from DuckDB
2. Query ClickHouse for coverage (batched)
3. Export candle slice to Parquet (streaming, batched inserts into DuckDB)
4. Optional partition (DuckDB COPY PARTITION_BY)
5. Run vectorized strategy backtest (path metrics + TP/SL simulation)
6. Aggregate results by caller for leaderboard
7. Optionally store to DuckDB

Supports:
- Basic SL/TP (single level)
- Ladder exits (multiple TP levels) [Future: SQL extension]
- Trailing stops [Future: SQL extension]
- Max time limits [Future]
- Re-entries & delayed entries [Future]

Usage:
  # Basic TP/SL (2x TP, -50% SL)
  python3 run_strategy.py --from 2025-12-01 --to 2025-12-24 --tp 2.0 --sl 0.5

  # With existing slice (skip ClickHouse export)
  python3 run_strategy.py --from 2025-12-01 --to 2025-12-24 --slice slices/slice.parquet

  # Custom fees
  python3 run_strategy.py --from 2025-12-01 --to 2025-12-24 --fee-bps 50 --slippage-bps 100

  # Store results to DuckDB
  python3 run_strategy.py --from 2025-12-01 --to 2025-12-24 --store-duckdb
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
    is_per_token_directory,
    detect_slice_type,
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
from lib.summary import print_caller_returns_table
from lib.strategy_config import StrategyConfig


def build_strategy_from_args(args: argparse.Namespace) -> StrategyConfig:
    """
    Build a StrategyConfig from CLI arguments.
    
    Currently supports basic TP/SL. Extended modes (ladder, trailing)
    will be added as CLI flags in future iterations.
    """
    strategy_name = args.strategy_name or f"tp{args.tp}x_sl{args.sl}x"
    
    return StrategyConfig.simple_tp_sl(
        name=strategy_name,
        tp_mult=args.tp,
        sl_mult=args.sl,
        fee_bps=args.fee_bps,
        slippage_bps=args.slippage_bps,
        intrabar_order=args.intrabar_order,
    )


def main() -> None:
    ap = argparse.ArgumentParser(
        description="Strategy backtest: path metrics + configurable exit simulation",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Basic 2x TP, 50% SL
  python3 run_strategy.py --from 2025-12-01 --to 2025-12-24 --tp 2.0 --sl 0.5

  # Conservative: 1.5x TP, 30% SL
  python3 run_strategy.py --from 2025-12-01 --to 2025-12-24 --tp 1.5 --sl 0.7

  # Aggressive: 4x TP, 70% SL
  python3 run_strategy.py --from 2025-12-01 --to 2025-12-24 --tp 4.0 --sl 0.3

  # With existing slice
  python3 run_strategy.py --from 2025-12-01 --to 2025-12-24 --slice slices/slice.parquet

  # Store to DuckDB
  python3 run_strategy.py --from 2025-12-01 --to 2025-12-24 --store-duckdb
""",
    )

    # Date range
    ap.add_argument("--from", dest="date_from", required=True, help="Start date (YYYY-MM-DD)")
    ap.add_argument("--to", dest="date_to", required=True, help="End date (YYYY-MM-DD)")

    # Data sources
    ap.add_argument("--duckdb", default=os.getenv("DUCKDB_PATH", "data/alerts.duckdb"),
                    help="Path to DuckDB file with alerts")
    ap.add_argument("--chain", default="solana", help="Chain name (default: solana)")

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
    ap.add_argument("--interval-seconds", type=int, choices=[60, 300], default=60,
                    help="Candle interval in seconds (default: 60)")
    ap.add_argument("--horizon-hours", type=int, default=48,
                    help="Lookforward window in hours (default: 48)")

    # Strategy params (basic SL/TP)
    ap.add_argument("--tp", type=float, default=2.0,
                    help="Take-profit multiplier (e.g., 2.0 for 2x entry price)")
    ap.add_argument("--sl", type=float, default=0.5,
                    help="Stop-loss multiplier (e.g., 0.5 for -50%% from entry)")
    ap.add_argument("--intrabar-order", choices=["sl_first", "tp_first"], default="sl_first",
                    help="Which exit to take if both TP and SL hit in same candle")
    ap.add_argument("--strategy-name", default=None,
                    help="Custom strategy name (default: auto-generated)")

    # Cost params
    ap.add_argument("--fee-bps", type=float, default=30.0,
                    help="Trading fees in basis points (default: 30 = 0.3%%)")
    ap.add_argument("--slippage-bps", type=float, default=50.0,
                    help="Slippage in basis points (default: 50 = 0.5%%)")

    # Risk params
    ap.add_argument("--risk-per-trade", type=float, default=0.02,
                    help="Max risk per trade as fraction of portfolio (default: 0.02 = 2%%)")

    # Slice handling
    ap.add_argument("--slice-dir", default="slices",
                    help="Directory for slice files (default: slices)")
    ap.add_argument("--slice", default=None,
                    help="Use specific slice file (skip ClickHouse export)")
    ap.add_argument("--reuse-slice", action="store_true",
                    help="Reuse cached slice if exists")
    ap.add_argument("--partition", action="store_true",
                    help="Partition slice by token_address")

    # Output
    ap.add_argument("--out", default="results/strategy_results.csv",
                    help="Output CSV path (default: results/strategy_results.csv)")
    ap.add_argument("--min-trades", type=int, default=10,
                    help="Minimum trades for caller leaderboard (default: 10)")
    ap.add_argument("--top", type=int, default=50,
                    help="Top N callers to show (default: 50)")

    # Execution
    ap.add_argument("--threads", type=int, default=8,
                    help="DuckDB threads (default: 8)")
    ap.add_argument("--output-format", choices=["console", "json"], default="console",
                    help="Output format (default: console)")
    ap.add_argument("--verbose", action="store_true",
                    help="Verbose output")

    # Storage
    ap.add_argument("--store-duckdb", action="store_true", default=True,
                    help="Store results to bt.* schema in DuckDB (default: True)")
    ap.add_argument("--no-store-duckdb", action="store_false", dest="store_duckdb",
                    help="Disable storing results to DuckDB")
    ap.add_argument("--run-name", default=None,
                    help="Custom run name for storage")

    args = ap.parse_args()

    date_from = parse_yyyy_mm_dd(args.date_from)
    date_to = parse_yyyy_mm_dd(args.date_to)
    verbose = args.verbose or args.output_format != "json"

    # Build strategy config from args
    strategy = build_strategy_from_args(args)

    if verbose:
        print(f"[strategy] {strategy.name}", file=sys.stderr)
        print(f"           TP: {strategy.first_tp_mult}x | SL: {strategy.sl_mult}x", file=sys.stderr)
        print(f"           Fees: {strategy.costs.fee_bps}bps | Slippage: {strategy.costs.slippage_bps}bps", file=sys.stderr)
        print(file=sys.stderr)

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
            from clickhouse_driver import Client as ClickHouseClient  # noqa: F401
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

    # Step 3: Determine slice type and partition if needed
    if slice_path.is_dir():
        slice_type = detect_slice_type(slice_path)
    else:
        slice_type = "file"

    if args.partition and slice_type == "file":
        if verbose:
            print("[4/5] Partitioning slice...", file=sys.stderr)
        part_path = slice_path.parent / f"{slice_path.stem}_part"
        t0 = time.time()
        partition_slice(slice_path, part_path, args.threads, verbose=verbose)
        if verbose:
            print(f"      Partitioned in {time.time()-t0:.1f}s", file=sys.stderr)
        slice_path = part_path
        slice_type = "hive"
    elif verbose:
        mode_names = {"file": "single file", "hive": "Hive-partitioned", "per_token": "per-token"}
        mode = mode_names.get(slice_type, slice_type)
        print(f"[4/5] Using slice ({mode}): {slice_path}", file=sys.stderr)

    # Step 4: Run backtest
    if verbose:
        print(f"[5/5] Running strategy backtest ({strategy.name})...", file=sys.stderr)
    t0 = time.time()
    out_rows = run_tp_sl_query(
        alerts=alerts,
        slice_path=slice_path,
        interval_seconds=args.interval_seconds,
        horizon_hours=args.horizon_hours,
        tp_mult=strategy.first_tp_mult,
        sl_mult=strategy.sl_mult,
        intrabar_order=strategy.intrabar_order,
        fee_bps=strategy.costs.fee_bps,
        slippage_bps=strategy.costs.slippage_bps,
        threads=args.threads,
        verbose=verbose,
        slice_type=slice_type,
    )
    if verbose:
        print(f"      Query completed in {time.time()-t0:.1f}s", file=sys.stderr)

    # Step 5: Summarize (with risk-adjusted returns)
    summary = summarize_tp_sl(
        out_rows,
        sl_mult=strategy.sl_mult,
        risk_per_trade=args.risk_per_trade,
    )
    caller_agg = aggregate_by_caller(
        out_rows,
        min_trades=args.min_trades,
        sl_mult=strategy.sl_mult,
        risk_per_trade=args.risk_per_trade,
    )

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
        run_name = args.run_name or f"strategy:{strategy.name}:{args.chain}:{args.date_from}->{args.date_to}"
        config = {
            "date_from": date_from.strftime("%Y-%m-%d"),
            "date_to": date_to.strftime("%Y-%m-%d"),
            "interval_seconds": int(args.interval_seconds),
            "horizon_hours": int(args.horizon_hours),
            "chain": args.chain,
            "tp_mult": float(strategy.first_tp_mult),
            "sl_mult": float(strategy.sl_mult),
            "intrabar_order": strategy.intrabar_order,
            "fee_bps": float(strategy.costs.fee_bps),
            "slippage_bps": float(strategy.costs.slippage_bps),
            "strategy": strategy.to_dict(),
        }
        # store_tp_sl_run handles queue fallback internally on lock conflicts
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
            "strategy": strategy.to_dict(),
            "summary": summary,
            "callers_count": len(caller_agg),
        }))
        return

    # Console output
    print()
    print("=" * 70)
    print(f"STRATEGY BACKTEST COMPLETE: {strategy.name}")
    print("=" * 70)
    print(f"Date range: {date_from.strftime('%Y-%m-%d')} to {date_to.strftime('%Y-%m-%d')}")
    print(f"Horizon: {args.horizon_hours} hours | Interval: {args.interval_seconds}s")
    print(f"TP: {strategy.first_tp_mult}x | SL: {strategy.sl_mult}x")
    print(f"Fees: {strategy.costs.fee_bps}bps | Slippage: {strategy.costs.slippage_bps}bps")
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

    print("--- STRATEGY PERFORMANCE (raw, 100% position size) ---")
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

    print(f"--- RISK-ADJUSTED RETURNS ({summary['risk_per_trade_pct']:.1f}% risk per trade) ---")
    print(f"Position size: {summary['position_size_pct']:.2f}% of portfolio per trade")
    print(f"Total return: {summary['risk_adj_total_return_pct']:.2f}%")
    print(f"Avg return: {summary['risk_adj_avg_return_pct']:.3f}%")
    print(f"Avg win: {summary['risk_adj_avg_win_pct']:.3f}%")
    print(f"Avg loss: {summary['risk_adj_avg_loss_pct']:.3f}%")
    print()

    print(f"--- CALLER LEADERBOARD (min {args.min_trades} trades, top {args.top}, sorted by risk-adj return) ---")
    print_caller_leaderboard(caller_agg, limit=args.top)
    print()
    print(f"--- CALLER RETURNS DETAIL ---")
    print_caller_returns_table(caller_agg, limit=args.top)
    print()
    print(f"Results CSV: {args.out}")


if __name__ == "__main__":
    main()


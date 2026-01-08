#!/usr/bin/env python3
"""
TP/SL Grid Optimizer CLI

Run parameter optimization to find optimal TP/SL levels.

Usage:
  # Basic grid search with explicit values
  python3 run_optimizer.py \
    --from 2025-12-01 --to 2025-12-24 \
    --tp-values 1.5,2.0,2.5,3.0,4.0,5.0 \
    --sl-values 0.3,0.4,0.5,0.6,0.7

  # Range-based grid search
  python3 run_optimizer.py \
    --from 2025-12-01 --to 2025-12-24 \
    --tp-range 1.5:5.0:0.5 \
    --sl-range 0.3:0.7:0.1

  # With caller group filter
  python3 run_optimizer.py \
    --from 2025-12-01 --to 2025-12-24 \
    --tp-values 2.0,3.0,4.0 \
    --sl-values 0.4,0.5,0.6 \
    --caller-group top_20

  # Use existing slice
  python3 run_optimizer.py \
    --from 2025-12-01 --to 2025-12-24 \
    --tp-values 2.0,3.0 \
    --sl-values 0.5 \
    --slice slices/my_slice.parquet

  # From config file
  python3 run_optimizer.py --config configs/optimizer/my_config.yaml

  # Generate example config
  python3 run_optimizer.py --generate-config configs/optimizer/example.yaml
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

# Add lib to path
sys.path.insert(0, str(Path(__file__).parent))

from lib.optimizer import GridOptimizer, run_optimization
from lib.optimizer_config import (
    OptimizerConfig,
    RangeSpec,
    TpSlParamSpace,
    create_basic_optimizer_config,
    create_grid_search_config,
)
from lib.trial_ledger import store_optimizer_run


def parse_values(s: str) -> list[float]:
    """Parse comma-separated float values."""
    return [float(x.strip()) for x in s.split(",")]


def parse_range(s: str) -> tuple[float, float, float]:
    """Parse start:end:step range spec."""
    parts = s.split(":")
    if len(parts) != 3:
        raise ValueError(f"Range must be start:end:step, got {s}")
    return float(parts[0]), float(parts[1]), float(parts[2])


def cmd_run(args: argparse.Namespace) -> None:
    """Run the optimizer."""
    # Load from config file if provided
    if args.config:
        if args.config.endswith(".yaml") or args.config.endswith(".yml"):
            config = OptimizerConfig.from_yaml(args.config)
        else:
            config = OptimizerConfig.from_json(args.config)
        
        # Apply CLI overrides
        if args.date_from:
            config.date_from = args.date_from
        if args.date_to:
            config.date_to = args.date_to
        if args.caller_group:
            config.caller_group = args.caller_group
        if args.slice:
            config.slice_path = args.slice
    else:
        # Build config from CLI args
        if not args.date_from or not args.date_to:
            print("Error: --from and --to are required", file=sys.stderr)
            sys.exit(1)
        
        # Parse TP values/range
        if args.tp_values:
            tp_spec = RangeSpec(values=parse_values(args.tp_values))
        elif args.tp_range:
            start, end, step = parse_range(args.tp_range)
            tp_spec = RangeSpec(start=start, end=end, step=step)
        else:
            # Default
            tp_spec = RangeSpec(values=[1.5, 2.0, 2.5, 3.0, 4.0, 5.0])
        
        # Parse SL values/range
        if args.sl_values:
            sl_spec = RangeSpec(values=parse_values(args.sl_values))
        elif args.sl_range:
            start, end, step = parse_range(args.sl_range)
            sl_spec = RangeSpec(start=start, end=end, step=step)
        else:
            # Default
            sl_spec = RangeSpec(values=[0.3, 0.4, 0.5, 0.6, 0.7])
        
        # Intrabar order
        intrabar = args.intrabar_order.split(",") if args.intrabar_order else ["sl_first"]
        
        config = OptimizerConfig(
            name=args.name or f"opt_{args.date_from}_{args.date_to}",
            date_from=args.date_from,
            date_to=args.date_to,
            duckdb_path=args.duckdb,
            chain=args.chain,
            slice_dir=args.slice_dir,
            slice_path=args.slice,
            reuse_slice=not args.no_reuse_slice,
            interval_seconds=args.interval_seconds,
            horizon_hours=args.horizon_hours,
            fee_bps=args.fee_bps,
            slippage_bps=args.slippage_bps,
            caller_group=args.caller_group,
            caller_ids=args.caller_ids.split(",") if args.caller_ids else None,
            tp_sl=TpSlParamSpace(
                tp_mult=tp_spec,
                sl_mult=sl_spec,
                intrabar_order=intrabar,
            ),
            threads=args.threads,
            store_duckdb=args.store_duckdb,
            output_dir=args.output_dir,
            risk_per_trade=args.risk_per_trade,
        )
    
    # Print config summary
    total = config.count_combinations()
    print(f"Optimizer: {config.name}")
    print(f"Date range: {config.date_from} to {config.date_to}")
    print(f"Parameter combinations: {total}")
    
    if config.tp_sl:
        tp_vals = config.tp_sl.tp_mult.expand()
        sl_vals = config.tp_sl.sl_mult.expand()
        print(f"  TP values: {tp_vals}")
        print(f"  SL values: {sl_vals}")
    
    if config.caller_group:
        print(f"Caller group: {config.caller_group}")
    elif config.caller_ids:
        print(f"Caller IDs: {len(config.caller_ids)} callers")
    
    print()
    
    # Run optimization
    opt_run = run_optimization(config, verbose=not args.quiet)
    
    # ========== ALWAYS STORE TO DUCKDB ==========
    # This is non-negotiable - every run must be recorded for experiment tracking
    try:
        store_optimizer_run(
            duckdb_path=config.duckdb_path,
            run_id=opt_run.run_id,
            run_type="grid_search",
            name=config.name,
            date_from=config.date_from,
            date_to=config.date_to,
            config=config.to_dict(),
            results=[r.to_dict() for r in opt_run.results],
            timing=opt_run.timing,
            notes=f"TP:{config.tp_sl.tp_mult.expand() if config.tp_sl else []} SL:{config.tp_sl.sl_mult.expand() if config.tp_sl else []}",
        )
        print(f"✓ Run stored to DuckDB: {config.duckdb_path} (optimizer.runs_d / optimizer.trials_f)", file=sys.stderr)
    except Exception as e:
        print(f"⚠️  Failed to store to DuckDB: {e}", file=sys.stderr)
    
    # Output results
    if args.json:
        print(json.dumps(opt_run.to_dict(), indent=2, default=str))


def cmd_generate_config(args: argparse.Namespace) -> None:
    """Generate example config file."""
    config = create_grid_search_config(
        name="example_optimizer",
        date_from="2025-12-01",
        date_to="2025-12-24",
        tp_start=1.5,
        tp_end=5.0,
        tp_step=0.5,
        sl_start=0.3,
        sl_end=0.7,
        sl_step=0.1,
    )
    
    path = args.generate_config
    if path.endswith(".yaml") or path.endswith(".yml"):
        config.save_yaml(path)
    else:
        config.save_json(path)
    
    print(f"Generated example config: {path}")
    print()
    print("Edit the config and run with:")
    print(f"  python3 run_optimizer.py --config {path}")


def main() -> None:
    ap = argparse.ArgumentParser(
        description="TP/SL Grid Optimizer",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Quick test with a few values
  python3 run_optimizer.py --from 2025-12-01 --to 2025-12-07 \\
    --tp-values 2.0,3.0 --sl-values 0.5

  # Full grid search
  python3 run_optimizer.py --from 2025-12-01 --to 2025-12-24 \\
    --tp-range 1.5:5.0:0.5 --sl-range 0.3:0.7:0.1

  # Generate config file
  python3 run_optimizer.py --generate-config my_config.yaml
        """,
    )
    
    # Config file
    ap.add_argument("--config", help="Load config from YAML/JSON file")
    ap.add_argument("--generate-config", help="Generate example config file")
    
    # Date range
    ap.add_argument("--from", dest="date_from", help="Start date (YYYY-MM-DD)")
    ap.add_argument("--to", dest="date_to", help="End date (YYYY-MM-DD)")
    
    # TP/SL parameters
    ap.add_argument("--tp-values", help="Comma-separated TP multipliers (e.g., 1.5,2.0,3.0)")
    ap.add_argument("--tp-range", help="TP range as start:end:step (e.g., 1.5:5.0:0.5)")
    ap.add_argument("--sl-values", help="Comma-separated SL multipliers (e.g., 0.3,0.5,0.7)")
    ap.add_argument("--sl-range", help="SL range as start:end:step (e.g., 0.3:0.7:0.1)")
    ap.add_argument("--intrabar-order", help="Intrabar order(s): sl_first,tp_first")
    
    # Data sources
    ap.add_argument("--duckdb", default=os.getenv("DUCKDB_PATH", "data/alerts.duckdb"),
                   help="DuckDB database path")
    ap.add_argument("--chain", default="solana", help="Chain name")
    
    # Slice
    ap.add_argument("--slice", help="Use existing slice file/directory")
    ap.add_argument("--slice-dir", default="slices", help="Slice output directory")
    ap.add_argument("--no-reuse-slice", action="store_true", help="Don't reuse cached slice")
    
    # Backtest params
    ap.add_argument("--interval-seconds", type=int, default=60, choices=[60, 300])
    ap.add_argument("--horizon-hours", type=int, default=48)
    ap.add_argument("--fee-bps", type=float, default=30.0)
    ap.add_argument("--slippage-bps", type=float, default=50.0)
    ap.add_argument("--risk-per-trade", type=float, default=0.02,
                   help="Risk per trade for position sizing (default: 0.02 = 2%%)")
    
    # Caller filtering
    ap.add_argument("--caller-group", help="Filter by caller group name")
    ap.add_argument("--caller-ids", help="Comma-separated caller IDs to filter")
    
    # Execution
    ap.add_argument("--threads", type=int, default=8)
    ap.add_argument("--store-duckdb", action="store_true", default=True,
                    help="Store results to DuckDB (default: True)")
    ap.add_argument("--no-store-duckdb", action="store_false", dest="store_duckdb",
                    help="Disable storing to DuckDB")
    ap.add_argument("--output-dir", default="results/optimizer", help="Output directory")
    ap.add_argument("--name", help="Optimizer run name")
    
    # Output
    ap.add_argument("--json", action="store_true", help="Output results as JSON")
    ap.add_argument("--quiet", "-q", action="store_true", help="Minimal output")
    
    args = ap.parse_args()
    
    # Handle generate-config
    if args.generate_config:
        cmd_generate_config(args)
        return
    
    # Run optimizer
    cmd_run(args)


if __name__ == "__main__":
    main()


#!/usr/bin/env python3
"""
V1 Baseline Optimizer CLI

Capital-aware optimization with finite capital and position constraints.

Usage:
  # Basic optimization
  python3 run_v1_baseline_optimizer.py \
    --from 2025-12-01 --to 2025-12-24 \
    --mode per-caller

  # With custom parameters
  python3 run_v1_baseline_optimizer.py \
    --from 2025-12-01 --to 2025-12-24 \
    --mode both \
    --initial-capital 10000 \
    --max-allocation-pct 0.04 \
    --tp-mults 1.5,2.0,2.5,3.0 \
    --sl-mults 0.85,0.88,0.9,0.92

  # With caller group filter
  python3 run_v1_baseline_optimizer.py \
    --from 2025-12-01 --to 2025-12-24 \
    --mode grouped \
    --caller-group top_20

  # Output JSON
  python3 run_v1_baseline_optimizer.py \
    --from 2025-12-01 --to 2025-12-24 \
    --mode both \
    --json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add lib to path
sys.path.insert(0, str(Path(__file__).parent))

from lib.alerts import load_alerts
from lib.v1_baseline_optimizer import (
    optimize_v1_baseline,
    optimize_v1_baseline_per_caller,
    run_v1_baseline_grouped_evaluation,
)
from lib.v1_baseline_simulator import CapitalSimulatorConfig

UTC = timezone.utc


def parse_float_list(s: str) -> list[float]:
    """Parse comma-separated float values."""
    return [float(x.strip()) for x in s.split(",")]


def load_candles_from_slice(slice_path: str, alert_ids: list[str]) -> dict:
    """
    Load candles from slice for given alert IDs.
    
    For now, this is a placeholder. In production, this would load from
    the actual slice parquet files.
    """
    # TODO: Implement actual slice loading
    # This would use the slice exporter/loader logic
    raise NotImplementedError("Slice loading not yet implemented in CLI")


def format_result_text(result: dict, mode: str) -> str:
    """Format optimization result as text."""
    lines = []
    lines.append(f"\n{'='*60}")
    lines.append(f"V1 Baseline Optimization Results ({mode})")
    lines.append(f"{'='*60}\n")
    
    if mode == "per-caller" or mode == "both":
        per_caller_key = "results" if mode == "per-caller" else "per_caller"
        per_caller_results = result.get(per_caller_key, [])
        
        lines.append(f"Per-Caller Results ({len(per_caller_results)} callers):")
        lines.append(f"{'-'*60}")
        
        for caller_result in per_caller_results:
            caller = caller_result["caller"]
            best_params = caller_result["best_params"]
            final_capital = caller_result["best_final_capital"]
            total_return = caller_result["best_total_return"]
            collapsed = caller_result["collapsed_capital"]
            extreme = caller_result["requires_extreme_params"]
            
            lines.append(f"\nCaller: {caller}")
            lines.append(f"  Best Params: TP={best_params['tp_mult']:.2f}x, SL={best_params['sl_mult']:.2f}")
            lines.append(f"  Final Capital: ${final_capital:.2f}")
            lines.append(f"  Total Return: {total_return*100:.2f}%")
            if collapsed:
                lines.append(f"  ⚠️  COLLAPSED CAPITAL")
            if extreme:
                lines.append(f"  ⚠️  EXTREME PARAMETERS")
    
    if mode == "grouped" or mode == "both":
        grouped_key = "grouped_result" if mode == "both" else "groupedResult"
        grouped_result = result.get("grouped", {}) if mode == "both" else result
        
        selected_callers = grouped_result.get("selected_callers", [])
        grouped_params = grouped_result.get("grouped_params")
        grouped_metrics = grouped_result.get("grouped_result")
        
        lines.append(f"\n\nGrouped Evaluation:")
        lines.append(f"{'-'*60}")
        lines.append(f"Selected Callers: {len(selected_callers)}")
        
        if grouped_params:
            lines.append(f"Grouped Params: TP={grouped_params['tp_mult']:.2f}x, SL={grouped_params['sl_mult']:.2f}")
        
        if grouped_metrics:
            lines.append(f"Final Capital: ${grouped_metrics['final_capital']:.2f}")
            lines.append(f"Total Return: {grouped_metrics['total_return']*100:.2f}%")
            lines.append(f"Trades Executed: {grouped_metrics['trades_executed']}")
            lines.append(f"Trades Skipped: {grouped_metrics['trades_skipped']}")
    
    lines.append(f"\n{'='*60}\n")
    return "\n".join(lines)


def main() -> None:
    ap = argparse.ArgumentParser(
        description="V1 Baseline Optimizer - Capital-aware optimization",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    
    # Date range
    ap.add_argument("--from", dest="date_from", required=True, help="Start date (YYYY-MM-DD)")
    ap.add_argument("--to", dest="date_to", required=True, help="End date (YYYY-MM-DD)")
    
    # Mode
    ap.add_argument(
        "--mode",
        choices=["per-caller", "grouped", "both"],
        default="both",
        help="Optimization mode (default: both)",
    )
    
    # Parameter grid
    ap.add_argument("--tp-mults", help="Comma-separated TP multiples (e.g., 1.5,2.0,2.5,3.0)")
    ap.add_argument("--sl-mults", help="Comma-separated SL multiples (e.g., 0.85,0.88,0.9,0.92)")
    ap.add_argument("--max-hold-hrs", help="Comma-separated max hold hours (e.g., 24,48)")
    
    # Capital simulator config
    ap.add_argument("--initial-capital", type=float, default=10_000, help="Initial capital (default: 10000)")
    ap.add_argument("--max-allocation-pct", type=float, default=0.04, help="Max allocation per trade (default: 0.04)")
    ap.add_argument("--max-risk-per-trade", type=float, default=200, help="Max risk per trade (default: 200)")
    ap.add_argument("--max-concurrent-positions", type=int, default=25, help="Max concurrent positions (default: 25)")
    ap.add_argument("--min-executable-size", type=float, default=10, help="Min executable size (default: 10)")
    ap.add_argument("--taker-fee-bps", type=float, default=30, help="Taker fee in bps (default: 30)")
    ap.add_argument("--slippage-bps", type=float, default=10, help="Slippage in bps (default: 10)")
    
    # Filtering
    ap.add_argument("--caller-group", help="Filter by caller group name")
    ap.add_argument("--min-calls", type=int, default=0, help="Minimum calls per caller (default: 0)")
    ap.add_argument("--filter-collapsed", action="store_true", default=True, help="Filter collapsed callers (default: True)")
    ap.add_argument("--no-filter-collapsed", action="store_false", dest="filter_collapsed", help="Don't filter collapsed callers")
    ap.add_argument("--filter-extreme", action="store_true", default=True, help="Filter extreme params (default: True)")
    ap.add_argument("--no-filter-extreme", action="store_false", dest="filter_extreme", help="Don't filter extreme params")
    
    # Data sources
    ap.add_argument("--duckdb", default=os.getenv("DUCKDB_PATH", "data/alerts.duckdb"), help="DuckDB database path")
    ap.add_argument("--chain", default="solana", help="Chain name")
    ap.add_argument("--slice", help="Use existing slice file/directory")
    
    # Output
    ap.add_argument("--json", action="store_true", help="Output results as JSON")
    ap.add_argument("--quiet", "-q", action="store_true", help="Minimal output")
    
    args = ap.parse_args()
    
    # Parse dates
    date_from = datetime.fromisoformat(args.date_from).replace(tzinfo=UTC)
    date_to = datetime.fromisoformat(args.date_to).replace(tzinfo=UTC)
    
    # Load alerts
    if not args.quiet:
        print(f"Loading alerts from {args.duckdb}...")
    
    alerts = load_alerts(args.duckdb, args.chain, date_from, date_to)
    
    if len(alerts) == 0:
        print(f"Error: No alerts found in date range {args.date_from} to {args.date_to}", file=sys.stderr)
        sys.exit(1)
    
    if not args.quiet:
        print(f"Loaded {len(alerts)} alerts")
    
    # Convert alerts to call dicts
    calls = [
        {
            "id": f"{alert.mint}_{alert.ts_ms}",
            "mint": alert.mint,
            "caller": alert.caller,
            "ts_ms": alert.ts_ms,
        }
        for alert in alerts
    ]
    
    # TODO: Load candles from slice
    # For now, this is a placeholder
    if args.slice:
        print("Error: Slice loading not yet implemented", file=sys.stderr)
        sys.exit(1)
    
    print("Error: Candle loading not yet implemented in CLI", file=sys.stderr)
    print("This CLI script is a template. To use it:", file=sys.stderr)
    print("  1. Implement slice loading (load_candles_from_slice)", file=sys.stderr)
    print("  2. Wire up to existing slice exporter/loader", file=sys.stderr)
    print("  3. Or call the optimizer functions directly from Python", file=sys.stderr)
    sys.exit(1)
    
    # Build parameter grid
    param_grid = {}
    if args.tp_mults:
        param_grid["tp_mults"] = parse_float_list(args.tp_mults)
    if args.sl_mults:
        param_grid["sl_mults"] = parse_float_list(args.sl_mults)
    if args.max_hold_hrs:
        param_grid["max_hold_hrs"] = parse_float_list(args.max_hold_hrs)
    
    # Build simulator config
    simulator_config = CapitalSimulatorConfig(
        initial_capital=args.initial_capital,
        max_allocation_pct=args.max_allocation_pct,
        max_risk_per_trade=args.max_risk_per_trade,
        max_concurrent_positions=args.max_concurrent_positions,
        min_executable_size=args.min_executable_size,
        taker_fee_bps=args.taker_fee_bps,
        slippage_bps=args.slippage_bps,
    )
    
    # Run optimization based on mode
    # (This is where the actual optimization would happen after candles are loaded)
    
    if not args.quiet:
        print("Optimization complete!")


if __name__ == "__main__":
    main()


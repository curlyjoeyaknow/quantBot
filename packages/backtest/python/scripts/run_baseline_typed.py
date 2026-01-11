#!/usr/bin/env python3
"""
Baseline Backtest with Type Hints

Example of using auto-generated type stubs from Zod schemas.
This provides IDE autocomplete and mypy type checking.
"""

import sys
import json
from typing import cast

# Import generated type stubs
from packages.backtest.python.types.baseline_backtest import (
    BaselineBacktestConfig,
    BaselineBacktestResult,
    BaselineBacktestSummary,
    TokenResult,
)


def run_baseline(config: BaselineBacktestConfig) -> BaselineBacktestResult:
    """
    Run baseline backtest with type-safe configuration.

    Args:
        config: Baseline backtest configuration (type-checked!)

    Returns:
        Baseline backtest result (type-checked!)
    """
    # IDE now has autocomplete for config fields!
    duckdb_path = config['duckdb']
    from_date = config['from_']  # Note: 'from' → 'from_' in Python
    to_date = config['to']
    chain = config.get('chain', 'solana')  # Optional field with default

    # ... actual backtest logic here ...

    # Type-safe result construction
    summary: BaselineBacktestSummary = {
        'alerts_total': 100,
        'alerts_ok': 95,
        'alerts_missing': 5,
        'median_ath_mult': 2.5,
        'p25_ath_mult': 1.8,
        'p75_ath_mult': 3.2,
        'p95_ath_mult': 5.0,
        'pct_hit_2x': 75.0,
        'pct_hit_3x': 50.0,
        'pct_hit_4x': 25.0,
        'pct_hit_5x': 10.0,
        'pct_hit_10x': 2.0,
        'median_time_to_recovery_s': 300.0,
        'median_time_to_2x_s': 600.0,
        'median_time_to_3x_s': 1200.0,
        'median_time_to_ath_s': 1800.0,
        'median_time_to_dd_pre2x_s': 150.0,
        'median_time_to_dd_after_2x_s': 300.0,
        'median_dd_initial': -15.0,
        'median_dd_overall': -25.0,
        'median_dd_pre2x_or_horizon': -20.0,
        'median_peak_pnl_pct': 150.0,
    }

    result: BaselineBacktestResult = {
        'success': True,
        'run_id': 'test-run-123',
        'stored': False,
        'out_alerts': '/path/to/alerts.parquet',
        'out_callers': '/path/to/callers.parquet',
        'summary': summary,
        'callers_count': 10,
    }

    return result


def main() -> None:
    """Main entry point."""
    # Parse config from stdin or args
    if len(sys.argv) > 1:
        config_json = sys.argv[1]
    else:
        config_json = sys.stdin.read()

    config = cast(BaselineBacktestConfig, json.loads(config_json))

    # Run backtest (type-checked!)
    result = run_baseline(config)

    # Output JSON (type-checked!)
    print(json.dumps(result))


if __name__ == '__main__':
    main()


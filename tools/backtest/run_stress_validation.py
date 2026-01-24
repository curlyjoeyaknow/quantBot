#!/usr/bin/env python3
"""
Stress Validation Runner

Runs TP/SL backtest for a champion across stress lanes and rolling windows.
Called from TypeScript Phase 3 implementation.
"""

import sys
import json
from pathlib import Path
from typing import Dict, Any, List

# Add tools/backtest to path
sys.path.insert(0, str(Path(__file__).parent))

from lib.tp_sl_query import run_tp_sl_query, summarize_tp_sl
from lib.alerts import load_alerts
from lib.helpers import parse_yyyy_mm_dd, is_hive_partitioned


def run_stress_lane_backtest(
    alerts: List[Dict[str, Any]],
    slice_path: str,
    interval_seconds: int,
    horizon_hours: int,
    tp_mult: float,
    sl_mult: float,
    fee_bps: float,
    slippage_bps: float,
    entry_delay_candles: int,
    stop_gap_prob: float,
    stop_gap_mult: float,
    risk_per_trade: float = 0.02,
    discovery_score: float = 0.0,
) -> Dict[str, Any]:
    """
    Run backtest for a stress lane.
    
    Returns:
        {
            "test_r": float,
            "ratio": float,
            "passes_gates": bool,
            "summary": dict
        }
    """
    from lib.alerts import Alert
    
    # Convert alert dicts to Alert objects
    alert_objects = [
        Alert(
            call_id=a["call_id"],
            caller=a["caller"],
            mint=a["mint"],
            ts=a["ts"],
            chain=a.get("chain", "solana"),
        )
        for a in alerts
    ]
    
    slice_path_obj = Path(slice_path)
    is_partitioned = is_hive_partitioned(slice_path_obj) or (
        slice_path_obj.is_dir() and not slice_path_obj.suffix
    )
    
    # Run TP/SL query
    rows = run_tp_sl_query(
        alerts=alert_objects,
        slice_path=slice_path_obj,
        is_partitioned=is_partitioned,
        interval_seconds=interval_seconds,
        horizon_hours=horizon_hours,
        tp_mult=tp_mult,
        sl_mult=sl_mult,
        intrabar_order="sl_first",
        fee_bps=fee_bps,
        slippage_bps=slippage_bps,
        entry_delay_candles=entry_delay_candles,
        threads=8,
        verbose=False,
    )
    
    # Summarize results
    summary = summarize_tp_sl(rows, sl_mult=sl_mult, risk_per_trade=risk_per_trade)
    
    test_r = summary.get("total_r", 0.0)
    train_r = discovery_score
    ratio = test_r / train_r if abs(train_r) > 0.01 else 1.0
    
    # Apply stop gap penalty analytically
    if stop_gap_prob > 0.15:
        n_trades = summary.get("alerts_ok", 0)
        win_rate = summary.get("tp_sl_win_rate", 0.5)
        avg_r_loss = summary.get("avg_r_loss", -1.0)
        n_losses = int(n_trades * (1.0 - win_rate))
        n_gapped = int(n_losses * stop_gap_prob)
        extra_loss = abs(avg_r_loss) * (stop_gap_mult - 1.0) * n_gapped
        test_r -= extra_loss
    
    passes_gates = test_r >= 0 and ratio >= 0.20
    
    return {
        "test_r": test_r,
        "ratio": ratio,
        "passes_gates": passes_gates,
        "summary": summary,
    }


def main():
    """Main entry point - expects JSON config on stdin"""
    try:
        # Read config from stdin
        stdin_input = sys.stdin.read()
        if not stdin_input:
            print(json.dumps({"error": "Missing config JSON"}))
            sys.exit(1)
        
        config = json.loads(stdin_input)
        
        result = run_stress_lane_backtest(
            alerts=config["alerts"],
            slice_path=config["slice_path"],
            interval_seconds=config.get("interval_seconds", 60),
            horizon_hours=config.get("horizon_hours", 48),
            tp_mult=config["tp_mult"],
            sl_mult=config["sl_mult"],
            fee_bps=config["fee_bps"],
            slippage_bps=config["slippage_bps"],
            entry_delay_candles=config.get("entry_delay_candles", 0),
            stop_gap_prob=config.get("stop_gap_prob", 0.0),
            stop_gap_mult=config.get("stop_gap_mult", 1.0),
            risk_per_trade=config.get("risk_per_trade", 0.02),
            discovery_score=config.get("discovery_score", 0.0),
        )
        
        print(json.dumps(result))
    except Exception as e:
        print(json.dumps({"error": str(e)}))
        sys.exit(1)


if __name__ == "__main__":
    main()


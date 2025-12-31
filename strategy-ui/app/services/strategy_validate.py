from __future__ import annotations

from typing import Any, Dict, List

def validate_strategy(strategy: Dict[str, Any]) -> None:
    # Minimal structural checks
    for k in ("entry", "exits", "stops", "execution"):
        if k not in strategy:
            raise ValueError(f"strategy missing '{k}'")

    exits = strategy["exits"] or {}
    stops = strategy["stops"] or {}

    targets = exits.get("targets") or []
    if not isinstance(targets, list):
        raise ValueError("exits.targets must be a list")

    size_sum = 0.0
    for t in targets:
        sp = float(t.get("size_pct", 0))
        pp = float(t.get("profit_pct", 0))
        if sp <= 0 or sp > 100:
            raise ValueError("each target.size_pct must be in (0,100]")
        if pp <= 0:
            raise ValueError("each target.profit_pct must be > 0")
        size_sum += sp
    if size_sum > 100.0 + 1e-9:
        raise ValueError("targets size_pct sum must be <= 100")

    trailing = exits.get("trailing") or {}
    trailing_enabled = bool(trailing.get("enabled", False))
    if trailing_enabled:
        trail_pct = float(trailing.get("trail_pct", 0))
        act = float(trailing.get("activate_profit_pct", 0))
        if trail_pct <= 0:
            raise ValueError("trailing.trail_pct must be > 0 when enabled")
        if act < 0:
            raise ValueError("trailing.activate_profit_pct must be >= 0")

    time_exit = exits.get("time_exit") or {}
    time_enabled = bool(time_exit.get("enabled", False))
    if time_enabled:
        mx = int(time_exit.get("max_candles_in_trade", 0))
        if mx <= 0:
            raise ValueError("time_exit.max_candles_in_trade must be > 0 when enabled")

    stop_loss_pct = float(stops.get("stop_loss_pct", 0) or 0)
    if stop_loss_pct < 0:
        raise ValueError("stops.stop_loss_pct must be >= 0")

    # Require at least one exit path:
    has_exit = (len(targets) > 0) or trailing_enabled or time_enabled or (stop_loss_pct > 0)
    if not has_exit:
        raise ValueError("strategy must define at least one exit path (targets/trailing/time/stop)")

    execution = strategy["execution"] or {}
    fill_model = execution.get("fill_model")
    if fill_model not in ("open", "close"):
        raise ValueError("execution.fill_model must be 'open' or 'close'")

    fee_bps = float(execution.get("fee_bps", 0) or 0)
    slippage_bps = float(execution.get("slippage_bps", 0) or 0)
    if fee_bps < 0 or slippage_bps < 0:
        raise ValueError("fee_bps and slippage_bps must be >= 0")


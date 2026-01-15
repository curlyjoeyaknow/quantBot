"""
Overlay Simulator - Python implementation

Simulates trading with overlay-based exit strategies (take_profit, stop_loss, trailing_stop, time_exit).

This is the Python equivalent of TypeScript's runOverlaySimulation().
"""

from __future__ import annotations

import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Literal, Optional, Union

# Type aliases
ExitOverlayKind = Literal["time_exit", "stop_loss", "take_profit", "trailing_stop", "combo"]


@dataclass(frozen=True)
class TradePoint:
    """Trade point (entry or exit)."""
    ts_ms: int
    px: float


@dataclass(frozen=True)
class ExitOverlay:
    """Exit overlay strategy."""
    kind: ExitOverlayKind
    hold_ms: Optional[int] = None  # For time_exit
    stop_pct: Optional[float] = None  # For stop_loss
    take_pct: Optional[float] = None  # For take_profit
    trail_pct: Optional[float] = None  # For trailing_stop
    legs: Optional[List[Dict[str, Any]]] = None  # For combo


@dataclass(frozen=True)
class FeeModel:
    """Fee model."""
    taker_fee_bps: float
    slippage_bps: float


@dataclass(frozen=True)
class PositionModel:
    """Position model."""
    notional_usd: float


@dataclass(frozen=True)
class PnlBreakdown:
    """PnL breakdown."""
    gross_return_pct: float
    net_return_pct: float
    fees_usd: float
    slippage_usd: float


@dataclass(frozen=True)
class SimulationDiagnostics:
    """Simulation diagnostics."""
    candles_used: int
    tradeable: bool
    skipped_reason: Optional[str] = None


@dataclass(frozen=True)
class OverlaySimulationResult:
    """Overlay simulation result."""
    overlay: Dict[str, Any]
    entry: TradePoint
    exit: TradePoint
    exit_reason: str
    pnl: PnlBreakdown
    diagnostics: SimulationDiagnostics


@dataclass
class Candle:
    """OHLCV candle."""
    timestamp: float  # Seconds
    open: float
    high: float
    low: float
    close: float
    volume: float


def simulate_overlay(
    candles: List[Dict[str, Any]],
    entry: Dict[str, Any],
    overlay: Dict[str, Any],
    fees: Dict[str, Any],
    position: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Simulate a single overlay strategy.
    
    Args:
        candles: List of candle dicts with timestamp (seconds), open, high, low, close, volume
        entry: Entry point dict with ts_ms (milliseconds) and px (price)
        overlay: Overlay dict with kind and parameters
        fees: Fee model dict with taker_fee_bps and slippage_bps
        position: Position model dict with notional_usd
    
    Returns:
        OverlaySimulationResult as dict
    """
    if not candles:
        return _create_empty_result(entry, overlay, "no_candles")
    
    # Convert candles to Candle objects
    candle_objs = [
        Candle(
            timestamp=c["timestamp"],
            open=c["open"],
            high=c["high"],
            low=c["low"],
            close=c["close"],
            volume=c.get("volume", 0.0),
        )
        for c in candles
    ]
    
    entry_point = TradePoint(ts_ms=int(entry["ts_ms"]), px=float(entry["px"]))
    overlay_kind = overlay["kind"]
    
    # Find entry candle index
    entry_idx = -1
    for i, candle in enumerate(candle_objs):
        ts_ms = int(candle.timestamp * 1000)
        if ts_ms >= entry_point.ts_ms:
            entry_idx = i
            break
    
    if entry_idx == -1:
        entry_idx = 0  # Use first candle if no match
    
    if entry_idx >= len(candle_objs):
        return _create_empty_result(entry, overlay, "no_entry_candle")
    
    # Execute based on overlay kind
    if overlay_kind == "take_profit":
        return _simulate_take_profit(
            candle_objs, entry_idx, entry_point, overlay, fees, position
        )
    elif overlay_kind == "stop_loss":
        return _simulate_stop_loss(
            candle_objs, entry_idx, entry_point, overlay, fees, position
        )
    elif overlay_kind == "trailing_stop":
        return _simulate_trailing_stop(
            candle_objs, entry_idx, entry_point, overlay, fees, position
        )
    elif overlay_kind == "time_exit":
        return _simulate_time_exit(
            candle_objs, entry_idx, entry_point, overlay, fees, position
        )
    elif overlay_kind == "combo":
        return _simulate_combo(
            candle_objs, entry_idx, entry_point, overlay, fees, position
        )
    else:
        return _create_empty_result(entry, overlay, f"unknown_overlay_kind: {overlay_kind}")


def _simulate_take_profit(
    candles: List[Candle],
    entry_idx: int,
    entry: TradePoint,
    overlay: Dict[str, Any],
    fees: Dict[str, Any],
    position: Dict[str, Any],
) -> Dict[str, Any]:
    """Simulate take profit overlay."""
    take_pct = overlay.get("take_pct", 100.0)
    target_mult = 1.0 + (take_pct / 100.0)  # e.g., 100% = 2x
    
    entry_px = entry.px
    target_price = entry_px * target_mult
    
    # Scan candles for TP hit
    for i in range(entry_idx, len(candles)):
        candle = candles[i]
        ts_ms = int(candle.timestamp * 1000)
        
        if candle.high >= target_price:
            # TP hit
            exit_point = TradePoint(ts_ms=ts_ms, px=target_price)
            return _create_result(entry, exit_point, "take_profit", overlay, fees, position, len(candles))
    
    # No TP hit - use last candle
    last_candle = candles[-1]
    exit_point = TradePoint(ts_ms=int(last_candle.timestamp * 1000), px=last_candle.close)
    return _create_result(entry, exit_point, "time_exit", overlay, fees, position, len(candles))


def _simulate_stop_loss(
    candles: List[Candle],
    entry_idx: int,
    entry: TradePoint,
    overlay: Dict[str, Any],
    fees: Dict[str, Any],
    position: Dict[str, Any],
) -> Dict[str, Any]:
    """Simulate stop loss overlay."""
    stop_pct = overlay.get("stop_pct", 20.0)
    stop_mult = 1.0 - (stop_pct / 100.0)  # e.g., 20% = 0.8x
    
    entry_px = entry.px
    stop_price = entry_px * stop_mult
    
    # Scan candles for SL hit
    for i in range(entry_idx, len(candles)):
        candle = candles[i]
        ts_ms = int(candle.timestamp * 1000)
        
        if candle.low <= stop_price:
            # SL hit
            exit_point = TradePoint(ts_ms=ts_ms, px=stop_price)
            return _create_result(entry, exit_point, "stop_loss", overlay, fees, position, len(candles))
    
    # No SL hit - use last candle
    last_candle = candles[-1]
    exit_point = TradePoint(ts_ms=int(last_candle.timestamp * 1000), px=last_candle.close)
    return _create_result(entry, exit_point, "time_exit", overlay, fees, position, len(candles))


def _simulate_trailing_stop(
    candles: List[Candle],
    entry_idx: int,
    entry: TradePoint,
    overlay: Dict[str, Any],
    fees: Dict[str, Any],
    position: Dict[str, Any],
) -> Dict[str, Any]:
    """Simulate trailing stop overlay."""
    trail_pct = overlay.get("trail_pct", 10.0)
    
    entry_px = entry.px
    peak_price = entry_px
    trailing_stop_price = entry_px * (1.0 - trail_pct / 100.0)
    
    # Scan candles
    for i in range(entry_idx, len(candles)):
        candle = candles[i]
        ts_ms = int(candle.timestamp * 1000)
        
        # Update peak
        if candle.high > peak_price:
            peak_price = candle.high
            trailing_stop_price = peak_price * (1.0 - trail_pct / 100.0)
        
        # Check trailing stop hit
        if candle.low <= trailing_stop_price:
            exit_point = TradePoint(ts_ms=ts_ms, px=trailing_stop_price)
            return _create_result(entry, exit_point, "trailing_stop", overlay, fees, position, len(candles))
    
    # No trailing stop hit - use last candle
    last_candle = candles[-1]
    exit_point = TradePoint(ts_ms=int(last_candle.timestamp * 1000), px=last_candle.close)
    return _create_result(entry, exit_point, "time_exit", overlay, fees, position, len(candles))


def _simulate_time_exit(
    candles: List[Candle],
    entry_idx: int,
    entry: TradePoint,
    overlay: Dict[str, Any],
    fees: Dict[str, Any],
    position: Dict[str, Any],
) -> Dict[str, Any]:
    """Simulate time-based exit overlay."""
    hold_ms = overlay.get("hold_ms", 48 * 60 * 60 * 1000)  # Default 48 hours
    exit_ts_ms = entry.ts_ms + hold_ms
    
    # Find exit candle
    exit_idx = entry_idx
    for i in range(entry_idx, len(candles)):
        candle = candles[i]
        ts_ms = int(candle.timestamp * 1000)
        if ts_ms >= exit_ts_ms:
            exit_idx = i
            break
    
    if exit_idx >= len(candles):
        exit_idx = len(candles) - 1
    
    exit_candle = candles[exit_idx]
    exit_point = TradePoint(ts_ms=int(exit_candle.timestamp * 1000), px=exit_candle.close)
    return _create_result(entry, exit_point, "time_exit", overlay, fees, position, len(candles))


def _simulate_combo(
    candles: List[Candle],
    entry_idx: int,
    entry: TradePoint,
    overlay: Dict[str, Any],
    fees: Dict[str, Any],
    position: Dict[str, Any],
) -> Dict[str, Any]:
    """Simulate combo overlay (multiple exit conditions)."""
    legs = overlay.get("legs", [])
    if not legs:
        return _create_empty_result(entry, overlay, "combo_no_legs")
    
    # Find earliest exit across all legs
    earliest_exit: Optional[Dict[str, Any]] = None
    
    for leg in legs:
        leg_result = simulate_overlay(candles, {"ts_ms": entry.ts_ms, "px": entry.px}, leg, fees, position)
        
        if leg_result["diagnostics"]["tradeable"]:
            exit_ts_ms = leg_result["exit"]["ts_ms"]
            if earliest_exit is None or exit_ts_ms < earliest_exit["exit"]["ts_ms"]:
                earliest_exit = leg_result
    
    if earliest_exit:
        return earliest_exit
    
    # No valid exit - use last candle
    last_candle = candles[-1]
    exit_point = TradePoint(ts_ms=int(last_candle.timestamp * 1000), px=last_candle.close)
    return _create_result(entry, exit_point, "time_exit", overlay, fees, position, len(candles))


def _create_result(
    entry: TradePoint,
    exit: TradePoint,
    exit_reason: str,
    overlay: Dict[str, Any],
    fees: Dict[str, Any],
    position: Dict[str, Any],
    candles_used: int,
) -> Dict[str, Any]:
    """Create simulation result."""
    # Calculate return
    return_mult = exit.px / entry.px
    gross_return_pct = (return_mult - 1.0) * 100.0
    
    # Calculate fees
    notional_usd = position.get("notional_usd", 1000.0)
    taker_fee_bps = fees.get("taker_fee_bps", 30.0)
    slippage_bps = fees.get("slippage_bps", 10.0)
    
    entry_fee_usd = (notional_usd * taker_fee_bps) / 10000.0
    exit_fee_usd = (notional_usd * taker_fee_bps) / 10000.0
    entry_slippage_usd = (notional_usd * slippage_bps) / 10000.0
    exit_slippage_usd = (notional_usd * slippage_bps) / 10000.0
    
    total_fees_usd = entry_fee_usd + exit_fee_usd
    total_slippage_usd = entry_slippage_usd + exit_slippage_usd
    
    # Net return (after fees and slippage)
    cost_pct = ((total_fees_usd + total_slippage_usd) / notional_usd) * 100.0
    net_return_pct = gross_return_pct - cost_pct
    
    return {
        "overlay": overlay,
        "entry": {"ts_ms": entry.ts_ms, "px": entry.px},
        "exit": {"ts_ms": exit.ts_ms, "px": exit.px},
        "exit_reason": exit_reason,
        "pnl": {
            "gross_return_pct": gross_return_pct,
            "net_return_pct": net_return_pct,
            "fees_usd": total_fees_usd,
            "slippage_usd": total_slippage_usd,
        },
        "diagnostics": {
            "candles_used": candles_used,
            "tradeable": True,
        },
    }


def _create_empty_result(
    entry: Dict[str, Any],
    overlay: Dict[str, Any],
    reason: str,
) -> Dict[str, Any]:
    """Create empty result for error cases."""
    entry_point = TradePoint(ts_ms=int(entry["ts_ms"]), px=float(entry["px"]))
    return {
        "overlay": overlay,
        "entry": {"ts_ms": entry_point.ts_ms, "px": entry_point.px},
        "exit": {"ts_ms": entry_point.ts_ms, "px": entry_point.px},
        "exit_reason": reason,
        "pnl": {
            "gross_return_pct": 0.0,
            "net_return_pct": 0.0,
            "fees_usd": 0.0,
            "slippage_usd": 0.0,
        },
        "diagnostics": {
            "candles_used": 0,
            "tradeable": False,
            "skipped_reason": reason,
        },
    }


def main_stdin() -> None:
    """Main entry point for stdin-based operation (called by TypeScript)."""
    import json
    
    try:
        input_data = json.load(sys.stdin)
        operation = input_data.get("operation")
        
        if operation == "simulate_overlay":
            candles = input_data["candles"]
            entry = input_data["entry"]
            overlay = input_data["overlay"]
            fees = input_data["fees"]
            position = input_data["position"]
            
            result = simulate_overlay(candles, entry, overlay, fees, position)
            json.dump(result, sys.stdout)
        elif operation == "simulate_overlays":
            # Batch simulation for multiple overlays
            candles = input_data["candles"]
            entry = input_data["entry"]
            overlays = input_data["overlays"]
            fees = input_data["fees"]
            position = input_data["position"]
            
            results = []
            for overlay in overlays:
                result = simulate_overlay(candles, entry, overlay, fees, position)
                results.append(result)
            
            json.dump(results, sys.stdout)
        else:
            raise ValueError(f"Unknown operation: {operation}")
    except Exception as e:
        import traceback
        error_output = {
            "error": str(e),
            "traceback": traceback.format_exc(),
        }
        json.dump(error_output, sys.stdout)
        sys.exit(1)


if __name__ == "__main__":
    main_stdin()


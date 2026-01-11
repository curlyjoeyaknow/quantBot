"""
V1 Baseline Capital-Aware Simulator

Simulates trading with finite capital, position constraints, and path-dependent capital management.

Key features:
- Initial capital: C₀ = 10,000
- Capital is finite and path-dependent
- Capital tied in open positions is unavailable
- Max allocation per trade: 4% of free cash
- Max risk per trade: $200
- Max concurrent positions: 25
- Position sizing: min(size_risk, size_alloc, free_cash)
- Trade lifecycle: TP at tp_mult, SL at sl_mult, Time exit at 48h
- Objective: maximize final capital (C_final)
"""

from __future__ import annotations

import sys
from dataclasses import dataclass, field
from typing import Any, Dict, List, Literal, Optional

# Type aliases
ExitReason = Literal["take_profit", "stop_loss", "time_exit", "no_entry", "insufficient_capital"]


@dataclass(frozen=True)
class V1BaselineParams:
    """V1 Baseline optimizer parameters."""
    
    tp_mult: float  # Take-profit multiple (e.g., 2.0 = 2x)
    sl_mult: float  # Stop-loss multiple (e.g., 0.85 = -15%)
    max_hold_hrs: Optional[float] = None  # Optional max hold hours (≤ 48, defaults to 48)


@dataclass
class Position:
    """Position in the simulation."""
    
    call_id: str
    mint: str
    caller: str
    entry_ts_ms: int
    entry_px: float
    size: float
    tp_price: float
    sl_price: float
    max_hold_ts_ms: int


@dataclass
class TradeExecution:
    """Trade execution result."""
    
    call_id: str
    entry_ts_ms: int
    exit_ts_ms: int
    entry_px: float
    exit_px: float
    size: float
    pnl: float
    exit_reason: ExitReason
    exit_mult: float


@dataclass
class CapitalState:
    """Capital state during simulation."""
    
    initial_capital: float
    free_cash: float
    total_capital: float
    positions: Dict[str, Position] = field(default_factory=dict)
    completed_trades: List[TradeExecution] = field(default_factory=list)


@dataclass
class CapitalSimulationResult:
    """Capital simulation result."""
    
    final_capital: float
    total_return: float  # As decimal (e.g., 0.25 = 25%)
    trades_executed: int
    trades_skipped: int
    completed_trades: List[TradeExecution]
    final_state: CapitalState


@dataclass
class CapitalSimulatorConfig:
    """Configuration for capital simulator."""
    
    initial_capital: float = 10_000
    max_allocation_pct: float = 0.04  # 4% max per trade
    max_risk_per_trade: float = 200  # $200 max risk
    max_concurrent_positions: int = 25
    max_trade_horizon_hrs: float = 48
    min_executable_size: float = 10  # $10 minimum
    taker_fee_bps: float = 30
    slippage_bps: float = 10


# =============================================================================
# Helper Functions
# =============================================================================

def calculate_position_size(
    sl_mult: float,
    max_risk_per_trade: float,
    max_allocation_pct: float,
    free_cash: float,
) -> float:
    """
    Calculate position size based on risk and allocation constraints.
    
    size_risk = max_risk / sl_frac
    size_alloc = max_alloc_pct * free_cash
    size = min(size_risk, size_alloc, free_cash)
    """
    sl_frac = 1 - sl_mult  # e.g., 0.85 -> 0.15 = 15% loss
    size_risk = max_risk_per_trade / sl_frac
    size_alloc = max_allocation_pct * free_cash
    return min(size_risk, size_alloc, free_cash)


def execute_entry(
    state: CapitalState,
    call: Dict[str, Any],
    candles: List[Dict[str, Any]],
    params: V1BaselineParams,
    position_size: float,
    max_hold_hrs: float,
    current_time: int,
    config: CapitalSimulatorConfig,
) -> Optional[Dict[str, Any]]:
    """
    Execute entry for an alert.
    
    Returns dict with 'position' and 'estimated_exit_time' or None if entry fails.
    """
    # Find entry candle (first candle at/after alert time)
    alert_ts_ms = call["ts_ms"]
    entry_idx = -1
    
    for i, candle in enumerate(candles):
        ts_ms = candle["timestamp"] * 1000 if isinstance(candle["timestamp"], (int, float)) else int(candle["timestamp"].timestamp() * 1000)
        if ts_ms >= alert_ts_ms:
            entry_idx = i
            break
    
    if entry_idx == -1 or entry_idx >= len(candles):
        return None
    
    entry_candle = candles[entry_idx]
    entry_ts_ms = entry_candle["timestamp"] * 1000 if isinstance(entry_candle["timestamp"], (int, float)) else int(entry_candle["timestamp"].timestamp() * 1000)
    entry_px = entry_candle["close"]
    
    if not (entry_px > 0 and entry_px != float('inf') and entry_px != float('-inf')):
        return None
    
    # Deduct position size from free cash
    state.free_cash -= position_size
    
    # Calculate TP/SL prices
    tp_price = entry_px * params.tp_mult
    sl_price = entry_px * params.sl_mult
    max_hold_ts_ms = entry_ts_ms + int(max_hold_hrs * 60 * 60 * 1000)
    
    position = Position(
        call_id=call["id"],
        mint=call["mint"],
        caller=call["caller"],
        entry_ts_ms=entry_ts_ms,
        entry_px=entry_px,
        size=position_size,
        tp_price=tp_price,
        sl_price=sl_price,
        max_hold_ts_ms=max_hold_ts_ms,
    )
    
    # Estimate exit time (use max hold as conservative estimate)
    estimated_exit_time = max_hold_ts_ms
    
    return {"position": position, "estimated_exit_time": estimated_exit_time}


def find_exit_in_candles(
    candles: List[Dict[str, Any]],
    entry_ts_ms: int,
    entry_px: float,
    tp_price: float,
    sl_price: float,
    max_hold_ts_ms: int,
    max_time: int,
) -> Dict[str, Any]:
    """
    Find exit point in candle stream.
    
    Checks exits in priority order: TP, SL, Time
    Returns the first exit that occurs at or before maxTime.
    """
    # Find entry index
    entry_idx = -1
    for i, candle in enumerate(candles):
        ts_ms = candle["timestamp"] * 1000 if isinstance(candle["timestamp"], (int, float)) else int(candle["timestamp"].timestamp() * 1000)
        if ts_ms >= entry_ts_ms:
            entry_idx = i
            break
    
    if entry_idx == -1:
        entry_idx = 0
    
    # Track earliest exit
    earliest_exit: Optional[Dict[str, Any]] = None
    
    # Scan for exits (check all three conditions per candle)
    for i in range(entry_idx, len(candles)):
        c = candles[i]
        ts_ms = c["timestamp"] * 1000 if isinstance(c["timestamp"], (int, float)) else int(c["timestamp"].timestamp() * 1000)
        
        # Don't process beyond maxTime
        if ts_ms > max_time:
            break
        
        # Check take profit first (highest priority if multiple conditions met)
        if c["high"] >= tp_price and (earliest_exit is None or ts_ms < earliest_exit["exit_ts_ms"]):
            earliest_exit = {
                "exit_ts_ms": ts_ms,
                "exit_price": tp_price,
                "exit_reason": "take_profit",
            }
        
        # Check stop loss
        if c["low"] <= sl_price and (earliest_exit is None or ts_ms < earliest_exit["exit_ts_ms"]):
            earliest_exit = {
                "exit_ts_ms": ts_ms,
                "exit_price": sl_price,
                "exit_reason": "stop_loss",
            }
        
        # Check time exit (only if we haven't found an earlier exit)
        if ts_ms >= max_hold_ts_ms and (earliest_exit is None or ts_ms < earliest_exit["exit_ts_ms"]):
            earliest_exit = {
                "exit_ts_ms": ts_ms,
                "exit_price": c["close"],
                "exit_reason": "time_exit",
            }
    
    # If we found an exit, return it
    if earliest_exit:
        return earliest_exit
    
    # No exit found in available candles - use last candle or maxTime
    last_candle = candles[-1]
    last_ts_ms = last_candle["timestamp"] * 1000 if isinstance(last_candle["timestamp"], (int, float)) else int(last_candle["timestamp"].timestamp() * 1000)
    
    if last_ts_ms < max_time:
        # Last candle is before maxTime, use it as time exit
        return {
            "exit_ts_ms": last_ts_ms,
            "exit_price": last_candle["close"],
            "exit_reason": "time_exit",
        }
    
    # Use maxTime as time exit
    return {
        "exit_ts_ms": max_time,
        "exit_price": last_candle["close"],  # Use last known price
        "exit_reason": "time_exit",
    }


def execute_exit(
    state: CapitalState,
    position: Position,
    exit_price: float,
    exit_reason: ExitReason,
    exit_ts_ms: int,
    config: CapitalSimulatorConfig,
) -> None:
    """Execute exit for a position."""
    # Calculate exit multiple
    exit_mult = exit_price / position.entry_px
    
    # Calculate PnL: pnl = size * (exit_mult - 1)
    gross_pnl = position.size * (exit_mult - 1)
    
    # Apply fees
    total_fee_bps = config.taker_fee_bps + config.slippage_bps
    fee_amount = ((position.size * total_fee_bps) / 10000) * 2  # Entry + exit
    net_pnl = gross_pnl - fee_amount
    
    # Update capital: free_cash += size + pnl
    state.free_cash += position.size + net_pnl
    
    # Calculate unrealized PnL from remaining positions for total capital
    unrealized_pnl = 0.0
    for pos in state.positions.values():
        # For remaining positions, estimate current value at entry price (conservative)
        unrealized_pnl += pos.size * (1 - 1)  # For now, assume no unrealized PnL until exit
    
    state.total_capital = state.free_cash + unrealized_pnl
    
    # Record trade
    trade = TradeExecution(
        call_id=position.call_id,
        entry_ts_ms=position.entry_ts_ms,
        exit_ts_ms=exit_ts_ms,
        entry_px=position.entry_px,
        exit_px=exit_price,
        size=position.size,
        pnl=net_pnl,
        exit_reason=exit_reason,
        exit_mult=exit_mult,
    )
    
    state.completed_trades.append(trade)


def check_and_execute_exits(
    state: CapitalState,
    candles_by_call_id: Dict[str, List[Dict[str, Any]]],
    current_time: int,
    config: CapitalSimulatorConfig,
) -> None:
    """Check and execute exits for positions that should exit at or before currentTime."""
    positions_to_exit: List[Dict[str, Any]] = []
    
    for call_id, position in state.positions.items():
        candles = candles_by_call_id.get(call_id)
        if not candles or len(candles) == 0:
            continue
        
        # Find exit point up to current time
        exit_result = find_exit_in_candles(
            candles,
            position.entry_ts_ms,
            position.entry_px,
            position.tp_price,
            position.sl_price,
            position.max_hold_ts_ms,
            current_time,
        )
        
        # Check if exit should have occurred before currentTime
        if exit_result["exit_ts_ms"] <= current_time:
            positions_to_exit.append({"position": position, "exit_result": exit_result})
    
    # Sort exits by timestamp to process in order
    positions_to_exit.sort(key=lambda x: x["exit_result"]["exit_ts_ms"])
    
    # Execute exits
    for item in positions_to_exit:
        position = item["position"]
        exit_result = item["exit_result"]
        execute_exit(
            state,
            position,
            exit_result["exit_price"],
            exit_result["exit_reason"],
            exit_result["exit_ts_ms"],
            config,
        )
        del state.positions[position.call_id]


# =============================================================================
# Main Simulator
# =============================================================================

def simulate_capital_aware(
    calls: List[Dict[str, Any]],
    candles_by_call_id: Dict[str, List[Dict[str, Any]]],
    params: V1BaselineParams,
    config: Optional[CapitalSimulatorConfig] = None,
) -> CapitalSimulationResult:
    """
    Simulate capital-aware trading over a sequence of alerts.
    
    Processes alerts in timestamp order and executes trades with position constraints.
    
    Args:
        calls: List of call dicts with keys: id, mint, caller, ts_ms
        candles_by_call_id: Dict mapping call_id to list of candle dicts
        params: V1 baseline parameters (tp_mult, sl_mult, max_hold_hrs)
        config: Optional simulator configuration
    
    Returns:
        CapitalSimulationResult with final capital, trades, etc.
    """
    cfg = config or CapitalSimulatorConfig()
    max_hold_hrs = params.max_hold_hrs if params.max_hold_hrs is not None else cfg.max_trade_horizon_hrs
    
    # Sort calls by timestamp
    sorted_calls = sorted(calls, key=lambda c: c["ts_ms"])
    
    # Initialize capital state
    state = CapitalState(
        initial_capital=cfg.initial_capital,
        free_cash=cfg.initial_capital,
        total_capital=cfg.initial_capital,
        positions={},
        completed_trades=[],
    )
    
    # Process alerts in timestamp order
    for call in sorted_calls:
        alert_ts_ms = call["ts_ms"]
        
        # First, check for any positions that should exit before this alert
        check_and_execute_exits(state, candles_by_call_id, alert_ts_ms, cfg)
        
        # Check if we can take a new position
        if len(state.positions) >= cfg.max_concurrent_positions:
            continue  # Skip - max positions reached
        
        candles = candles_by_call_id.get(call["id"])
        if not candles or len(candles) == 0:
            continue
        
        # Calculate position size
        position_size = calculate_position_size(
            params.sl_mult,
            cfg.max_risk_per_trade,
            cfg.max_allocation_pct,
            state.free_cash,
        )
        
        # Check minimum executable size
        if position_size < cfg.min_executable_size:
            continue  # Skip - size too small
        
        # Check if we have enough capital
        if position_size > state.free_cash:
            continue  # Skip - insufficient capital
        
        # Execute entry
        entry_result = execute_entry(
            state,
            call,
            candles,
            params,
            position_size,
            max_hold_hrs,
            alert_ts_ms,
            cfg,
        )
        
        if entry_result:
            state.positions[call["id"]] = entry_result["position"]
    
    # Process remaining open positions at end
    # Use a large timestamp to force all exits
    check_and_execute_exits(state, candles_by_call_id, sys.maxsize, cfg)
    
    # Final capital update (all positions should be closed now)
    state.total_capital = state.free_cash
    
    # Calculate final metrics
    total_return = (state.total_capital - cfg.initial_capital) / cfg.initial_capital
    trades_executed = sum(
        1 for t in state.completed_trades
        if t.exit_reason not in ("no_entry", "insufficient_capital")
    )
    trades_skipped = sum(
        1 for t in state.completed_trades
        if t.exit_reason == "insufficient_capital"
    )
    
    return CapitalSimulationResult(
        final_capital=state.total_capital,
        total_return=total_return,
        trades_executed=trades_executed,
        trades_skipped=trades_skipped,
        completed_trades=state.completed_trades,
        final_state=state,
    )


# =============================================================================
# CLI / Stdin Wrapper (for TypeScript integration)
# =============================================================================

def main_stdin() -> None:
    """
    Main entry point for stdin-based operation (called by TypeScript).
    
    Reads JSON from stdin, executes operation, writes JSON to stdout.
    """
    import json
    import sys
    
    try:
        # Read input from stdin
        input_data = json.load(sys.stdin)
        operation = input_data.get("operation")
        
        if operation == "simulate":
            # Extract config
            calls = input_data["calls"]
            candles_by_call_id = input_data["candles_by_call_id"]
            params_dict = input_data["params"]
            config_dict = input_data.get("config")
            
            # Build params
            params = V1BaselineParams(
                tp_mult=params_dict["tp_mult"],
                sl_mult=params_dict["sl_mult"],
                max_hold_hrs=params_dict.get("max_hold_hrs"),
            )
            
            # Build config
            config = None
            if config_dict:
                config = CapitalSimulatorConfig(**config_dict)
            
            # Run simulation
            result = simulate_capital_aware(calls, candles_by_call_id, params, config)
            
            # Convert to dict for JSON serialization
            output = {
                "final_capital": result.final_capital,
                "total_return": result.total_return,
                "trades_executed": result.trades_executed,
                "trades_skipped": result.trades_skipped,
                "completed_trades": [
                    {
                        "call_id": t.call_id,
                        "entry_ts_ms": t.entry_ts_ms,
                        "exit_ts_ms": t.exit_ts_ms,
                        "entry_px": t.entry_px,
                        "exit_px": t.exit_px,
                        "size": t.size,
                        "pnl": t.pnl,
                        "exit_reason": t.exit_reason,
                        "exit_mult": t.exit_mult,
                    }
                    for t in result.completed_trades
                ],
            }
            
            json.dump(output, sys.stdout)
            
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


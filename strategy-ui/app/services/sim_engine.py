from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
from uuid import uuid4

from .sim_types import Candle, Event, Trade
from .indicators import rsi as rsi_series, ema as ema_series
from .strategy_validate import validate_strategy

def _fee_slip_mult_buy(fee_bps: float, slip_bps: float) -> float:
    return 1.0 + (fee_bps + slip_bps) / 10000.0

def _fee_slip_mult_sell(fee_bps: float, slip_bps: float) -> float:
    return 1.0 - (fee_bps + slip_bps) / 10000.0

def _decision_price(c: Candle, fill_model: str) -> float:
    return c.c if fill_model == "close" else c.o

def _entry_signal(strategy: Dict[str, Any], closes: List[float]) -> List[bool]:
    entry = strategy["entry"] or {}
    mode = entry.get("mode", "immediate")
    n = len(closes)

    if mode == "immediate":
        return [True] * n

    if mode != "signal":
        raise ValueError(f"unsupported entry.mode: {mode}")

    sig = entry.get("signal") or {}
    stype = sig.get("type")

    if stype == "rsi_below":
        period = int(sig["period"])
        value = float(sig["value"])
        r = rsi_series(closes, period)
        out = []
        for x in r:
            out.append((x is not None) and (x < value))
        return out

    if stype == "ema_cross":
        fast = int(sig["fast"])
        slow = int(sig["slow"])
        direction = sig.get("direction", "bull")
        ef = ema_series(closes, fast)
        es = ema_series(closes, slow)
        out = [False] * n
        for i in range(1, n):
            if ef[i-1] is None or es[i-1] is None or ef[i] is None or es[i] is None:
                continue
            prev = ef[i-1] - es[i-1]
            curr = ef[i] - es[i]
            if direction == "bull":
                out[i] = (prev <= 0) and (curr > 0)
            else:
                out[i] = (prev >= 0) and (curr < 0)
        return out

    raise ValueError(f"unsupported entry.signal.type: {stype}")

def simulate_token(
    token: str,
    candles: List[Candle],
    strategy: Dict[str, Any],
) -> Tuple[Dict[str, Any], List[Trade], List[Event], List[Dict[str, Any]]]:
    """
    Returns: (summary, trades, events, frames)
    frames are replay-friendly: [{seq, candle, events, position}]
    """
    validate_strategy(strategy)

    if len(candles) == 0:
        return ({"token": token, "trades": 0}, [], [], [])

    execution = strategy["execution"]
    fill_model = execution["fill_model"]
    fee_bps = float(execution.get("fee_bps", 0))
    slip_bps = float(execution.get("slippage_bps", 0))
    buy_mult = _fee_slip_mult_buy(fee_bps, slip_bps)
    sell_mult = _fee_slip_mult_sell(fee_bps, slip_bps)

    exits = strategy["exits"] or {}
    stops = strategy["stops"] or {}

    targets = sorted(exits.get("targets") or [], key=lambda t: float(t["profit_pct"]))
    trailing = exits.get("trailing") or {}
    trailing_enabled = bool(trailing.get("enabled", False))
    trail_pct = float(trailing.get("trail_pct", 0) or 0)
    trail_activate = float(trailing.get("activate_profit_pct", 0) or 0)

    time_exit = exits.get("time_exit") or {}
    time_exit_enabled = bool(time_exit.get("enabled", False))
    max_candles_in_trade = int(time_exit.get("max_candles_in_trade", 0) or 0)

    stop_loss_pct = float(stops.get("stop_loss_pct", 0) or 0)
    be_after_first = bool(stops.get("break_even_after_first_target", False))

    closes = [c.c for c in candles]
    signal_true = _entry_signal(strategy, closes)

    delay = (strategy["entry"] or {}).get("delay") or {"mode": "none"}
    delay_mode = delay.get("mode", "none")
    delay_n = int(delay.get("n", 0) or 0) if delay_mode == "candles" else 0

    events: List[Event] = []
    trades: List[Trade] = []
    frames: List[Dict[str, Any]] = []

    # Position state (single position v1)
    in_pos = False
    entry_idx: Optional[int] = None
    entry_ts: Optional[str] = None
    entry_price: float = 0.0
    size_left: float = 0.0  # percent 0..100
    stop_price: Optional[float] = None
    trailing_active = False
    high_watermark: Optional[float] = None
    first_target_hit = False
    next_target_i = 0
    scheduled_entry_idx: Optional[int] = None

    def emit(i: int, etype: str, data: Dict[str, Any]) -> None:
        events.append(Event(ts=candles[i].ts, candle_index=i, type=etype, data=data))

    def pos_snapshot(i: int) -> Dict[str, Any]:
        if not in_pos:
            return {
                "is_open": False,
                "size_pct": 0.0,
                "avg_price": None,
                "stop_price": None,
                "unrealized_pnl_pct": None,
            }
        px = _decision_price(candles[i], fill_model)
        unrl = (px - entry_price) / entry_price * 100.0
        return {
            "is_open": True,
            "size_pct": size_left,
            "avg_price": entry_price,
            "stop_price": stop_price,
            "unrealized_pnl_pct": unrl,
        }

    for i, c in enumerate(candles):
        # --- ENTRY scheduling / triggering ---
        if not in_pos:
            if scheduled_entry_idx is None:
                if signal_true[i]:
                    emit(i, "ENTRY_SIGNAL_TRUE", {"reason": "signal_true"})
                    if delay_mode == "candles" and delay_n > 0:
                        scheduled_entry_idx = i + delay_n
                    else:
                        scheduled_entry_idx = i
            # Execute scheduled entry
            if scheduled_entry_idx is not None and i == scheduled_entry_idx and i < len(candles):
                fill = _decision_price(c, fill_model) * buy_mult
                in_pos = True
                entry_idx = i
                entry_ts = c.ts
                entry_price = fill
                size_left = 100.0
                first_target_hit = False
                next_target_i = 0
                trailing_active = False
                high_watermark = None
                stop_price = entry_price * (1.0 - stop_loss_pct / 100.0) if stop_loss_pct > 0 else None
                emit(i, "ENTRY_FILLED", {"price": fill, "size_pct": 100.0})
                if stop_price is not None:
                    emit(i, "STOP_SET", {"stop_price": stop_price})
                scheduled_entry_idx = None

        # --- if in position, process exits deterministically within candle ---
        if in_pos:
            assert entry_idx is not None and entry_ts is not None

            # Update trailing activation & watermark using candle high (h)
            # Activation: based on profit at candle high relative to entry
            profit_at_high = (c.h - entry_price) / entry_price * 100.0
            if trailing_enabled and (not trailing_active) and profit_at_high >= trail_activate:
                trailing_active = True
                high_watermark = c.h
                # initialize trail stop
                tstop = high_watermark * (1.0 - trail_pct / 100.0)
                # respect break-even move if already enabled
                if be_after_first and first_target_hit:
                    tstop = max(tstop, entry_price)
                stop_price = tstop if stop_price is None else max(stop_price, tstop)
                emit(i, "STOP_MOVED", {"stop_price": stop_price, "reason": "trailing_activated"})

            if trailing_active:
                assert high_watermark is not None
                if c.h > high_watermark:
                    high_watermark = c.h
                    tstop = high_watermark * (1.0 - trail_pct / 100.0)
                    if be_after_first and first_target_hit:
                        tstop = max(tstop, entry_price)
                    stop_price = tstop if stop_price is None else max(stop_price, tstop)
                    emit(i, "STOP_MOVED", {"stop_price": stop_price, "reason": "trail_update"})

            # --- Intra-candle ordering (conservative_long): STOP via L, then TARGETS via H, then TIME EXIT ---
            # STOP check
            stopped = False
            if stop_price is not None and c.l <= stop_price:
                # fill at stop_price (simplified), apply sell mult
                fill = stop_price * sell_mult
                emit(i, "STOP_HIT", {"stop_price": stop_price, "fill_price": fill})
                emit(i, "EXIT_FULL", {"reason": "stop"})
                # finalize trade
                pnl = (fill - entry_price) / entry_price * 100.0
                trades.append(Trade(
                    trade_id=f"trade_{uuid4().hex[:8]}",
                    token=token,
                    entry_ts=entry_ts,
                    exit_ts=c.ts,
                    entry_price=entry_price,
                    exit_price=fill,
                    pnl_pct=pnl,
                    exit_reason="stop",
                ))
                # reset position
                in_pos = False
                size_left = 0.0
                stopped = True

            # TARGETS check (only if not stopped)
            if in_pos and (next_target_i < len(targets)):
                while next_target_i < len(targets):
                    t = targets[next_target_i]
                    t_profit = float(t["profit_pct"])
                    t_size = float(t["size_pct"])
                    t_price = entry_price * (1.0 + t_profit / 100.0)

                    if c.h >= t_price and size_left > 0:
                        emit(i, "TARGET_HIT", {"target_index": next_target_i, "target_price": t_price})
                        exit_size = min(t_size, size_left)
                        fill = t_price * sell_mult
                        emit(i, "PARTIAL_EXIT", {"size_pct": exit_size, "fill_price": fill, "reason": f"target_{next_target_i}"})
                        size_left -= exit_size
                        if not first_target_hit:
                            first_target_hit = True
                            if be_after_first and stop_price is not None:
                                new_stop = max(stop_price, entry_price)
                                if new_stop != stop_price:
                                    stop_price = new_stop
                                    emit(i, "STOP_MOVED", {"stop_price": stop_price, "reason": "break_even_after_first_target"})
                        next_target_i += 1
                        continue
                    break

            # If position fully exited by targets
            if in_pos and size_left <= 0.000001:
                # treat as full exit at last target fill price approximated by decision price (could be improved)
                # We'll emit EXIT_FULL with reason targets_done
                emit(i, "EXIT_FULL", {"reason": "targets_done"})
                # choose last fill as entry_price*(1+profit of last target) * sell_mult
                last_profit = float(targets[min(len(targets)-1, max(0, next_target_i-1))]["profit_pct"]) if targets else 0.0
                fill = (entry_price * (1.0 + last_profit / 100.0)) * sell_mult
                pnl = (fill - entry_price) / entry_price * 100.0
                trades.append(Trade(
                    trade_id=f"trade_{uuid4().hex[:8]}",
                    token=token,
                    entry_ts=entry_ts,
                    exit_ts=c.ts,
                    entry_price=entry_price,
                    exit_price=fill,
                    pnl_pct=pnl,
                    exit_reason="targets_done",
                ))
                in_pos = False
                size_left = 0.0

            # TIME EXIT (end of candle)
            if in_pos and time_exit_enabled and entry_idx is not None:
                age = i - entry_idx
                if age >= max_candles_in_trade:
                    fill = _decision_price(c, fill_model) * sell_mult
                    emit(i, "EXIT_FULL", {"reason": "time_exit"})
                    pnl = (fill - entry_price) / entry_price * 100.0
                    trades.append(Trade(
                        trade_id=f"trade_{uuid4().hex[:8]}",
                        token=token,
                        entry_ts=entry_ts,
                        exit_ts=c.ts,
                        entry_price=entry_price,
                        exit_price=fill,
                        pnl_pct=pnl,
                        exit_reason="time_exit",
                    ))
                    in_pos = False
                    size_left = 0.0

        # Build replay frame for this candle
        # Collect events for this candle only
        evs_here = [e for e in events if e.candle_index == i]
        frames.append({
            "seq": i,
            "candle": {"ts": c.ts, "o": c.o, "h": c.h, "l": c.l, "c": c.c, "v": c.v},
            "events": [{"ts": e.ts, "type": e.type, "data": e.data} for e in evs_here],
            "position": pos_snapshot(i),
        })

    # End-of-data forced exit
    if in_pos:
        last_i = len(candles) - 1
        c = candles[last_i]
        fill = _decision_price(c, fill_model) * sell_mult
        emit(last_i, "EXIT_FULL", {"reason": "end_of_data"})
        pnl = (fill - entry_price) / entry_price * 100.0
        trades.append(Trade(
            trade_id=f"trade_{uuid4().hex[:8]}",
            token=token,
            entry_ts=entry_ts or candles[entry_idx or 0].ts,
            exit_ts=c.ts,
            entry_price=entry_price,
            exit_price=fill,
            pnl_pct=pnl,
            exit_reason="end_of_data",
        ))
        # also update final frame events list
        frames[last_i]["events"] = [{"ts": e.ts, "type": e.type, "data": e.data} for e in events if e.candle_index == last_i]
        frames[last_i]["position"] = {
            "is_open": False, "size_pct": 0.0, "avg_price": None, "stop_price": None, "unrealized_pnl_pct": None
        }

    # Summary
    wins = sum(1 for t in trades if t.pnl_pct > 0)
    summary = {
        "token": token,
        "trades": len(trades),
        "win_rate": (wins / len(trades)) if trades else 0.0,
        "avg_pnl_pct": (sum(t.pnl_pct for t in trades) / len(trades)) if trades else 0.0,
    }
    return summary, trades, events, frames


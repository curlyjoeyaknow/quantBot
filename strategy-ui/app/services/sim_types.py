from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Literal

EventType = Literal[
    "ENTRY_SIGNAL_TRUE",
    "ENTRY_FILLED",
    "TARGET_HIT",
    "PARTIAL_EXIT",
    "STOP_SET",
    "STOP_MOVED",
    "STOP_HIT",
    "EXIT_FULL",
    "INFO",
]

@dataclass(frozen=True)
class Candle:
    ts: str
    o: float
    h: float
    l: float
    c: float
    v: float

@dataclass
class Event:
    ts: str
    candle_index: int
    type: EventType
    data: Dict[str, Any]

@dataclass
class Trade:
    trade_id: str
    token: str
    entry_ts: str
    exit_ts: str
    entry_price: float
    exit_price: float
    pnl_pct: float
    exit_reason: str
    size_pct_initial: float = 100.0


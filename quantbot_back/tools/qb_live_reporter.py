from __future__ import annotations

import math
import time
from dataclasses import dataclass
from typing import Optional, List

def fmt_pct(x: Optional[float]) -> str:
    if x is None or math.isnan(x): return "—"
    return f"{x*100:.2f}%"

def fmt_num(x: Optional[float], d: int = 2) -> str:
    if x is None or math.isnan(x): return "—"
    return f"{x:.{d}f}"

@dataclass
class LivePortfolio:
    trades: int = 0
    wins: int = 0
    losses: int = 0
    sum_pnl: float = 0.0
    equity: float = 0.0
    peak: float = 0.0
    max_dd: float = 0.0  # negative
    wins_sum: float = 0.0
    losses_sum: float = 0.0

    def on_trade_closed(self, pnl: float) -> None:
        self.trades += 1
        self.sum_pnl += pnl
        self.equity += pnl
        self.peak = max(self.peak, self.equity)
        dd = self.equity - self.peak
        self.max_dd = min(self.max_dd, dd)

        if pnl > 0:
            self.wins += 1
            self.wins_sum += pnl
        elif pnl < 0:
            self.losses += 1
            self.losses_sum += pnl

    @property
    def win_rate(self) -> Optional[float]:
        return (self.wins / self.trades) if self.trades else None

    @property
    def profit_factor(self) -> Optional[float]:
        if self.wins_sum <= 0: return None
        if self.losses_sum >= 0: return None
        return self.wins_sum / abs(self.losses_sum)

class LiveReporter:
    """
    Drop this into the backtest loop.
    Call reporter.on_trade_closed(pnl) when a trade closes.
    Call reporter.tick() every candle or every N iterations.
    """
    def __init__(self, every_s: float = 0.5):
        self.p = LivePortfolio()
        self.every_s = every_s
        self._last = 0.0

    def on_trade_closed(self, pnl: float) -> None:
        self.p.on_trade_closed(pnl)

    def tick(self, extra: str = "") -> None:
        now = time.time()
        if now - self._last < self.every_s:
            return
        self._last = now

        line = (
            f"trades={self.p.trades} "
            f"win={fmt_pct(self.p.win_rate)} "
            f"pf={fmt_num(self.p.profit_factor)} "
            f"equity={fmt_num(self.p.equity)} "
            f"maxDD={fmt_num(self.p.max_dd)} "
        )
        if extra:
            line += f"| {extra}"

        # single-line refresh
        print("\r" + line[:160].ljust(160), end="", flush=True)


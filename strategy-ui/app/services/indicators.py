from __future__ import annotations

from typing import List, Optional

def ema(values: List[float], period: int) -> List[Optional[float]]:
    if period <= 0:
        raise ValueError("EMA period must be > 0")
    out: List[Optional[float]] = [None] * len(values)
    if len(values) == 0:
        return out
    k = 2 / (period + 1)
    ema_prev: Optional[float] = None
    for i, v in enumerate(values):
        if i < period - 1:
            out[i] = None
            continue
        if i == period - 1:
            # seed with SMA
            sma = sum(values[:period]) / period
            ema_prev = sma
            out[i] = ema_prev
            continue
        assert ema_prev is not None
        ema_prev = (v - ema_prev) * k + ema_prev
        out[i] = ema_prev
    return out

def rsi(close: List[float], period: int) -> List[Optional[float]]:
    if period <= 0:
        raise ValueError("RSI period must be > 0")
    n = len(close)
    out: List[Optional[float]] = [None] * n
    if n == 0:
        return out

    gains: List[float] = [0.0] * n
    losses: List[float] = [0.0] * n
    for i in range(1, n):
        ch = close[i] - close[i-1]
        gains[i] = max(ch, 0.0)
        losses[i] = max(-ch, 0.0)

    # Wilder smoothing
    avg_gain = sum(gains[1:period+1]) / period if n > period else 0.0
    avg_loss = sum(losses[1:period+1]) / period if n > period else 0.0

    if n <= period:
        return out

    def calc_rsi(ag: float, al: float) -> float:
        if al == 0:
            return 100.0
        rs = ag / al
        return 100.0 - (100.0 / (1.0 + rs))

    out[period] = calc_rsi(avg_gain, avg_loss)

    for i in range(period + 1, n):
        avg_gain = (avg_gain * (period - 1) + gains[i]) / period
        avg_loss = (avg_loss * (period - 1) + losses[i]) / period
        out[i] = calc_rsi(avg_gain, avg_loss)

    return out


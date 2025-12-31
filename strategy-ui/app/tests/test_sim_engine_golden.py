from app.services.sim_engine import simulate_token
from app.services.sim_types import Candle

def test_golden_stop_then_target_same_candle_conservative_long():
    # One candle where BOTH stop and target are inside range.
    # With conservative_long intrabar ordering: STOP (via L) happens before TARGET (via H).
    candles = [
        Candle(ts="2025-01-01T00:00:00Z", o=100, h=101, l=99, c=100, v=1),
        Candle(ts="2025-01-01T00:01:00Z", o=100, h=120, l=80, c=110, v=1),  # target and stop both possible
    ]

    strategy = {
        "entry": {"mode": "immediate", "delay": {"mode": "none"}},
        "exits": {"targets": [{"size_pct": 100, "profit_pct": 10}], "trailing": {"enabled": False}, "time_exit": {"enabled": False}},
        "stops": {"stop_loss_pct": 10, "break_even_after_first_target": False},
        "execution": {"fill_model": "open", "fee_bps": 0, "slippage_bps": 0},
    }

    summary, trades, events, frames = simulate_token("TKN", candles, strategy)
    assert len(trades) == 1
    assert trades[0].exit_reason == "stop"
    # stop price = entry*(1-0.10) = 90
    assert abs(trades[0].exit_price - 90.0) < 1e-9


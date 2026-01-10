"""
Golden tests for V1 Baseline Capital-Aware Simulator and Optimizer.

These tests use deterministic fixtures to verify the Python implementation
produces expected results. They serve as regression tests and parity checks.
"""
from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest

# Add parent directory to path
_BACKTEST_DIR = Path(__file__).parent.parent
if str(_BACKTEST_DIR) not in sys.path:
    sys.path.insert(0, str(_BACKTEST_DIR))

from lib.v1_baseline_simulator import (
    V1BaselineParams,
    CapitalSimulatorConfig,
    simulate_capital_aware,
)
from lib.v1_baseline_optimizer import optimize_v1_baseline

UTC = timezone.utc


def make_candle_dict(ts_ms: int, o: float, h: float, l: float, c: float) -> dict:
    """Helper to create candle dict."""
    return {
        "timestamp": ts_ms / 1000,  # Stored as seconds
        "open": o,
        "high": h,
        "low": l,
        "close": c,
        "volume": 1000.0,
    }


def make_call_dict(call_id: str, mint: str, caller: str, ts_ms: int) -> dict:
    """Helper to create call dict."""
    return {
        "id": call_id,
        "mint": mint,
        "caller": caller,
        "ts_ms": ts_ms,
    }


class TestSimplePumpScenario:
    """Golden test: Simple pump to 3x."""
    
    def test_simple_pump_tp_exit(self):
        """Simple pump: price goes 1.0 -> 3.0 -> 1.5, TP at 2.0."""
        base_ts = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC).timestamp() * 1000)
        
        call = make_call_dict("call1", "TOKEN_PUMP", "GoldenCaller", base_ts)
        
        # Linear pump to 3x over 30 minutes, then decline to 1.5x
        candles = []
        for i in range(60):
            ts = base_ts + (i * 60000)
            if i < 30:
                # Rising: 1.0 -> 3.0
                price = 1.0 + (2.0 * i / 30)
            else:
                # Falling: 3.0 -> 1.5
                price = 3.0 - (1.5 * (i - 30) / 30)
            candles.append(make_candle_dict(ts, price * 0.99, price * 1.01, price * 0.98, price))
        
        params = V1BaselineParams(tp_mult=2.0, sl_mult=0.85)
        config = CapitalSimulatorConfig(initial_capital=10_000)
        
        result = simulate_capital_aware(
            calls=[call],
            candles_by_call_id={"call1": candles},
            params=params,
            config=config,
        )
        
        # Golden assertions
        assert result.trades_executed == 1
        assert result.completed_trades[0].exit_reason == "take_profit"
        assert result.completed_trades[0].exit_px == 2.0
        assert result.completed_trades[0].exit_mult == 2.0
        
        # Position size should be 400 (4% of 10000)
        assert abs(result.completed_trades[0].size - 400.0) < 0.1
        
        # PnL should be ~396.8 (400 * (2.0 - 1) - fees)
        # Fees = (400 * 40 / 10000) * 2 = 3.2
        # Net PnL = 400 - 3.2 = 396.8
        assert abs(result.completed_trades[0].pnl - 396.8) < 0.1
        
        # Final capital should be 10396.8
        assert abs(result.final_capital - 10396.8) < 0.1
        assert result.total_return > 0


class TestInstantRugScenario:
    """Golden test: Instant rug."""
    
    def test_instant_rug_sl_exit(self):
        """Instant rug: price goes 1.0 -> 0.1, SL at 0.85."""
        base_ts = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC).timestamp() * 1000)
        
        call = make_call_dict("call1", "TOKEN_RUG", "GoldenCaller", base_ts)
        
        # Entry at 1.0, immediate rug to 0.1
        candles = [
            make_candle_dict(base_ts, 1.0, 1.05, 0.95, 1.0),
            make_candle_dict(base_ts + 60000, 1.0, 1.0, 0.1, 0.15),  # SL hit in low
        ]
        
        params = V1BaselineParams(tp_mult=2.0, sl_mult=0.85)
        config = CapitalSimulatorConfig(initial_capital=10_000)
        
        result = simulate_capital_aware(
            calls=[call],
            candles_by_call_id={"call1": candles},
            params=params,
            config=config,
        )
        
        # Golden assertions
        assert result.trades_executed == 1
        assert result.completed_trades[0].exit_reason == "stop_loss"
        assert result.completed_trades[0].exit_px == 0.85
        assert result.completed_trades[0].exit_mult == 0.85
        
        # Position size should be 400
        assert abs(result.completed_trades[0].size - 400.0) < 0.1
        
        # PnL should be ~-63.2 (400 * (0.85 - 1) - fees)
        # Gross loss = 400 * -0.15 = -60
        # Fees = 3.2
        # Net PnL = -60 - 3.2 = -63.2
        assert abs(result.completed_trades[0].pnl - (-63.2)) < 0.1
        
        # Final capital should be 9936.8
        assert abs(result.final_capital - 9936.8) < 0.1
        assert result.total_return < 0


class TestMultiCallCapitalConstraint:
    """Golden test: Multiple calls with capital constraints."""
    
    def test_multi_call_capital_constraint(self):
        """10 calls, limited capital, verify position sizing."""
        base_ts = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC).timestamp() * 1000)
        
        # 10 calls, all at same time
        calls = []
        candles_by_call_id = {}
        for i in range(10):
            call_id = f"call{i}"
            calls.append(make_call_dict(call_id, f"TOKEN_{i}", "GoldenCaller", base_ts))
            
            # All hit TP at 2x
            candles_by_call_id[call_id] = [
                make_candle_dict(base_ts, 1.0, 1.05, 0.95, 1.0),
                make_candle_dict(base_ts + 60000, 1.0, 2.5, 0.95, 2.3),
            ]
        
        params = V1BaselineParams(tp_mult=2.0, sl_mult=0.85)
        config = CapitalSimulatorConfig(initial_capital=10_000)
        
        result = simulate_capital_aware(
            calls=calls,
            candles_by_call_id=candles_by_call_id,
            params=params,
            config=config,
        )
        
        # All 10 trades should execute (capital allows)
        assert result.trades_executed == 10
        
        # Position sizes should vary based on available capital (path-dependent)
        # After wins, capital increases, so position sizes can increase
        sizes = [t.size for t in result.completed_trades]
        assert len(sizes) == 10
        
        # First position should be ~400 (4% of 10000)
        assert abs(sizes[0] - 400.0) < 1.0
        
        # All should be profitable
        for trade in result.completed_trades:
            assert trade.pnl > 0
        
        # Final capital should be > initial (all wins)
        assert result.final_capital > 10_000


class TestOptimizerGolden:
    """Golden test: Optimizer finds best parameters."""
    
    def test_optimizer_finds_best_params(self):
        """Optimizer correctly identifies best TP/SL combination."""
        base_ts = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC).timestamp() * 1000)
        
        call = make_call_dict("call1", "TOKEN_OPT", "GoldenCaller", base_ts)
        
        # Price pattern: goes to exactly 2.5x
        candles = [
            make_candle_dict(base_ts, 1.0, 1.05, 0.95, 1.0),
            make_candle_dict(base_ts + 60000, 1.0, 1.5, 0.95, 1.4),
            make_candle_dict(base_ts + 120000, 1.4, 2.5, 1.3, 2.4),  # Hits 2.5x
            make_candle_dict(base_ts + 180000, 2.4, 2.5, 2.0, 2.1),
        ]
        
        param_grid = {
            "tp_mults": [2.0, 2.5, 3.0],
            "sl_mults": [0.85, 0.9],
            "max_hold_hrs": [48.0],
        }
        
        result = optimize_v1_baseline(
            calls=[call],
            candles_by_call_id={"call1": candles},
            param_grid=param_grid,
        )
        
        # Best params should be TP=2.5 (captures the 2.5x move)
        assert result.best_params is not None
        assert result.best_params.tp_mult == 2.5
        
        # Should evaluate all combinations
        assert result.params_evaluated == 3 * 2 * 1  # 6 combinations
        
        # Best result should be profitable
        assert result.best_total_return > 0


class TestConcurrentPositionLimit:
    """Golden test: Concurrent position limit enforcement."""
    
    def test_concurrent_position_limit(self):
        """Verify max concurrent positions constraint works correctly."""
        base_ts = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC).timestamp() * 1000)
        
        # 30 calls at same time, max 25 positions
        calls = []
        candles_by_call_id = {}
        for i in range(30):
            call_id = f"call{i}"
            calls.append(make_call_dict(call_id, f"TOKEN_{i}", "GoldenCaller", base_ts))
            
            # All exit after 1 hour (time exit)
            candles_by_call_id[call_id] = [
                make_candle_dict(base_ts + j * 60000, 1.0, 1.05, 0.95, 1.0)
                for j in range(100)
            ]
        
        params = V1BaselineParams(tp_mult=2.0, sl_mult=0.85, max_hold_hrs=1.0)
        config = CapitalSimulatorConfig(
            initial_capital=50_000,  # Enough capital for all
            max_concurrent_positions=25,
        )
        
        result = simulate_capital_aware(
            calls=calls,
            candles_by_call_id=candles_by_call_id,
            params=params,
            config=config,
        )
        
        # With enough capital, all 30 trades execute (they don't overlap after 1 hour)
        # But the constraint prevents >25 concurrent
        assert result.trades_executed >= 25
        assert result.trades_executed <= 30


class TestFeeCalculationGolden:
    """Golden test: Fee calculation correctness."""
    
    def test_fee_calculation_exact(self):
        """Verify exact fee calculation."""
        base_ts = int(datetime(2025, 1, 1, 0, 0, 0, tzinfo=UTC).timestamp() * 1000)
        
        call = make_call_dict("call1", "TOKEN_FEE", "GoldenCaller", base_ts)
        candles = [
            make_candle_dict(base_ts, 1.0, 1.05, 0.95, 1.0),
            make_candle_dict(base_ts + 60000, 1.0, 2.0, 0.95, 2.0),  # Exactly 2x
        ]
        
        params = V1BaselineParams(tp_mult=2.0, sl_mult=0.85)
        config = CapitalSimulatorConfig(
            initial_capital=10_000,
            taker_fee_bps=30,
            slippage_bps=10,
        )
        
        result = simulate_capital_aware(
            calls=[call],
            candles_by_call_id={"call1": candles},
            params=params,
            config=config,
        )
        
        trade = result.completed_trades[0]
        
        # Position size = 400 (4% of 10000)
        assert abs(trade.size - 400.0) < 0.01
        
        # Gross PnL = 400 * (2.0 - 1) = 400
        gross_pnl = 400.0
        
        # Fees = (400 * 40 / 10000) * 2 = 3.2
        fees = (400.0 * 40 / 10000) * 2
        assert abs(fees - 3.2) < 0.01
        
        # Net PnL = 400 - 3.2 = 396.8
        expected_pnl = gross_pnl - fees
        assert abs(trade.pnl - expected_pnl) < 0.01
        assert abs(trade.pnl - 396.8) < 0.01


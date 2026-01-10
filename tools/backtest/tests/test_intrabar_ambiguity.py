"""
Tests for intrabar TP/SL ambiguity handling.

Validates:
1. tp_first mode: when both TP and SL hit on same candle, TP wins
2. sl_first mode: when both TP and SL hit on same candle, SL wins
3. Unambiguous cases work correctly in both modes
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from fixtures import (
    make_candle,
    write_candles_to_parquet,
)

UTC = timezone.utc


class TestIntrabarAmbiguity:
    """Test TP/SL resolution when both trigger on same candle."""

    def test_both_hit_same_candle_tp_first(self, tmp_dir, base_timestamp):
        """When TP and SL both trigger, tp_first should exit at TP."""
        candles = []
        entry_price = 1.0
        
        # Entry candle
        candles.append(make_candle("TOKEN", base_timestamp, entry_price, entry_price * 1.1, entry_price * 0.95, entry_price))
        
        # Normal candles
        for i in range(1, 10):
            ts = base_timestamp + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, entry_price, entry_price * 1.1, entry_price * 0.95, entry_price))
        
        # Ambiguous candle: hits both 2x (TP) and 0.5x (SL)
        ts = base_timestamp + timedelta(seconds=10 * 60)
        candles.append(make_candle("TOKEN", ts, entry_price, entry_price * 2.1, entry_price * 0.4, entry_price))
        
        # Post candles
        for i in range(11, 60):
            ts = base_timestamp + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, entry_price, entry_price * 1.1, entry_price * 0.95, entry_price))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        # Need run_fast_backtest for TP/SL testing
        from run_fast_backtest import Alert, run_vectorized_backtest
        
        alerts = [
            Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")
        ]
        
        # Test tp_first
        results_tp_first = run_vectorized_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            tp_mult=2.0,
            sl_mult=0.5,
            intrabar_order="tp_first",
            fee_bps=0,
            slippage_bps=0,
            threads=1,
            verbose=False,
        )
        
        assert len(results_tp_first) == 1
        result = results_tp_first[0]
        assert result["status"] == "ok"
        assert result["tp_sl_exit_reason"] == "tp", "tp_first mode should exit at TP"
        # Return should be ~100% (2x exit)
        assert result["tp_sl_ret"] > 0.9

    def test_both_hit_same_candle_sl_first(self, tmp_dir, base_timestamp):
        """When TP and SL both trigger, sl_first should exit at SL."""
        candles = []
        entry_price = 1.0
        
        # Entry candle
        candles.append(make_candle("TOKEN", base_timestamp, entry_price, entry_price * 1.1, entry_price * 0.95, entry_price))
        
        # Normal candles
        for i in range(1, 10):
            ts = base_timestamp + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, entry_price, entry_price * 1.1, entry_price * 0.95, entry_price))
        
        # Ambiguous candle: hits both 2x (TP) and 0.5x (SL)
        ts = base_timestamp + timedelta(seconds=10 * 60)
        candles.append(make_candle("TOKEN", ts, entry_price, entry_price * 2.1, entry_price * 0.4, entry_price))
        
        # Post candles
        for i in range(11, 60):
            ts = base_timestamp + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, entry_price, entry_price * 1.1, entry_price * 0.95, entry_price))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_fast_backtest import Alert, run_vectorized_backtest
        
        alerts = [
            Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")
        ]
        
        # Test sl_first
        results_sl_first = run_vectorized_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            tp_mult=2.0,
            sl_mult=0.5,
            intrabar_order="sl_first",
            fee_bps=0,
            slippage_bps=0,
            threads=1,
            verbose=False,
        )
        
        assert len(results_sl_first) == 1
        result = results_sl_first[0]
        assert result["status"] == "ok"
        assert result["tp_sl_exit_reason"] == "sl", "sl_first mode should exit at SL"
        # Return should be ~-50% (0.5x exit)
        assert result["tp_sl_ret"] < -0.4

    def test_unambiguous_tp_hit(self, tmp_dir, base_timestamp):
        """TP hit without SL should work the same in both modes."""
        candles = []
        entry_price = 1.0
        
        # Entry candle
        candles.append(make_candle("TOKEN", base_timestamp, entry_price, entry_price * 1.1, entry_price * 0.95, entry_price))
        
        # Gradual rise to TP (no SL trigger)
        for i in range(1, 20):
            ts = base_timestamp + timedelta(seconds=i * 60)
            mult = 1.0 + 0.05 * i
            candles.append(make_candle("TOKEN", ts, mult * 0.99, mult, mult * 0.98, mult))
        
        # TP hit candle (2x, but low stays above SL)
        ts = base_timestamp + timedelta(seconds=20 * 60)
        candles.append(make_candle("TOKEN", ts, 1.9, 2.1, 1.85, 2.0))
        
        for i in range(21, 60):
            ts = base_timestamp + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, 2.0, 2.1, 1.9, 2.0))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_fast_backtest import Alert, run_vectorized_backtest
        
        alerts = [
            Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")
        ]
        
        for intrabar in ["tp_first", "sl_first"]:
            results = run_vectorized_backtest(
                alerts=alerts,
                slice_path=parquet_path,
                is_partitioned=False,
                interval_seconds=60,
                horizon_hours=1,
                tp_mult=2.0,
                sl_mult=0.5,
                intrabar_order=intrabar,
                fee_bps=0,
                slippage_bps=0,
                threads=1,
                verbose=False,
            )
            
            assert len(results) == 1
            result = results[0]
            assert result["tp_sl_exit_reason"] == "tp", f"Unambiguous TP should be TP in {intrabar} mode"

    def test_unambiguous_sl_hit(self, tmp_dir, base_timestamp):
        """SL hit without TP should work the same in both modes."""
        candles = []
        entry_price = 1.0
        
        # Entry candle
        candles.append(make_candle("TOKEN", base_timestamp, entry_price, entry_price * 1.1, entry_price * 0.95, entry_price))
        
        # Gradual decline to SL (no TP trigger)
        for i in range(1, 20):
            ts = base_timestamp + timedelta(seconds=i * 60)
            mult = 1.0 - 0.02 * i
            mult = max(mult, 0.6)
            candles.append(make_candle("TOKEN", ts, mult, mult * 1.02, mult * 0.98, mult))
        
        # SL hit candle (0.5x, but high stays below TP)
        ts = base_timestamp + timedelta(seconds=20 * 60)
        candles.append(make_candle("TOKEN", ts, 0.55, 0.6, 0.45, 0.5))
        
        for i in range(21, 60):
            ts = base_timestamp + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, 0.5, 0.55, 0.45, 0.5))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_fast_backtest import Alert, run_vectorized_backtest
        
        alerts = [
            Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")
        ]
        
        for intrabar in ["tp_first", "sl_first"]:
            results = run_vectorized_backtest(
                alerts=alerts,
                slice_path=parquet_path,
                is_partitioned=False,
                interval_seconds=60,
                horizon_hours=1,
                tp_mult=2.0,
                sl_mult=0.5,
                intrabar_order=intrabar,
                fee_bps=0,
                slippage_bps=0,
                threads=1,
                verbose=False,
            )
            
            assert len(results) == 1
            result = results[0]
            assert result["tp_sl_exit_reason"] == "sl", f"Unambiguous SL should be SL in {intrabar} mode"

    def test_horizon_exit_when_no_trigger(self, tmp_dir, base_timestamp):
        """Neither TP nor SL hit - should exit at horizon."""
        candles = []
        entry_price = 1.0
        
        # All candles stay in safe range (0.6 to 1.5)
        for i in range(60):
            ts = base_timestamp + timedelta(seconds=i * 60)
            mult = 1.0 + 0.1 * (i % 5 - 2)  # Oscillates between 0.8 and 1.2
            candles.append(make_candle("TOKEN", ts, mult, mult * 1.1, mult * 0.9, mult))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_fast_backtest import Alert, run_vectorized_backtest
        
        alerts = [
            Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")
        ]
        
        results = run_vectorized_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            tp_mult=2.0,
            sl_mult=0.5,
            intrabar_order="sl_first",
            fee_bps=0,
            slippage_bps=0,
            threads=1,
            verbose=False,
        )
        
        assert len(results) == 1
        result = results[0]
        assert result["tp_sl_exit_reason"] == "horizon", "Should exit at horizon when no TP/SL hit"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


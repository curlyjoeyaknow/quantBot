"""
Tests for fee and slippage math.

Validates:
1. Zero fees/slippage gives raw return
2. Fees reduce returns correctly
3. Slippage affects both entry (worse) and exit (worse)
4. Combined fee + slippage is additive
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


class TestFeeSlippageMath:
    """Test fee and slippage calculations."""

    def test_zero_fees_slippage_gives_raw_return(self, tmp_dir, base_timestamp):
        """With 0 fees and 0 slippage, return should be exact TP/SL multiple."""
        candles = []
        entry_price = 1.0
        
        # Entry candle
        candles.append(make_candle("TOKEN", base_timestamp, entry_price, entry_price * 1.1, entry_price * 0.95, entry_price))
        
        # Quick TP hit at exactly 2x
        for i in range(1, 5):
            ts = base_timestamp + timedelta(seconds=i * 60)
            mult = 1.0 + 0.25 * i
            candles.append(make_candle("TOKEN", ts, mult * 0.99, mult, mult * 0.98, mult))
        
        # TP at 2x
        ts = base_timestamp + timedelta(seconds=5 * 60)
        candles.append(make_candle("TOKEN", ts, 1.9, 2.0, 1.85, 1.95))
        
        for i in range(6, 60):
            ts = base_timestamp + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, 2.0, 2.1, 1.9, 2.0))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_fast_backtest import Alert, run_vectorized_backtest
        
        alerts = [
            Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")
        ]
        
        # Zero fees/slippage
        results = run_vectorized_backtest(
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
        
        result = results[0]
        assert result["tp_sl_exit_reason"] == "tp"
        # Return should be exactly 100% (2x - 1)
        assert abs(result["tp_sl_ret"] - 1.0) < 0.001, f"Expected 1.0, got {result['tp_sl_ret']}"

    def test_fees_reduce_return(self, tmp_dir, base_timestamp):
        """Fees should reduce the final return."""
        candles = []
        entry_price = 1.0
        
        candles.append(make_candle("TOKEN", base_timestamp, entry_price, entry_price * 1.1, entry_price * 0.95, entry_price))
        
        for i in range(1, 5):
            ts = base_timestamp + timedelta(seconds=i * 60)
            mult = 1.0 + 0.25 * i
            candles.append(make_candle("TOKEN", ts, mult * 0.99, mult, mult * 0.98, mult))
        
        ts = base_timestamp + timedelta(seconds=5 * 60)
        candles.append(make_candle("TOKEN", ts, 1.9, 2.0, 1.85, 1.95))
        
        for i in range(6, 60):
            ts = base_timestamp + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, 2.0, 2.1, 1.9, 2.0))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_fast_backtest import Alert, run_vectorized_backtest
        
        alerts = [
            Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")
        ]
        
        # With 50 bps fee (0.5%)
        results_with_fee = run_vectorized_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            tp_mult=2.0,
            sl_mult=0.5,
            intrabar_order="tp_first",
            fee_bps=50,  # 0.5%
            slippage_bps=0,
            threads=1,
            verbose=False,
        )
        
        # Without fee
        results_no_fee = run_vectorized_backtest(
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
        
        ret_with_fee = results_with_fee[0]["tp_sl_ret"]
        ret_no_fee = results_no_fee[0]["tp_sl_ret"]
        
        # Fee should reduce return
        assert ret_with_fee < ret_no_fee, "Fee should reduce return"
        
        # Check magnitude: 50 bps on exit = 0.5% reduction
        # Expected: (exit_price * 0.995) / entry_price - 1
        # = 2.0 * 0.995 / 1.0 - 1 = 0.99
        expected_reduction = 0.005  # 0.5%
        actual_reduction = ret_no_fee - ret_with_fee
        assert abs(actual_reduction - expected_reduction) < 0.01

    def test_slippage_affects_entry_and_exit(self, tmp_dir, base_timestamp):
        """Slippage should affect both entry (worse price) and exit (worse price)."""
        candles = []
        entry_price = 1.0
        
        candles.append(make_candle("TOKEN", base_timestamp, entry_price, entry_price * 1.1, entry_price * 0.95, entry_price))
        
        for i in range(1, 5):
            ts = base_timestamp + timedelta(seconds=i * 60)
            mult = 1.0 + 0.25 * i
            candles.append(make_candle("TOKEN", ts, mult * 0.99, mult, mult * 0.98, mult))
        
        ts = base_timestamp + timedelta(seconds=5 * 60)
        candles.append(make_candle("TOKEN", ts, 1.9, 2.0, 1.85, 1.95))
        
        for i in range(6, 60):
            ts = base_timestamp + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, 2.0, 2.1, 1.9, 2.0))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_fast_backtest import Alert, run_vectorized_backtest
        
        alerts = [
            Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")
        ]
        
        # With 100 bps slippage (1%)
        results_with_slip = run_vectorized_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            tp_mult=2.0,
            sl_mult=0.5,
            intrabar_order="tp_first",
            fee_bps=0,
            slippage_bps=100,  # 1%
            threads=1,
            verbose=False,
        )
        
        results_no_slip = run_vectorized_backtest(
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
        
        ret_with_slip = results_with_slip[0]["tp_sl_ret"]
        ret_no_slip = results_no_slip[0]["tp_sl_ret"]
        
        # Slippage should reduce return
        assert ret_with_slip < ret_no_slip, "Slippage should reduce return"
        
        # Entry slippage: buy at entry * 1.01
        # Exit slippage: sell at exit * 0.99
        # Net effect: (exit * 0.99) / (entry * 1.01) - 1
        # With 100 bps: ~2% total reduction from raw return

    def test_combined_fee_and_slippage(self, tmp_dir, base_timestamp):
        """Combined fee + slippage should be roughly additive."""
        candles = []
        entry_price = 1.0
        
        candles.append(make_candle("TOKEN", base_timestamp, entry_price, entry_price * 1.1, entry_price * 0.95, entry_price))
        
        for i in range(1, 5):
            ts = base_timestamp + timedelta(seconds=i * 60)
            mult = 1.0 + 0.25 * i
            candles.append(make_candle("TOKEN", ts, mult * 0.99, mult, mult * 0.98, mult))
        
        ts = base_timestamp + timedelta(seconds=5 * 60)
        candles.append(make_candle("TOKEN", ts, 1.9, 2.0, 1.85, 1.95))
        
        for i in range(6, 60):
            ts = base_timestamp + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, 2.0, 2.1, 1.9, 2.0))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_fast_backtest import Alert, run_vectorized_backtest
        
        alerts = [
            Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")
        ]
        
        # Fee only
        results_fee_only = run_vectorized_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            tp_mult=2.0,
            sl_mult=0.5,
            intrabar_order="tp_first",
            fee_bps=30,
            slippage_bps=0,
            threads=1,
            verbose=False,
        )
        
        # Slippage only
        results_slip_only = run_vectorized_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            tp_mult=2.0,
            sl_mult=0.5,
            intrabar_order="tp_first",
            fee_bps=0,
            slippage_bps=50,
            threads=1,
            verbose=False,
        )
        
        # Both
        results_both = run_vectorized_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            tp_mult=2.0,
            sl_mult=0.5,
            intrabar_order="tp_first",
            fee_bps=30,
            slippage_bps=50,
            threads=1,
            verbose=False,
        )
        
        # No costs baseline
        results_none = run_vectorized_backtest(
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
        
        ret_none = results_none[0]["tp_sl_ret"]
        ret_fee = results_fee_only[0]["tp_sl_ret"]
        ret_slip = results_slip_only[0]["tp_sl_ret"]
        ret_both = results_both[0]["tp_sl_ret"]
        
        # Reductions
        reduction_fee = ret_none - ret_fee
        reduction_slip = ret_none - ret_slip
        reduction_both = ret_none - ret_both
        
        # Combined reduction should be roughly sum (with small interaction term)
        expected_combined = reduction_fee + reduction_slip
        assert abs(reduction_both - expected_combined) < 0.005, \
            f"Combined reduction {reduction_both} != fee {reduction_fee} + slip {reduction_slip}"


class TestFeeSlippageOnLoss:
    """Test that fees/slippage also affect losses correctly."""

    def test_sl_exit_with_fees(self, tmp_dir, base_timestamp):
        """SL exit should also have fees applied."""
        candles = []
        entry_price = 1.0
        
        candles.append(make_candle("TOKEN", base_timestamp, entry_price, entry_price * 1.1, entry_price * 0.95, entry_price))
        
        # Quick drop to SL
        for i in range(1, 5):
            ts = base_timestamp + timedelta(seconds=i * 60)
            mult = 1.0 - 0.1 * i
            candles.append(make_candle("TOKEN", ts, mult, mult * 1.02, mult * 0.98, mult))
        
        # SL hit at 0.5x
        ts = base_timestamp + timedelta(seconds=5 * 60)
        candles.append(make_candle("TOKEN", ts, 0.55, 0.6, 0.45, 0.5))
        
        for i in range(6, 60):
            ts = base_timestamp + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, 0.5, 0.55, 0.45, 0.5))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_fast_backtest import Alert, run_vectorized_backtest
        
        alerts = [
            Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")
        ]
        
        # With fees
        results_with_fee = run_vectorized_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            tp_mult=2.0,
            sl_mult=0.5,
            intrabar_order="sl_first",
            fee_bps=50,
            slippage_bps=0,
            threads=1,
            verbose=False,
        )
        
        # Without fees
        results_no_fee = run_vectorized_backtest(
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
        
        ret_with_fee = results_with_fee[0]["tp_sl_ret"]
        ret_no_fee = results_no_fee[0]["tp_sl_ret"]
        
        # Both should be negative (loss)
        assert ret_with_fee < 0
        assert ret_no_fee < 0
        
        # Fee should make loss worse (more negative)
        assert ret_with_fee < ret_no_fee, "Fee should make loss worse"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


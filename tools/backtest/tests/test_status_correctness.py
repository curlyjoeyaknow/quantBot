"""
Tests for status correctness.

Validates:
1. Status = 'ok' when sufficient candles available
2. Status = 'missing' when no candles for token
3. Status = 'missing' when insufficient candles (<2)
4. Status = 'bad_entry' when entry_price <= 0
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from fixtures import (
    make_candle,
    make_linear_pump,
    write_candles_to_parquet,
)

UTC = timezone.utc


class TestStatusCorrectness:
    """Test that status field is correctly set."""

    def test_ok_status_with_sufficient_candles(self, tmp_dir, base_timestamp):
        """Status should be 'ok' when enough candles exist."""
        candles = make_linear_pump(
            "TOKEN", base_timestamp, 1.0, 3.0, 30, 30
        )
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        alerts = [
            Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")
        ]
        
        results = run_baseline_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            threads=1,
            verbose=False,
        )
        
        assert len(results) == 1
        assert results[0]["status"] == "ok"
        assert results[0]["candles"] >= 2

    def test_missing_status_no_token_data(self, tmp_dir, base_timestamp):
        """Status should be 'missing' when token has no candles."""
        # Only TOKEN_A has data
        candles = make_linear_pump(
            "TOKEN_A", base_timestamp, 1.0, 3.0, 30, 30
        )
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        alerts = [
            Alert(mint="TOKEN_B", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")  # No data!
        ]
        
        results = run_baseline_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            threads=1,
            verbose=False,
        )
        
        assert len(results) == 1
        assert results[0]["status"] == "missing"
        assert results[0]["candles"] == 0

    def test_missing_status_insufficient_candles(self, tmp_dir, base_timestamp):
        """Status should be 'missing' when less than 2 candles."""
        # Only 1 candle
        candles = [make_candle("TOKEN", base_timestamp, 1.0, 1.1, 0.9, 1.0)]
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        alerts = [
            Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")
        ]
        
        results = run_baseline_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            threads=1,
            verbose=False,
        )
        
        assert len(results) == 1
        # With only 1 candle, status should be 'missing'
        assert results[0]["status"] == "missing"

    def test_missing_status_candles_outside_window(self, tmp_dir, base_timestamp):
        """Status should be 'missing' when candles are outside alert window."""
        # Candles are 2 hours BEFORE the alert
        candle_time = base_timestamp - timedelta(hours=2)
        candles = make_linear_pump(
            "TOKEN", candle_time, 1.0, 3.0, 30, 30
        )
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        # Alert is 2 hours AFTER the candles
        alerts = [
            Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")
        ]
        
        results = run_baseline_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            threads=1,
            verbose=False,
        )
        
        assert len(results) == 1
        assert results[0]["status"] == "missing"

    def test_bad_entry_status_zero_price(self, tmp_dir, base_timestamp):
        """Status should be 'bad_entry' when entry price is 0."""
        # Candles with 0 open price
        candles = []
        for i in range(60):
            ts = base_timestamp + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, 0.0, 0.1, 0.0, 0.0))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        alerts = [
            Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")
        ]
        
        results = run_baseline_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            threads=1,
            verbose=False,
        )
        
        assert len(results) == 1
        assert results[0]["status"] == "bad_entry"


class TestMixedStatuses:
    """Test that mixed statuses are handled correctly."""

    def test_multiple_alerts_mixed_status(self, tmp_dir, base_timestamp):
        """Multiple alerts with different statuses should all be correct."""
        candles = []
        
        # TOKEN_A: has full data
        candles.extend(make_linear_pump(
            "TOKEN_A", base_timestamp, 1.0, 3.0, 30, 30
        ))
        
        # TOKEN_B: only 1 candle
        candles.append(make_candle("TOKEN_B", base_timestamp, 1.0, 1.1, 0.9, 1.0))
        
        # TOKEN_C: no candles (not added)
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        ts_ms = int(base_timestamp.timestamp() * 1000)
        alerts = [
            Alert(mint="TOKEN_A", ts_ms=ts_ms, caller="Caller1"),  # Should be OK
            Alert(mint="TOKEN_B", ts_ms=ts_ms, caller="Caller2"),  # Should be missing (1 candle)
            Alert(mint="TOKEN_C", ts_ms=ts_ms, caller="Caller3"),  # Should be missing (no candles)
        ]
        
        results = run_baseline_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            threads=1,
            verbose=False,
        )
        
        assert len(results) == 3
        
        status_by_mint = {r["mint"]: r["status"] for r in results}
        
        assert status_by_mint["TOKEN_A"] == "ok"
        assert status_by_mint["TOKEN_B"] == "missing"  # Only 1 candle
        assert status_by_mint["TOKEN_C"] == "missing"  # No candles


class TestCandleCountAccuracy:
    """Test that candle counts are accurate."""

    def test_candle_count_matches_window(self, tmp_dir, base_timestamp):
        """Candle count should match exactly the number within window."""
        # Create exactly 30 candles
        candles = []
        for i in range(30):
            ts = base_timestamp + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, 1.0, 1.1, 0.9, 1.0))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        # 30 minute horizon = 30 candles at 1m interval
        # But window is [entry_ts, end_ts) which is 30 minutes
        alerts = [
            Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")
        ]
        
        results = run_baseline_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,  # 60 candles expected in window
            threads=1,
            verbose=False,
        )
        
        assert len(results) == 1
        # We have 30 candles, horizon is 1 hour, so we get 30 candles
        assert results[0]["candles"] == 30
        assert results[0]["status"] == "ok"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


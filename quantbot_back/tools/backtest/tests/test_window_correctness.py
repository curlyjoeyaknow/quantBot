"""
Tests for window correctness - no peeking to future candles.

Validates:
1. Entry candle alignment (ceil to interval boundary)
2. End-exclusive horizon (no candles at or after end_ts)
3. No pre-entry leakage (no candles before entry_ts)
4. Entry price is from the FIRST candle in window
5. ATH/time-to-Nx only considers candles WITHIN window
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

# Import fixtures from conftest (auto-loaded by pytest)
from fixtures import (
    SyntheticAlert,
    SyntheticCandle,
    make_candle,
    make_linear_pump,
    write_candles_to_parquet,
)

UTC = timezone.utc


class TestEntryCangleAlignment:
    """Test that entry is aligned to interval boundary."""

    def test_alert_at_interval_boundary(self, tmp_dir, base_timestamp):
        """Alert at exact interval boundary should use that candle."""
        # Alert at 00:00:00 (interval boundary for 60s)
        alert_ts = base_timestamp
        alert_ts_ms = int(alert_ts.timestamp() * 1000)
        
        # Expected entry: 00:00:00 (same as alert)
        expected_entry_ts = alert_ts
        
        # Candles starting at 00:00:00
        candles = []
        for i in range(60):
            ts = base_timestamp + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, 1.0, 1.1, 0.9, 1.0))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        # Import here to avoid circular imports
        from run_baseline_all import (
            Alert,
            ceil_ms_to_interval_ts_ms,
            run_baseline_backtest,
        )
        
        # Verify ceil function
        entry_ts_ms = ceil_ms_to_interval_ts_ms(alert_ts_ms, 60)
        assert entry_ts_ms == alert_ts_ms, "Alert at boundary should not be ceil'd"

    def test_alert_between_intervals(self, tmp_dir, base_timestamp):
        """Alert between intervals should ceil to next boundary."""
        # Alert at 00:00:30 (mid-interval for 60s)
        alert_ts = base_timestamp + timedelta(seconds=30)
        alert_ts_ms = int(alert_ts.timestamp() * 1000)
        
        # Expected entry: 00:01:00 (ceil to next boundary)
        expected_entry_ts = base_timestamp + timedelta(seconds=60)
        expected_entry_ms = int(expected_entry_ts.timestamp() * 1000)
        
        from run_baseline_all import ceil_ms_to_interval_ts_ms
        
        entry_ts_ms = ceil_ms_to_interval_ts_ms(alert_ts_ms, 60)
        assert entry_ts_ms == expected_entry_ms, f"Expected {expected_entry_ms}, got {entry_ts_ms}"

    def test_alert_1ms_before_boundary(self, tmp_dir, base_timestamp):
        """Alert 1ms before boundary should ceil to that boundary."""
        boundary = base_timestamp + timedelta(seconds=60)
        alert_ts_ms = int(boundary.timestamp() * 1000) - 1
        expected_entry_ms = int(boundary.timestamp() * 1000)
        
        from run_baseline_all import ceil_ms_to_interval_ts_ms
        
        entry_ts_ms = ceil_ms_to_interval_ts_ms(alert_ts_ms, 60)
        assert entry_ts_ms == expected_entry_ms


class TestNoPreEntryLeakage:
    """Test that no candles before entry_ts are used."""

    def test_pre_entry_high_not_used(self, tmp_dir, base_timestamp):
        """A massive high BEFORE entry should not affect ATH."""
        # Create candles with a huge spike BEFORE entry
        candles = []
        
        # Pre-entry candles (should be ignored)
        for i in range(10):
            ts = base_timestamp + timedelta(seconds=i * 60)
            # Massive spike at i=5
            if i == 5:
                candles.append(make_candle("TOKEN", ts, 1.0, 100.0, 0.9, 1.0))  # 100x high!
            else:
                candles.append(make_candle("TOKEN", ts, 1.0, 1.1, 0.9, 1.0))
        
        # Post-entry candles (normal pump to 3x)
        for i in range(10, 70):
            ts = base_timestamp + timedelta(seconds=i * 60)
            mult = 1.0 + 2.0 * (i - 10) / 30  # Max 3x at i=40
            mult = min(mult, 3.0)
            candles.append(make_candle("TOKEN", ts, mult, mult * 1.02, mult * 0.98, mult))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        # Alert at candle 10 (entry at 00:10:00)
        from run_baseline_all import Alert, run_baseline_backtest
        
        alert_ts = base_timestamp + timedelta(seconds=10 * 60)
        alerts = [Alert(mint="TOKEN", ts_ms=int(alert_ts.timestamp() * 1000), caller="Test")]
        
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
        result = results[0]
        assert result["status"] == "ok"
        
        # ATH should be ~3x, NOT 100x (which was before entry)
        ath_mult = result["ath_mult"]
        assert ath_mult < 5.0, f"ATH {ath_mult}x includes pre-entry data!"
        assert ath_mult >= 2.5, f"ATH {ath_mult}x seems too low"


class TestEndExclusiveHorizon:
    """Test that horizon end is exclusive (no candles at end_ts)."""

    def test_candle_at_end_ts_excluded(self, tmp_dir, base_timestamp):
        """Candle exactly at end_ts should NOT be included."""
        # 1-hour horizon = 60 candles at 1m interval
        horizon_hours = 1
        horizon_seconds = horizon_hours * 3600
        
        candles = []
        entry_price = 1.0
        
        # Entry candle at base_timestamp
        candles.append(make_candle("TOKEN", base_timestamp, entry_price, entry_price * 1.02, entry_price * 0.98, entry_price))
        
        # Normal candles (no spike)
        for i in range(1, 59):
            ts = base_timestamp + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, entry_price, entry_price * 1.02, entry_price * 0.98, entry_price))
        
        # Candle at exactly end_ts (should be excluded)
        end_ts = base_timestamp + timedelta(seconds=horizon_seconds)
        candles.append(make_candle("TOKEN", end_ts, entry_price, entry_price * 100.0, entry_price * 0.98, entry_price))  # 100x spike!
        
        # Candle after end_ts (definitely excluded)
        after_end_ts = base_timestamp + timedelta(seconds=horizon_seconds + 60)
        candles.append(make_candle("TOKEN", after_end_ts, entry_price, entry_price * 200.0, entry_price * 0.98, entry_price))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        alerts = [Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Test")]
        
        results = run_baseline_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=horizon_hours,
            threads=1,
            verbose=False,
        )
        
        assert len(results) == 1
        result = results[0]
        assert result["status"] == "ok"
        
        # ATH should be ~1.02x (normal candle high), NOT 100x or 200x
        ath_mult = result["ath_mult"]
        assert ath_mult < 2.0, f"ATH {ath_mult}x includes end_ts candle!"


class TestEntryPriceFromFirstCandle:
    """Test that entry price is from the FIRST candle's open."""

    def test_entry_price_is_first_open(self, tmp_dir, base_timestamp):
        """Entry price should be the open of the first candle in window."""
        candles = []
        
        # First candle with specific open price
        first_open = 1.234
        candles.append(make_candle("TOKEN", base_timestamp, first_open, 1.5, 1.0, 1.3))
        
        # Subsequent candles
        for i in range(1, 60):
            ts = base_timestamp + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, 2.0, 2.5, 1.8, 2.2))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        alerts = [Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Test")]
        
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
        result = results[0]
        assert result["status"] == "ok"
        
        # Entry price should be exactly first_open
        assert abs(result["entry_price"] - first_open) < 0.0001, f"Entry price {result['entry_price']} != {first_open}"


class TestTimeToMultiplesWindow:
    """Test that time-to-Nx only considers candles within window."""

    def test_2x_hit_timing(self, tmp_dir, base_timestamp):
        """Time to 2x should be accurate based on first 2x hit."""
        candles = []
        entry_price = 1.0
        
        # Entry candle
        candles.append(make_candle("TOKEN", base_timestamp, entry_price, entry_price * 1.1, entry_price * 0.9, entry_price))
        
        # Gradual rise, hit 2x at candle 10 (10 minutes)
        for i in range(1, 60):
            ts = base_timestamp + timedelta(seconds=i * 60)
            if i < 10:
                mult = 1.0 + 0.1 * i  # 1.1, 1.2, ..., 1.9
            elif i == 10:
                mult = 2.0  # Exactly 2x
            else:
                mult = 2.0 + 0.1 * (i - 10)  # Keep rising
            
            candles.append(make_candle("TOKEN", ts, mult * 0.98, mult, mult * 0.95, mult * 0.99))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        alerts = [Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Test")]
        
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
        result = results[0]
        assert result["status"] == "ok"
        
        # Time to 2x should be 10 minutes = 600 seconds
        time_to_2x = result["time_to_2x_s"]
        assert time_to_2x is not None, "Should have hit 2x"
        assert 500 <= time_to_2x <= 700, f"Time to 2x {time_to_2x}s not ~600s"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


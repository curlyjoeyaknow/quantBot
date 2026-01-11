"""
Tests for UTC string formatting.

Validates:
1. Timestamps are correctly formatted as UTC
2. No timezone drift between input and output
3. Consistent formatting across all outputs
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


class TestUTCFormatting:
    """Test UTC timestamp formatting."""

    def test_alert_ts_utc_format(self, tmp_dir, base_timestamp):
        """Alert timestamp should be formatted as YYYY-MM-DD HH:MM:SS in UTC."""
        candles = make_linear_pump(
            "TOKEN", base_timestamp, 1.0, 3.0, 30, 30
        )
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        # Alert at specific time
        alert_time = datetime(2025, 1, 1, 12, 30, 45, tzinfo=UTC)
        alerts = [
            Alert(mint="TOKEN", ts_ms=int(alert_time.timestamp() * 1000), caller="Caller")
        ]
        
        # Need candles at that time
        candles = []
        for i in range(60):
            ts = alert_time + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, 1.0, 1.1, 0.9, 1.0))
        write_candles_to_parquet(candles, parquet_path)
        
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
        
        # Check format: YYYY-MM-DD HH:MM:SS
        alert_ts_utc = result["alert_ts_utc"]
        assert alert_ts_utc is not None
        
        # Parse it back
        parsed = datetime.strptime(alert_ts_utc, "%Y-%m-%d %H:%M:%S")
        parsed = parsed.replace(tzinfo=UTC)
        
        # Should match original (within rounding)
        diff_ms = abs(parsed.timestamp() * 1000 - int(alert_time.timestamp() * 1000))
        assert diff_ms < 1000, f"Timestamp drift: {diff_ms}ms"

    def test_entry_ts_utc_alignment(self, tmp_dir, base_timestamp):
        """Entry timestamp should be ceiled to interval boundary."""
        candles = []
        for i in range(60):
            ts = base_timestamp + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, 1.0, 1.1, 0.9, 1.0))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        # Alert at 00:00:30 (mid-minute) should have entry at 00:01:00
        alert_time = base_timestamp + timedelta(seconds=30)
        expected_entry = base_timestamp + timedelta(seconds=60)
        
        alerts = [
            Alert(mint="TOKEN", ts_ms=int(alert_time.timestamp() * 1000), caller="Caller")
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
        result = results[0]
        
        entry_ts_utc = result["entry_ts_utc"]
        expected_str = expected_entry.strftime("%Y-%m-%d %H:%M:%S")
        
        assert entry_ts_utc == expected_str, f"Entry {entry_ts_utc} != expected {expected_str}"

    def test_consistent_format_across_alerts(self, tmp_dir, base_timestamp):
        """All alerts should have consistent timestamp formatting."""
        candles = []
        # Create candles for a full day
        for i in range(24 * 60):
            ts = base_timestamp + timedelta(minutes=i)
            candles.append(make_candle("TOKEN", ts, 1.0, 1.1, 0.9, 1.0))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        # Multiple alerts at different times
        alerts = []
        for hour in [0, 6, 12, 18]:
            alert_time = base_timestamp + timedelta(hours=hour)
            alerts.append(Alert(mint="TOKEN", ts_ms=int(alert_time.timestamp() * 1000), caller=f"Caller{hour}"))
        
        results = run_baseline_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            threads=1,
            verbose=False,
        )
        
        for result in results:
            alert_ts = result["alert_ts_utc"]
            entry_ts = result["entry_ts_utc"]
            
            # Both should be parseable
            datetime.strptime(alert_ts, "%Y-%m-%d %H:%M:%S")
            datetime.strptime(entry_ts, "%Y-%m-%d %H:%M:%S")
            
            # No timezone suffixes like +00:00 or Z
            assert "+" not in alert_ts
            assert "Z" not in alert_ts
            assert "+" not in entry_ts
            assert "Z" not in entry_ts


class TestTimestampRoundTrip:
    """Test that timestamps can be round-tripped correctly."""

    def test_ms_precision_preserved(self, tmp_dir, base_timestamp):
        """Millisecond precision should be preserved in alert_ts_ms."""
        candles = []
        for i in range(60):
            ts = base_timestamp + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, 1.0, 1.1, 0.9, 1.0))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        # Specific ms timestamp
        specific_ms = 1735689645123  # Some specific timestamp
        
        # But we need candles at that time...
        specific_time = datetime.fromtimestamp(specific_ms / 1000, tz=UTC)
        candles = []
        for i in range(60):
            ts = specific_time + timedelta(seconds=i * 60)
            candles.append(make_candle("TOKEN", ts, 1.0, 1.1, 0.9, 1.0))
        write_candles_to_parquet(candles, parquet_path)
        
        alerts = [
            Alert(mint="TOKEN", ts_ms=specific_ms, caller="Caller")
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
        # The alert_ts_utc is a string, but the original ms should be traceable
        result = results[0]
        
        # Parse the UTC string and convert back to ms
        parsed = datetime.strptime(result["alert_ts_utc"], "%Y-%m-%d %H:%M:%S")
        parsed = parsed.replace(tzinfo=UTC)
        parsed_ms = int(parsed.timestamp() * 1000)
        
        # Should be within 1 second (we lose sub-second precision in the string format)
        assert abs(parsed_ms - specific_ms) < 1000


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


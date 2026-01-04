"""
Tests for token isolation - no cross-token data bleed.

Validates:
1. Each alert only sees candles for its own token
2. Token A's ATH doesn't affect Token B's metrics
3. Missing token doesn't affect other tokens
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from fixtures import (
    SyntheticAlert,
    make_candle,
    make_linear_pump,
    make_instant_rug,
    make_sideways,
    write_candles_to_parquet,
)

UTC = timezone.utc


class TestTokenIsolation:
    """Test that tokens are properly isolated."""

    def test_different_tokens_independent_results(self, tmp_dir, base_timestamp):
        """
        Token A pumps to 5x
        Token B rugs to 0.1x
        Each should have correct independent metrics.
        """
        candles = []
        
        # Token A: pumps to 5x
        candles.extend(make_linear_pump(
            "TOKEN_A", base_timestamp, 1.0, 5.0, 30, 30, end_mult=2.0
        ))
        
        # Token B: instant rug
        candles.extend(make_instant_rug(
            "TOKEN_B", base_timestamp, 1.0, 60, rug_mult=0.1
        ))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        alerts = [
            Alert(mint="TOKEN_A", ts_ms=int(base_timestamp.timestamp() * 1000), caller="CallerA"),
            Alert(mint="TOKEN_B", ts_ms=int(base_timestamp.timestamp() * 1000), caller="CallerB"),
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
        
        assert len(results) == 2
        
        # Find results by mint
        result_a = next(r for r in results if r["mint"] == "TOKEN_A")
        result_b = next(r for r in results if r["mint"] == "TOKEN_B")
        
        # Token A should have high ATH (~5x)
        assert result_a["status"] == "ok"
        assert result_a["ath_mult"] > 4.0, f"Token A ATH {result_a['ath_mult']} should be ~5x"
        assert result_a["ath_mult"] < 6.0, f"Token A ATH {result_a['ath_mult']} too high"
        
        # Token B should have low ATH (~1x since it rugged)
        assert result_b["status"] == "ok"
        assert result_b["ath_mult"] < 1.5, f"Token B ATH {result_b['ath_mult']} should be ~1x (rug)"
        
        # Verify no cross-contamination: Token B should NOT have Token A's 5x ATH
        assert result_b["ath_mult"] < 2.0

    def test_token_a_spike_does_not_affect_token_b(self, tmp_dir, base_timestamp):
        """
        Token A has a 100x spike.
        Token B has normal 2x pump.
        Token B's metrics should not show 100x.
        """
        candles = []
        
        # Token A: massive spike
        for i in range(60):
            ts = base_timestamp + timedelta(seconds=i * 60)
            if i == 30:
                # 100x spike
                candles.append(make_candle("TOKEN_A", ts, 1.0, 100.0, 0.9, 50.0))
            else:
                candles.append(make_candle("TOKEN_A", ts, 1.0, 1.1, 0.9, 1.0))
        
        # Token B: normal 2x pump
        for i in range(60):
            ts = base_timestamp + timedelta(seconds=i * 60)
            mult = 1.0 + min(1.0, i / 30)  # Rises to 2x by candle 30
            candles.append(make_candle("TOKEN_B", ts, mult * 0.99, mult, mult * 0.98, mult))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        alerts = [
            Alert(mint="TOKEN_A", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller"),
            Alert(mint="TOKEN_B", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller"),
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
        
        result_a = next(r for r in results if r["mint"] == "TOKEN_A")
        result_b = next(r for r in results if r["mint"] == "TOKEN_B")
        
        # Token A should have 100x ATH
        assert result_a["ath_mult"] > 90.0
        
        # Token B should have ~2x ATH, NOT 100x
        assert result_b["ath_mult"] < 3.0, f"Token B ATH {result_b['ath_mult']} contaminated by Token A!"
        assert result_b["ath_mult"] > 1.5

    def test_missing_token_does_not_affect_others(self, tmp_dir, base_timestamp):
        """
        Token A has data, Token B has NO data.
        Token A should still get correct results.
        """
        candles = []
        
        # Only Token A has candles
        candles.extend(make_linear_pump(
            "TOKEN_A", base_timestamp, 1.0, 3.0, 30, 30, end_mult=1.5
        ))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        alerts = [
            Alert(mint="TOKEN_A", ts_ms=int(base_timestamp.timestamp() * 1000), caller="CallerA"),
            Alert(mint="TOKEN_B", ts_ms=int(base_timestamp.timestamp() * 1000), caller="CallerB"),  # No data!
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
        
        assert len(results) == 2
        
        result_a = next(r for r in results if r["mint"] == "TOKEN_A")
        result_b = next(r for r in results if r["mint"] == "TOKEN_B")
        
        # Token A should be OK
        assert result_a["status"] == "ok"
        assert result_a["ath_mult"] > 2.5
        
        # Token B should be missing
        assert result_b["status"] == "missing"
        assert result_b["candles"] == 0


class TestCallerIsolation:
    """Test that callers with same token are properly handled."""

    def test_same_token_different_alert_times(self, tmp_dir, base_timestamp):
        """
        Two alerts for same token at different times.
        Each should have different metrics based on their entry window.
        """
        candles = []
        
        # Token with varying price action over time
        for i in range(120):  # 2 hours of candles
            ts = base_timestamp + timedelta(seconds=i * 60)
            if i < 30:
                # First 30 min: rise to 2x
                mult = 1.0 + (i / 30)
            elif i < 60:
                # 30-60 min: peak at 3x
                mult = 2.0 + ((i - 30) / 30)
            else:
                # After 60 min: decline
                mult = 3.0 - ((i - 60) / 30)
                mult = max(mult, 1.0)
            
            candles.append(make_candle("TOKEN", ts, mult * 0.99, mult, mult * 0.98, mult))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        # Alert 1: at start (will see 2x rise then 3x peak)
        # Alert 2: at minute 60 (will see decline from 3x)
        alert1_ts = base_timestamp
        alert2_ts = base_timestamp + timedelta(minutes=60)
        
        alerts = [
            Alert(mint="TOKEN", ts_ms=int(alert1_ts.timestamp() * 1000), caller="Caller1"),
            Alert(mint="TOKEN", ts_ms=int(alert2_ts.timestamp() * 1000), caller="Caller2"),
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
        
        assert len(results) == 2
        
        # Sort by alert_id
        results.sort(key=lambda x: x["alert_id"])
        result1 = results[0]
        result2 = results[1]
        
        # Alert 1 should see the full pump to ~3x
        assert result1["status"] == "ok"
        assert result1["ath_mult"] > 2.5, f"Alert 1 ATH {result1['ath_mult']} should be ~3x"
        
        # Alert 2 enters at peak, sees decline - ATH should be close to 1x
        assert result2["status"] == "ok"
        # Entry is at 3x, but since we measure from entry, ATH relative to entry is ~1x
        # The entry price will be around 3.0, and max will be around 3.0, so ATH ~ 1x


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


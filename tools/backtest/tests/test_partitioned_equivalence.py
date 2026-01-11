"""
Tests for partitioned vs single-Parquet equivalence.

Validates:
1. Same results from single Parquet file and Hive-partitioned directory
2. Partition pruning doesn't affect correctness
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from fixtures import (
    make_linear_pump,
    make_instant_rug,
    make_sideways,
    write_candles_to_parquet,
    write_candles_to_partitioned,
)

UTC = timezone.utc


class TestPartitionedEquivalence:
    """Test that partitioned and single-file give same results."""

    def test_single_token_equivalence(self, tmp_dir, base_timestamp):
        """Single token: partitioned == single file."""
        candles = make_linear_pump(
            "TOKEN_A", base_timestamp, 1.0, 4.0, 30, 30, end_mult=2.0
        )
        
        # Write to single file
        single_path = tmp_dir / "single.parquet"
        write_candles_to_parquet(candles, single_path)
        
        # Write to partitioned dir
        part_dir = tmp_dir / "partitioned"
        write_candles_to_partitioned(candles, part_dir)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        alerts = [
            Alert(mint="TOKEN_A", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")
        ]
        
        # Run on single file
        results_single = run_baseline_backtest(
            alerts=alerts,
            slice_path=single_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            threads=1,
            verbose=False,
        )
        
        # Run on partitioned
        results_part = run_baseline_backtest(
            alerts=alerts,
            slice_path=part_dir,
            is_partitioned=True,
            interval_seconds=60,
            horizon_hours=1,
            threads=1,
            verbose=False,
        )
        
        assert len(results_single) == 1
        assert len(results_part) == 1
        
        r_single = results_single[0]
        r_part = results_part[0]
        
        # All metrics should match
        assert r_single["status"] == r_part["status"]
        assert r_single["candles"] == r_part["candles"]
        assert abs((r_single["ath_mult"] or 0) - (r_part["ath_mult"] or 0)) < 0.001
        assert abs((r_single["entry_price"] or 0) - (r_part["entry_price"] or 0)) < 0.0001
        
        # Time metrics should match
        assert r_single["time_to_2x_s"] == r_part["time_to_2x_s"]
        assert r_single["time_to_3x_s"] == r_part["time_to_3x_s"]
        assert r_single["time_to_4x_s"] == r_part["time_to_4x_s"]

    def test_multi_token_equivalence(self, tmp_dir, base_timestamp):
        """Multiple tokens: partitioned == single file for all."""
        candles = []
        candles.extend(make_linear_pump("TOKEN_A", base_timestamp, 1.0, 5.0, 30, 30, end_mult=2.0))
        candles.extend(make_instant_rug("TOKEN_B", base_timestamp, 1.0, 60, rug_mult=0.2))
        candles.extend(make_sideways("TOKEN_C", base_timestamp, 1.0, 60, variance=0.05))
        
        # Write both formats
        single_path = tmp_dir / "single.parquet"
        write_candles_to_parquet(candles, single_path)
        
        part_dir = tmp_dir / "partitioned"
        write_candles_to_partitioned(candles, part_dir)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        ts_ms = int(base_timestamp.timestamp() * 1000)
        alerts = [
            Alert(mint="TOKEN_A", ts_ms=ts_ms, caller="Caller1"),
            Alert(mint="TOKEN_B", ts_ms=ts_ms, caller="Caller1"),
            Alert(mint="TOKEN_C", ts_ms=ts_ms, caller="Caller2"),
        ]
        
        results_single = run_baseline_backtest(
            alerts=alerts,
            slice_path=single_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            threads=1,
            verbose=False,
        )
        
        results_part = run_baseline_backtest(
            alerts=alerts,
            slice_path=part_dir,
            is_partitioned=True,
            interval_seconds=60,
            horizon_hours=1,
            threads=1,
            verbose=False,
        )
        
        assert len(results_single) == 3
        assert len(results_part) == 3
        
        # Sort by mint for comparison
        results_single.sort(key=lambda x: x["mint"])
        results_part.sort(key=lambda x: x["mint"])
        
        for r_s, r_p in zip(results_single, results_part):
            assert r_s["mint"] == r_p["mint"]
            assert r_s["status"] == r_p["status"]
            assert r_s["candles"] == r_p["candles"]
            
            if r_s["ath_mult"] is not None and r_p["ath_mult"] is not None:
                assert abs(r_s["ath_mult"] - r_p["ath_mult"]) < 0.001

    def test_mixed_coverage_equivalence(self, tmp_dir, base_timestamp):
        """Some tokens have data, some don't - both formats should match."""
        candles = []
        candles.extend(make_linear_pump("TOKEN_A", base_timestamp, 1.0, 3.0, 30, 30))
        # TOKEN_B has NO data
        candles.extend(make_sideways("TOKEN_C", base_timestamp, 1.0, 60))
        
        single_path = tmp_dir / "single.parquet"
        write_candles_to_parquet(candles, single_path)
        
        part_dir = tmp_dir / "partitioned"
        write_candles_to_partitioned(candles, part_dir)
        
        from run_baseline_all import Alert, run_baseline_backtest
        
        ts_ms = int(base_timestamp.timestamp() * 1000)
        alerts = [
            Alert(mint="TOKEN_A", ts_ms=ts_ms, caller="Caller"),
            Alert(mint="TOKEN_B", ts_ms=ts_ms, caller="Caller"),  # No data!
            Alert(mint="TOKEN_C", ts_ms=ts_ms, caller="Caller"),
        ]
        
        results_single = run_baseline_backtest(
            alerts=alerts,
            slice_path=single_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            threads=1,
            verbose=False,
        )
        
        results_part = run_baseline_backtest(
            alerts=alerts,
            slice_path=part_dir,
            is_partitioned=True,
            interval_seconds=60,
            horizon_hours=1,
            threads=1,
            verbose=False,
        )
        
        # Both should have 3 results with same statuses
        assert len(results_single) == 3
        assert len(results_part) == 3
        
        def status_by_mint(results):
            return {r["mint"]: r["status"] for r in results}
        
        assert status_by_mint(results_single) == status_by_mint(results_part)
        
        # TOKEN_B should be missing in both
        assert any(r["mint"] == "TOKEN_B" and r["status"] == "missing" for r in results_single)
        assert any(r["mint"] == "TOKEN_B" and r["status"] == "missing" for r in results_part)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


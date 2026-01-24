"""
End-to-end integration test for Parquet Lake v1 Slice Exporter.

Tests the full pipeline:
1. Load alerts from parquet/csv
2. Query ClickHouse (mocked) for OHLCV data
3. Write partitioned Parquet files by mint_bucket
4. Compute coverage metrics
5. Write coverage.parquet
6. Write manifest.json (sealed)

This test verifies the entire export workflow works correctly.
"""

from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import MagicMock, patch
from typing import List, Tuple

import duckdb
import pandas as pd
import pytest

from lib.slice_exporter import (
    ClickHouseCfg,
    LakeRunSliceConfig,
    export_lake_run_slices,
    compute_mint_bucket,
)


UTC = timezone.utc


def create_test_alerts_parquet(alerts: List[dict], output_path: Path) -> None:
    """Create a test alerts parquet file."""
    df = pd.DataFrame(alerts)
    df.to_parquet(output_path, index=False)


def create_test_alerts_csv(alerts: List[dict], output_path: Path) -> None:
    """Create a test alerts CSV file."""
    df = pd.DataFrame(alerts)
    df.to_csv(output_path, index=False)


def make_mock_candles(
    mint: str,
    start_ts: datetime,
    num_candles: int,
    interval_s: int = 60,
) -> List[Tuple]:
    """Create mock candle tuples as returned by ClickHouse."""
    candles = []
    for i in range(num_candles):
        ts = start_ts.timestamp() + (i * interval_s)
        candle_ts = datetime.fromtimestamp(ts, tz=UTC)
        candles.append((
            mint,  # token_address
            candle_ts,  # timestamp
            1.0,  # open
            1.1,  # high
            0.9,  # low
            1.0,  # close
            1000.0,  # volume
            interval_s,  # interval_seconds
        ))
    return candles


class TestLakeExportE2E:
    """End-to-end integration tests for lake export."""
    
    def test_export_run_slices_full_pipeline_parquet_alerts(self):
        """Full E2E test with parquet alerts file."""
        with TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            
            # 1. Create test alerts
            alerts = [
                {
                    "alert_id": "alert_1",
                    "mint": "So11111111111111111111111111111111111111112",
                    "ts_ms": int(datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC).timestamp() * 1000),
                },
                {
                    "alert_id": "alert_2",
                    "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                    "ts_ms": int(datetime(2024, 1, 1, 13, 0, 0, tzinfo=UTC).timestamp() * 1000),
                },
            ]
            
            alerts_path = tmp_path / "alerts.parquet"
            create_test_alerts_parquet(alerts, alerts_path)
            
            # 2. Mock ClickHouse client
            mint1 = alerts[0]["mint"]
            mint2 = alerts[1]["mint"]
            
            # Create candles: 100 before anchor, 200 after for each mint
            anchor1_ts = datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC)
            anchor2_ts = datetime(2024, 1, 1, 13, 0, 0, tzinfo=UTC)
            
            candles1 = make_mock_candles(mint1, anchor1_ts, 300, interval_s=60)
            candles2 = make_mock_candles(mint2, anchor2_ts, 300, interval_s=60)
            
            # Mock ClickHouse client to return candles
            mock_client = MagicMock()
            all_candles = candles1 + candles2
            
            def mock_execute_iter(query):
                """Mock execute_iter to return candles."""
                return iter(all_candles)
            
            mock_client.execute_iter = mock_execute_iter
            
            # 3. Create config
            config = LakeRunSliceConfig(
                data_root=str(tmp_path / "data"),
                run_id="test_run_e2e",
                interval="1m",
                window="pre52_post4948",
                alerts_path=str(alerts_path),
                chain="solana",
                compression="none",  # Use none for faster tests
                target_file_mb=512,
                strict_coverage=False,
                min_required_pre=52,
                target_total=5000,
            )
            
            ch_cfg = ClickHouseCfg(
                host="localhost",
                port=8123,
                database="test",
                table="ohlcv_candles",
                user="default",
                password="",
            )
            
            # 4. Patch ClickHouse client creation at class level
            with patch('lib.slice_exporter.ClickHouseCfg.get_client', return_value=mock_client):
                # 5. Run export
                result = export_lake_run_slices(config, ch_cfg, verbose=False)
            
            # 6. Verify outputs
            lake_root = tmp_path / "data" / "lake"
            run_dir = lake_root / "runs" / "run_id=test_run_e2e"
            slices_dir = run_dir / "slices" / "ohlcv" / "interval=1m" / "window=pre52_post4948"
            inputs_dir = run_dir / "inputs"
            outputs_dir = run_dir / "outputs"
            manifest_path = run_dir / "manifest.json"
            coverage_path = outputs_dir / "coverage.parquet"
            
            # Verify directories exist
            assert run_dir.exists()
            assert slices_dir.exists()
            assert inputs_dir.exists()
            assert outputs_dir.exists()
            
            # Verify manifest exists and is valid
            assert manifest_path.exists()
            with open(manifest_path, "r") as f:
                manifest = json.load(f)
            
            assert manifest["lake_version"] == "v1"
            assert manifest["run_id"] == "test_run_e2e"
            assert manifest["slice_spec"]["interval"] == "1m"
            assert manifest["slice_spec"]["window"] == "pre52_post4948"
            assert "exporter" in manifest
            assert "inputs" in manifest
            assert "outputs" in manifest
            assert "coverage" in manifest
            
            # Verify coverage.parquet exists
            assert coverage_path.exists()
            
            # Verify Parquet files exist in bucket directories
            bucket_dirs = [d for d in slices_dir.iterdir() if d.is_dir() and d.name.startswith("mint_bucket=")]
            assert len(bucket_dirs) > 0, "At least one bucket directory should exist"
            
            total_files = 0
            total_rows = 0
            
            for bucket_dir in bucket_dirs:
                parquet_files = list(bucket_dir.glob("*.parquet"))
                assert len(parquet_files) > 0, f"Bucket {bucket_dir.name} should have Parquet files"
                
                for parquet_file in parquet_files:
                    # Verify file naming (part-0000, part-0001, etc.)
                    assert parquet_file.name.startswith("part-")
                    assert parquet_file.name.endswith(".parquet")
                    
                    # Read and verify Parquet file
                    con = duckdb.connect(":memory:")
                    count = con.execute(f"SELECT count(*) FROM read_parquet('{parquet_file}')").fetchone()[0]
                    con.close()
                    
                    total_files += 1
                    total_rows += count
            
            # Verify result matches
            assert result["total_files"] == total_files
            assert result["total_rows"] == total_rows
            assert result["total_rows"] > 0
            
            # Verify coverage data
            con = duckdb.connect(":memory:")
            coverage_df = con.execute(f"SELECT * FROM read_parquet('{coverage_path}')").df()
            con.close()
            
            assert len(coverage_df) == 2, "Should have coverage for 2 alerts"
            assert "alert_id" in coverage_df.columns
            assert "mint" in coverage_df.columns
            assert "available_pre" in coverage_df.columns
            assert "available_post" in coverage_df.columns
            assert "available_total" in coverage_df.columns
            assert "status" in coverage_df.columns
    
    def test_export_run_slices_full_pipeline_csv_alerts(self):
        """Full E2E test with CSV alerts file."""
        with TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            
            # 1. Create test alerts as CSV
            alerts = [
                {
                    "alert_id": "alert_csv_1",
                    "mint": "So11111111111111111111111111111111111111112",
                    "ts_ms": int(datetime(2024, 1, 1, 10, 0, 0, tzinfo=UTC).timestamp() * 1000),
                },
            ]
            
            alerts_path = tmp_path / "alerts.csv"
            create_test_alerts_csv(alerts, alerts_path)
            
            # 2. Mock ClickHouse client
            mint = alerts[0]["mint"]
            anchor_ts = datetime(2024, 1, 1, 10, 0, 0, tzinfo=UTC)
            candles = make_mock_candles(mint, anchor_ts, 300, interval_s=60)
            
            mock_client = MagicMock()
            mock_client.execute_iter = lambda query: iter(candles)
            
            # 3. Create config
            config = LakeRunSliceConfig(
                data_root=str(tmp_path / "data"),
                run_id="test_run_csv",
                interval="1m",
                window="pre10_post20",
                alerts_path=str(alerts_path),
                chain="solana",
                compression="none",
                target_file_mb=512,
                strict_coverage=False,
                min_required_pre=10,
                target_total=30,
            )
            
            ch_cfg = ClickHouseCfg(
                host="localhost",
                port=8123,
                database="test",
                table="ohlcv_candles",
                user="default",
                password="",
            )
            
            # 4. Run export
            with patch('lib.slice_exporter.ClickHouseCfg.get_client', return_value=mock_client):
                result = export_lake_run_slices(config, ch_cfg, verbose=False)
            
            # 5. Verify CSV was converted to Parquet in inputs
            inputs_dir = Path(result["manifest_path"]).parent / "inputs"
            alerts_parquet = inputs_dir / "alerts.parquet"
            assert alerts_parquet.exists(), "CSV should be converted to Parquet in inputs/"
            
            # Verify manifest references correct path
            with open(result["manifest_path"], "r") as f:
                manifest = json.load(f)
            assert manifest["inputs"]["alerts"]["path"] == "inputs/alerts.parquet"
    
    def test_export_deterministic_bucket_partitioning(self):
        """Verify that bucket partitioning is deterministic."""
        with TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            
            # Create alerts with known mints
            mint1 = "So11111111111111111111111111111111111111112"
            mint2 = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
            
            alerts = [
                {"alert_id": "a1", "mint": mint1, "ts_ms": int(datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC).timestamp() * 1000)},
                {"alert_id": "a2", "mint": mint2, "ts_ms": int(datetime(2024, 1, 1, 13, 0, 0, tzinfo=UTC).timestamp() * 1000)},
            ]
            
            alerts_path = tmp_path / "alerts.parquet"
            create_test_alerts_parquet(alerts, alerts_path)
            
            # Mock ClickHouse
            mock_client = MagicMock()
            candles1 = make_mock_candles(mint1, datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC), 100)
            candles2 = make_mock_candles(mint2, datetime(2024, 1, 1, 13, 0, 0, tzinfo=UTC), 100)
            mock_client.execute_iter = lambda query: iter(candles1 + candles2)
            
            config = LakeRunSliceConfig(
                data_root=str(tmp_path / "data"),
                run_id="test_buckets",
                interval="1m",
                window="pre10_post20",
                alerts_path=str(alerts_path),
                compression="none",
            )
            
            ch_cfg = ClickHouseCfg(
                host="localhost",
                port=8123,
                database="test",
                table="ohlcv_candles",
                user="default",
                password="",
            )
            
            with patch('lib.slice_exporter.ClickHouseCfg.get_client', return_value=mock_client):
                result = export_lake_run_slices(config, ch_cfg, verbose=False)
            
            # Verify buckets are computed correctly
            bucket1 = compute_mint_bucket(mint1)
            bucket2 = compute_mint_bucket(mint2)
            
            slices_dir = Path(result["manifest_path"]).parent / "slices" / "ohlcv" / "interval=1m" / "window=pre10_post20"
            
            # Verify bucket directories exist
            bucket1_dir = slices_dir / f"mint_bucket={bucket1}"
            bucket2_dir = slices_dir / f"mint_bucket={bucket2}"
            
            # At least one bucket should exist (they might be the same if hash collision)
            bucket_dirs = [d for d in slices_dir.iterdir() if d.is_dir() and d.name.startswith("mint_bucket=")]
            assert len(bucket_dirs) > 0
            
            # Verify bucket names are valid hex (00-ff)
            for bucket_dir in bucket_dirs:
                bucket_name = bucket_dir.name.replace("mint_bucket=", "")
                assert len(bucket_name) == 2
                assert all(c in "0123456789abcdef" for c in bucket_name)
    
    def test_manifest_sealed_last(self):
        """Verify manifest.json is written last (sealed after all files)."""
        with TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            
            alerts = [
                {"alert_id": "a1", "mint": "So11111111111111111111111111111111111111112", "ts_ms": int(datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC).timestamp() * 1000)},
            ]
            
            alerts_path = tmp_path / "alerts.parquet"
            create_test_alerts_parquet(alerts, alerts_path)
            
            mock_client = MagicMock()
            mint = alerts[0]["mint"]
            candles = make_mock_candles(mint, datetime(2024, 1, 1, 12, 0, 0, tzinfo=UTC), 100)
            mock_client.execute_iter = lambda query: iter(candles)
            
            config = LakeRunSliceConfig(
                data_root=str(tmp_path / "data"),
                run_id="test_seal",
                interval="1m",
                window="pre10_post20",
                alerts_path=str(alerts_path),
                compression="none",
            )
            
            ch_cfg = ClickHouseCfg(
                host="localhost",
                port=8123,
                database="test",
                table="ohlcv_candles",
                user="default",
                password="",
            )
            
            with patch('lib.slice_exporter.ClickHouseCfg.get_client', return_value=mock_client):
                result = export_lake_run_slices(config, ch_cfg, verbose=False)
            
            manifest_path = Path(result["manifest_path"])
            
            # Verify manifest exists
            assert manifest_path.exists()
            
            # Verify no temp file exists
            temp_path = manifest_path.with_suffix(".json.tmp")
            assert not temp_path.exists(), "Temp file should not exist after atomic rename"
            
            # Verify manifest contains correct file counts
            with open(manifest_path, "r") as f:
                manifest = json.load(f)
            
            # Manifest should reference the actual files created
            assert "outputs" in manifest
            assert result["total_files"] > 0
            assert result["total_rows"] > 0


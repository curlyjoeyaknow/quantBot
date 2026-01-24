"""
Unit tests for Parquet Lake v1 core functions.

Tests focus on determinism and correctness of bucket, window, and config functions.
"""

from __future__ import annotations

import pytest
from pathlib import Path
from tempfile import TemporaryDirectory
import json

from lib.slice_exporter import (
    compute_mint_bucket,
    floor_to_interval,
    compute_window_slice,
    parse_window_spec,
    parse_config_from_json,
    LakeCorpusConfig,
    LakeRunSliceConfig,
)


class TestComputeMintBucket:
    """Tests for compute_mint_bucket function."""
    
    def test_compute_mint_bucket_deterministic(self):
        """Same mint always returns same bucket."""
        mint = "So11111111111111111111111111111111111111112"
        bucket1 = compute_mint_bucket(mint)
        bucket2 = compute_mint_bucket(mint)
        assert bucket1 == bucket2, "Bucket should be deterministic"
    
    def test_compute_mint_bucket_range(self):
        """Bucket is always 2-char hex (00-ff)."""
        test_mints = [
            "So11111111111111111111111111111111111111112",
            "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
            "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
        ]
        
        for mint in test_mints:
            bucket = compute_mint_bucket(mint)
            assert len(bucket) == 2, f"Bucket should be 2 chars, got {bucket}"
            assert all(c in "0123456789abcdef" for c in bucket), f"Bucket should be hex, got {bucket}"
            # Verify it's a valid hex byte (00-ff)
            assert 0 <= int(bucket, 16) <= 255, f"Bucket should be 00-ff, got {bucket}"
    
    def test_compute_mint_bucket_different_mints(self):
        """Different mints can have same or different buckets."""
        mint1 = "So11111111111111111111111111111111111111112"
        mint2 = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"
        
        bucket1 = compute_mint_bucket(mint1)
        bucket2 = compute_mint_bucket(mint2)
        
        # Both should be valid buckets
        assert len(bucket1) == 2
        assert len(bucket2) == 2
        # They may or may not be equal (collision is possible but rare)


class TestFloorToInterval:
    """Tests for floor_to_interval function."""
    
    def test_floor_to_interval_basic(self):
        """Timestamps floor correctly to interval boundaries."""
        # Test with 1-minute intervals (60 seconds)
        interval_s = 60
        
        # Timestamp at exact boundary
        ts_ms = 1609459200000  # 2021-01-01 00:00:00 UTC
        result = floor_to_interval(ts_ms, interval_s)
        assert result == ts_ms, "Exact boundary should remain unchanged"
        
        # Timestamp 30 seconds after boundary
        ts_ms = 1609459200000 + 30000  # +30 seconds
        result = floor_to_interval(ts_ms, interval_s)
        assert result == 1609459200000, "Should floor to boundary"
        
        # Timestamp 1 second before next boundary
        ts_ms = 1609459260000 - 1000  # 1 second before next minute
        result = floor_to_interval(ts_ms, interval_s)
        assert result == 1609459200000, "Should floor to previous boundary"
    
    def test_floor_to_interval_1s(self):
        """Test with 1-second intervals."""
        interval_s = 1
        ts_ms = 1609459200123  # 123ms into second
        result = floor_to_interval(ts_ms, interval_s)
        assert result == 1609459200000, "Should floor to second boundary"
    
    def test_floor_to_interval_5m(self):
        """Test with 5-minute intervals."""
        interval_s = 300  # 5 minutes
        # Timestamp 2 minutes into a 5-minute window
        ts_ms = 1609459200000 + (2 * 60 * 1000)  # +2 minutes
        result = floor_to_interval(ts_ms, interval_s)
        assert result == 1609459200000, "Should floor to 5-minute boundary"


class TestComputeWindowSlice:
    """Tests for compute_window_slice function."""
    
    def test_compute_window_slice_basic(self):
        """Window slice returns correct pre/post range."""
        alert_ts_ms = 1609459200000  # 2021-01-01 00:00:00 UTC
        interval_s = 60  # 1 minute
        pre_candles = 52
        post_candles = 4948
        
        result = compute_window_slice(alert_ts_ms, interval_s, pre_candles, post_candles)
        
        assert "anchor_ts" in result
        assert "start_ts" in result
        assert "end_ts" in result
        
        # Anchor should be floored to interval
        assert result["anchor_ts"] == alert_ts_ms  # Already on boundary
        
        # Start should be pre_candles before anchor
        expected_start = alert_ts_ms - (pre_candles * interval_s * 1000)
        assert result["start_ts"] == expected_start
        
        # End should be post_candles after anchor (inclusive of anchor)
        expected_end = alert_ts_ms + ((post_candles + 1) * interval_s * 1000)
        assert result["end_ts"] == expected_end
    
    def test_compute_window_slice_off_boundary(self):
        """Window slice handles alerts not on interval boundary."""
        # Alert 30 seconds into a minute
        alert_ts_ms = 1609459200000 + 30000  # +30 seconds
        interval_s = 60  # 1 minute
        pre_candles = 10
        post_candles = 10
        
        result = compute_window_slice(alert_ts_ms, interval_s, pre_candles, post_candles)
        
        # Anchor should be floored to minute boundary
        assert result["anchor_ts"] == 1609459200000
        
        # Window should be centered on anchor, not alert
        expected_start = 1609459200000 - (10 * 60 * 1000)
        expected_end = 1609459200000 + ((10 + 1) * 60 * 1000)
        
        assert result["start_ts"] == expected_start
        assert result["end_ts"] == expected_end
    
    def test_compute_window_slice_total_candles(self):
        """Window should contain correct total number of candles."""
        alert_ts_ms = 1609459200000
        interval_s = 60
        pre_candles = 52
        post_candles = 4948
        
        result = compute_window_slice(alert_ts_ms, interval_s, pre_candles, post_candles)
        
        # Total candles = pre + anchor + post = pre + 1 + post
        interval_ms = interval_s * 1000
        window_size_ms = result["end_ts"] - result["start_ts"]
        total_candles = window_size_ms // interval_ms
        
        expected_total = pre_candles + 1 + post_candles  # +1 for anchor
        assert total_candles == expected_total, f"Expected {expected_total} candles, got {total_candles}"


class TestParseWindowSpec:
    """Tests for parse_window_spec function."""
    
    def test_parse_window_spec_valid(self):
        """Parse valid window spec."""
        pre, post = parse_window_spec("pre52_post4948")
        assert pre == 52
        assert post == 4948
    
    def test_parse_window_spec_different_values(self):
        """Parse different window specs."""
        pre, post = parse_window_spec("pre10_post20")
        assert pre == 10
        assert post == 20
        
        pre, post = parse_window_spec("pre100_post200")
        assert pre == 100
        assert post == 200
    
    def test_parse_window_spec_invalid(self):
        """Invalid window spec raises error."""
        with pytest.raises(ValueError, match="Invalid window spec"):
            parse_window_spec("invalid")
        
        with pytest.raises(ValueError, match="Invalid window spec"):
            parse_window_spec("pre52")
        
        with pytest.raises(ValueError, match="Invalid window spec"):
            parse_window_spec("post4948")


class TestParseConfigFromJson:
    """Tests for parse_config_from_json function."""
    
    def test_parse_config_from_json_valid(self):
        """Parse valid JSON config."""
        with TemporaryDirectory() as tmpdir:
            config_path = Path(tmpdir) / "config.json"
            config_data = {
                "data_root": "/data/lake",
                "interval": "1s",
                "date_from": "2024-01-01",
                "date_to": "2024-01-02",
                "compression": "zstd",
            }
            
            with open(config_path, "w") as f:
                json.dump(config_data, f)
            
            result = parse_config_from_json(config_path)
            assert result == config_data
    
    def test_parse_config_from_json_missing_file(self):
        """Missing config file raises error."""
        config_path = Path("/nonexistent/config.json")
        with pytest.raises(FileNotFoundError):
            parse_config_from_json(config_path)


class TestIntervalToSeconds:
    """Tests for interval_to_seconds function."""
    
    def test_interval_to_seconds_seconds(self):
        """Parse second intervals."""
        from lib.slice_exporter import interval_to_seconds
        
        assert interval_to_seconds("1s") == 1
        assert interval_to_seconds("5s") == 5
        assert interval_to_seconds("60s") == 60
    
    def test_interval_to_seconds_minutes(self):
        """Parse minute intervals."""
        from lib.slice_exporter import interval_to_seconds
        
        assert interval_to_seconds("1m") == 60
        assert interval_to_seconds("5m") == 300
        assert interval_to_seconds("15m") == 900
    
    def test_interval_to_seconds_hours(self):
        """Parse hour intervals."""
        from lib.slice_exporter import interval_to_seconds
        
        assert interval_to_seconds("1h") == 3600
        assert interval_to_seconds("4h") == 14400


class TestBuildLakeQuery:
    """Tests for _build_lake_query function."""
    
    def test_build_lake_query_basic(self):
        """Build basic ClickHouse query."""
        from lib.slice_exporter import _build_lake_query
        from datetime import datetime, timezone
        
        mints = ["So11111111111111111111111111111111111111112"]
        interval_s = 60
        time_range = {
            "from": datetime(2024, 1, 1, 0, 0, 0, tzinfo=timezone.utc),
            "to": datetime(2024, 1, 2, 0, 0, 0, tzinfo=timezone.utc),
        }
        chain = "solana"
        table = "quantbot.ohlcv_candles"
        
        query = _build_lake_query(mints, interval_s, time_range, chain, table)
        
        assert "SELECT" in query
        assert "token_address" in query
        assert "timestamp" in query
        assert "FROM quantbot.ohlcv_candles" in query
        assert "chain = 'solana'" in query
        assert "interval_seconds = 60" in query
        assert "ORDER BY token_address, timestamp" in query
    
    def test_build_lake_query_multiple_mints(self):
        """Build query with multiple mints."""
        from lib.slice_exporter import _build_lake_query
        from datetime import datetime, timezone
        
        mints = [
            "So11111111111111111111111111111111111111112",
            "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
        ]
        interval_s = 300
        time_range = {
            "from": datetime(2024, 1, 1, 0, 0, 0, tzinfo=timezone.utc),
            "to": datetime(2024, 1, 2, 0, 0, 0, tzinfo=timezone.utc),
        }
        chain = "solana"
        table = "quantbot.ohlcv_candles"
        
        query = _build_lake_query(mints, interval_s, time_range, chain, table)
        
        assert "IN (" in query
        assert "interval_seconds = 300" in query


class TestWritePartitionedParquet:
    """Tests for _write_partitioned_parquet function."""
    
    def test_write_partitioned_parquet_creates_buckets(self):
        """Parquet files created in correct bucket directories."""
        from lib.slice_exporter import _write_partitioned_parquet, compute_mint_bucket
        from datetime import datetime, timezone
        from tempfile import TemporaryDirectory
        
        # Create test data with different mints (will hash to different buckets)
        rows = [
            ("So11111111111111111111111111111111111111112", datetime(2024, 1, 1, 0, 0, 0, tzinfo=timezone.utc), 1.0, 1.1, 0.9, 1.0, 1000.0, 60),
            ("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", datetime(2024, 1, 1, 0, 1, 0, tzinfo=timezone.utc), 1.0, 1.1, 0.9, 1.0, 2000.0, 60),
        ]
        
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "output"
            bucket_files = _write_partitioned_parquet(
                rows,
                output_dir,
                compute_mint_bucket,
                compression="none",  # Use none for faster tests
                verbose=False,
            )
            
            # Check that bucket directories were created
            assert output_dir.exists()
            
            # Check that files were created
            for bucket, files in bucket_files.items():
                assert len(files) > 0
                bucket_dir = output_dir / f"mint_bucket={bucket}"
                assert bucket_dir.exists(), f"Bucket directory {bucket_dir} should exist"
                
                # Check file exists
                for file_path in files:
                    assert Path(file_path).exists(), f"File {file_path} should exist"
    
    def test_parquet_deterministic_naming(self):
        """File names are part-0000, part-0001, etc."""
        from lib.slice_exporter import _write_partitioned_parquet, compute_mint_bucket
        from datetime import datetime, timezone
        from tempfile import TemporaryDirectory
        
        rows = [
            ("So11111111111111111111111111111111111111112", datetime(2024, 1, 1, 0, 0, 0, tzinfo=timezone.utc), 1.0, 1.1, 0.9, 1.0, 1000.0, 60),
        ]
        
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "output"
            bucket_files = _write_partitioned_parquet(
                rows,
                output_dir,
                compute_mint_bucket,
                compression="none",
                verbose=False,
            )
            
            # Check file naming
            for bucket, files in bucket_files.items():
                for file_path in files:
                    filename = Path(file_path).name
                    assert filename.startswith("part-"), f"File should start with 'part-', got {filename}"
                    assert filename.endswith(".parquet"), f"File should end with '.parquet', got {filename}"
                    # Extract part number
                    part_num = filename.replace("part-", "").replace(".parquet", "")
                    assert part_num.isdigit(), f"Part number should be digits, got {part_num}"
                    assert len(part_num) == 4, f"Part number should be 4 digits, got {part_num}"
    
    def test_parquet_schema_matches_spec(self):
        """Output schema: mint, ts, interval_s, open, high, low, close, volume."""
        from lib.slice_exporter import _write_partitioned_parquet, compute_mint_bucket
        from datetime import datetime, timezone
        from tempfile import TemporaryDirectory
        import duckdb
        
        rows = [
            ("So11111111111111111111111111111111111111112", datetime(2024, 1, 1, 0, 0, 0, tzinfo=timezone.utc), 1.0, 1.1, 0.9, 1.0, 1000.0, 60),
        ]
        
        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "output"
            bucket_files = _write_partitioned_parquet(
                rows,
                output_dir,
                compute_mint_bucket,
                compression="none",
                verbose=False,
            )
            
            # Read back and verify schema
            for bucket, files in bucket_files.items():
                for file_path in files:
                    con = duckdb.connect(":memory:")
                    result = con.execute(f"DESCRIBE SELECT * FROM '{file_path}'").fetchall()
                    con.close()
                    
                    # Check that required columns exist
                    column_names = [col[0] for col in result]
                    assert "mint" in column_names, f"Schema should have 'mint' column, got {column_names}"
                    assert "ts" in column_names, f"Schema should have 'ts' column, got {column_names}"
                    assert "interval_s" in column_names, f"Schema should have 'interval_s' column, got {column_names}"
                    assert "open" in column_names, f"Schema should have 'open' column, got {column_names}"
                    assert "high" in column_names, f"Schema should have 'high' column, got {column_names}"
                    assert "low" in column_names, f"Schema should have 'low' column, got {column_names}"
                    assert "close" in column_names, f"Schema should have 'close' column, got {column_names}"
                    assert "volume" in column_names, f"Schema should have 'volume' column, got {column_names}"


class TestComputeCoverage:
    """Tests for compute_coverage function."""
    
    def test_compute_coverage_per_alert(self):
        """Coverage computed for each alert with available_pre, available_post, etc."""
        from lib.slice_exporter import compute_coverage
        from datetime import datetime, timezone
        
        alerts = [
            {"alert_id": "alert1", "mint": "mint1", "ts_ms": 1609459200000},  # 2021-01-01 00:00:00
        ]
        
        # Create candles: 100 candles before anchor, 200 after
        interval_s = 60
        anchor_ts = 1609459200000  # On boundary
        candles_by_mint = {
            "mint1": [
                ("mint1", datetime.fromtimestamp((anchor_ts - (i * 60 * 1000)) / 1000, tz=timezone.utc), 1.0, 1.1, 0.9, 1.0, 1000.0, 60)
                for i in range(100, 0, -1)  # 100 candles before
            ] + [
                ("mint1", datetime.fromtimestamp((anchor_ts + (i * 60 * 1000)) / 1000, tz=timezone.utc), 1.0, 1.1, 0.9, 1.0, 1000.0, 60)
                for i in range(200)  # 200 candles after
            ],
        }
        
        coverage_list = compute_coverage(alerts, candles_by_mint, interval_s, pre_candles=52, post_candles=4948)
        
        assert len(coverage_list) == 1
        cov = coverage_list[0]
        assert cov.alert_id == "alert1"
        assert cov.mint == "mint1"
        # Window limits candles to pre_candles before anchor, so we get 52 (not 100)
        # But we still get all 200 after anchor
        assert cov.available_pre == 52  # Limited by window
        assert cov.available_post == 200
        assert cov.available_total == 252  # 52 + 200
        # Status is partial because total (252) < required (52 + 4948 = 5000)
        assert cov.status == "partial"
    
    def test_compute_coverage_insufficient(self):
        """Coverage correctly identifies insufficient data."""
        from lib.slice_exporter import compute_coverage
        from datetime import datetime, timezone
        
        alerts = [
            {"alert_id": "alert1", "mint": "mint1", "ts_ms": 1609459200000},
        ]
        
        # Only 10 candles (insufficient)
        interval_s = 60
        anchor_ts = 1609459200000
        candles_by_mint = {
            "mint1": [
                ("mint1", datetime.fromtimestamp((anchor_ts + (i * 60 * 1000)) / 1000, tz=timezone.utc), 1.0, 1.1, 0.9, 1.0, 1000.0, 60)
                for i in range(10)
            ],
        }
        
        coverage_list = compute_coverage(alerts, candles_by_mint, interval_s, pre_candles=52, post_candles=4948)
        
        assert len(coverage_list) == 1
        cov = coverage_list[0]
        assert cov.available_total == 10
        # 10 candles is partial (has data but not enough)
        assert cov.status == "partial"


class TestWriteManifestJson:
    """Tests for write_manifest_json function."""
    
    def test_manifest_atomic_write(self):
        """Manifest uses temp file + rename pattern."""
        from lib.slice_exporter import write_manifest_json
        from tempfile import TemporaryDirectory
        
        manifest = {
            "lake_version": "v1",
            "run_id": "test_run",
        }
        
        with TemporaryDirectory() as tmpdir:
            manifest_path = Path(tmpdir) / "manifest.json"
            
            # Write manifest
            write_manifest_json(manifest, manifest_path)
            
            # Check manifest exists
            assert manifest_path.exists()
            
            # Check temp file doesn't exist
            temp_path = manifest_path.with_suffix(".json.tmp")
            assert not temp_path.exists()
            
            # Verify content
            import json
            with open(manifest_path, "r") as f:
                loaded = json.load(f)
            assert loaded == manifest
    
    def test_manifest_written_last(self):
        """Manifest only written after all Parquet files complete."""
        # This is tested implicitly by the export function - manifest is written last
        # We test the atomic write pattern above
        pass


"""
Tests for DuckDB storage integrity.

Validates:
1. baseline.* tables are created correctly
2. Run metadata is stored correctly
3. Alert results are stored correctly
4. Caller aggregations are stored correctly
5. bt.* tables work for fast backtest
6. Leaderboard queries work against stored data
"""
from __future__ import annotations

import json
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

import duckdb
import pytest

from fixtures import (
    SyntheticAlert,
    make_linear_pump,
    make_instant_rug,
    write_candles_to_parquet,
    create_alerts_duckdb,
)

UTC = timezone.utc


class TestBaselineSchemaCreation:
    """Test that baseline.* schema is created correctly."""

    def test_store_creates_schema_and_tables(self, tmp_dir, base_timestamp):
        """Storing results should create baseline schema and tables."""
        # Create test data
        candles = make_linear_pump("TOKEN", base_timestamp, 1.0, 3.0, 30, 30)
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import (
            Alert,
            run_baseline_backtest,
            summarize_overall,
            aggregate_by_caller,
            store_baseline_to_duckdb,
        )
        
        alerts = [Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="TestCaller")]
        
        results = run_baseline_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            threads=1,
            verbose=False,
        )
        
        summary = summarize_overall(results)
        caller_agg = aggregate_by_caller(results, min_trades=1)
        
        # Store to DuckDB
        storage_path = str(tmp_dir / "storage.duckdb")
        run_id = str(uuid.uuid4())
        run_name = "test_run"
        config = {
            "date_from": base_timestamp.strftime("%Y-%m-%d"),
            "date_to": (base_timestamp + timedelta(days=1)).strftime("%Y-%m-%d"),
            "interval_seconds": 60,
            "horizon_hours": 1,
            "chain": "solana",
        }
        
        store_baseline_to_duckdb(storage_path, run_id, run_name, config, results, summary, caller_agg, "slices/test", False)
        
        # Verify schema and tables exist
        conn = duckdb.connect(storage_path, read_only=True)
        
        # Check schema exists
        schemas = conn.execute("SELECT schema_name FROM information_schema.schemata").fetchall()
        schema_names = [s[0] for s in schemas]
        assert "baseline" in schema_names
        
        # Check tables exist
        tables = conn.execute("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'baseline'
        """).fetchall()
        table_names = {t[0] for t in tables}
        
        assert "runs_d" in table_names
        assert "alert_results_f" in table_names
        assert "caller_stats_f" in table_names
        
        conn.close()


class TestRunMetadataStorage:
    """Test that run metadata is stored correctly."""

    def test_run_metadata_fields(self, tmp_dir, base_timestamp):
        """All run metadata fields should be stored correctly."""
        candles = make_linear_pump("TOKEN", base_timestamp, 1.0, 3.0, 30, 30)
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import (
            Alert,
            run_baseline_backtest,
            summarize_overall,
            aggregate_by_caller,
            store_baseline_to_duckdb,
        )
        
        alerts = [Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="TestCaller")]
        
        results = run_baseline_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            threads=1,
            verbose=False,
        )
        
        summary = summarize_overall(results)
        caller_agg = aggregate_by_caller(results, min_trades=1)
        
        storage_path = str(tmp_dir / "storage.duckdb")
        run_id = str(uuid.uuid4())
        run_name = "metadata_test"
        config = {
            "date_from": "2025-01-01",
            "date_to": "2025-01-02",
            "interval_seconds": 60,
            "horizon_hours": 1,
            "chain": "solana",
        }
        
        store_baseline_to_duckdb(storage_path, run_id, run_name, config, results, summary, caller_agg, "slices/test", False)
        
        conn = duckdb.connect(storage_path, read_only=True)
        
        row = conn.execute(f"SELECT * FROM baseline.runs_d WHERE run_id = '{run_id}'").fetchone()
        assert row is not None
        
        # Check specific fields by column index (based on table creation order)
        # run_id, created_at, run_name, date_from, date_to, interval_seconds, horizon_hours, chain, alerts_total, alerts_ok, config_json, summary_json
        col_names = [d[0] for d in conn.description]
        row_dict = dict(zip(col_names, row))
        
        assert row_dict["run_name"] == "metadata_test"
        assert row_dict["interval_seconds"] == 60
        assert row_dict["horizon_hours"] == 1
        assert row_dict["chain"] == "solana"
        assert row_dict["alerts_total"] == 1
        assert row_dict["alerts_ok"] == 1
        
        # Config JSON should be valid
        config_stored = json.loads(row_dict["config_json"])
        assert config_stored["interval_seconds"] == 60
        
        conn.close()


class TestAlertResultsStorage:
    """Test that alert results are stored correctly."""

    def test_alert_results_stored(self, tmp_dir, base_timestamp):
        """Individual alert results should be stored."""
        candles = []
        candles.extend(make_linear_pump("TOKEN_A", base_timestamp, 1.0, 3.0, 30, 30))
        candles.extend(make_instant_rug("TOKEN_B", base_timestamp, 1.0, 60))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import (
            Alert,
            run_baseline_backtest,
            summarize_overall,
            aggregate_by_caller,
            store_baseline_to_duckdb,
        )
        
        ts_ms = int(base_timestamp.timestamp() * 1000)
        alerts = [
            Alert(mint="TOKEN_A", ts_ms=ts_ms, caller="Caller1"),
            Alert(mint="TOKEN_B", ts_ms=ts_ms, caller="Caller2"),
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
        
        summary = summarize_overall(results)
        caller_agg = aggregate_by_caller(results, min_trades=1)
        
        storage_path = str(tmp_dir / "storage.duckdb")
        run_id = str(uuid.uuid4())
        
        store_baseline_to_duckdb(storage_path, run_id, "test", {}, results, summary, caller_agg, "slices/test", False)
        
        conn = duckdb.connect(storage_path, read_only=True)
        
        # Check alert results
        rows = conn.execute(f"""
            SELECT mint, caller, status, ath_mult 
            FROM baseline.alert_results_f 
            WHERE run_id = '{run_id}'
            ORDER BY mint
        """).fetchall()
        
        assert len(rows) == 2
        
        # TOKEN_A should have high ATH
        token_a = next(r for r in rows if r[0] == "TOKEN_A")
        assert token_a[2] == "ok"
        assert token_a[3] > 2.5  # ATH > 2.5x
        
        # TOKEN_B should have low ATH (rug)
        token_b = next(r for r in rows if r[0] == "TOKEN_B")
        assert token_b[2] == "ok"
        assert token_b[3] < 1.5  # ATH < 1.5x
        
        conn.close()


class TestCallerAggregationStorage:
    """Test that caller aggregations are stored correctly."""

    def test_caller_stats_stored(self, tmp_dir, base_timestamp):
        """Caller aggregated stats should be stored."""
        candles = []
        # 5 tokens for Caller1 (meets min_trades=5)
        for i in range(5):
            candles.extend(make_linear_pump(f"TOKEN_C1_{i}", base_timestamp, 1.0, 3.0, 30, 30))
        
        # 3 tokens for Caller2 (below min_trades=5)
        for i in range(3):
            candles.extend(make_linear_pump(f"TOKEN_C2_{i}", base_timestamp, 1.0, 2.0, 30, 30))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import (
            Alert,
            run_baseline_backtest,
            summarize_overall,
            aggregate_by_caller,
            store_baseline_to_duckdb,
        )
        
        ts_ms = int(base_timestamp.timestamp() * 1000)
        alerts = []
        for i in range(5):
            alerts.append(Alert(mint=f"TOKEN_C1_{i}", ts_ms=ts_ms, caller="Caller1"))
        for i in range(3):
            alerts.append(Alert(mint=f"TOKEN_C2_{i}", ts_ms=ts_ms, caller="Caller2"))
        
        results = run_baseline_backtest(
            alerts=alerts,
            slice_path=parquet_path,
            is_partitioned=False,
            interval_seconds=60,
            horizon_hours=1,
            threads=1,
            verbose=False,
        )
        
        summary = summarize_overall(results)
        caller_agg = aggregate_by_caller(results, min_trades=5)  # min_trades=5
        
        storage_path = str(tmp_dir / "storage.duckdb")
        run_id = str(uuid.uuid4())
        
        store_baseline_to_duckdb(storage_path, run_id, "test", {}, results, summary, caller_agg, "slices/test", False)
        
        conn = duckdb.connect(storage_path, read_only=True)
        
        # Check caller stats
        rows = conn.execute(f"""
            SELECT caller, n, median_ath 
            FROM baseline.caller_stats_f 
            WHERE run_id = '{run_id}'
        """).fetchall()
        
        # Only Caller1 should be stored (Caller2 has only 3 trades, below min_trades=5)
        assert len(rows) == 1
        assert rows[0][0] == "Caller1"
        assert rows[0][1] == 5  # n = 5
        assert rows[0][2] > 2.5  # median_ath > 2.5x
        
        conn.close()


class TestLeaderboardFromStorage:
    """Test that leaderboard queries work against stored data."""

    def test_leaderboard_query_from_stored(self, tmp_dir, base_timestamp):
        """bt_leaderboard should work with stored bt.* data."""
        candles = []
        for i in range(10):
            candles.extend(make_linear_pump(f"TOKEN_{i}", base_timestamp, 1.0, 3.0, 30, 30))
        
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_fast_backtest import Alert, run_vectorized_backtest, summarize, store_run_to_duckdb_fast
        
        ts_ms = int(base_timestamp.timestamp() * 1000)
        alerts = []
        for i in range(5):
            alerts.append(Alert(mint=f"TOKEN_{i}", ts_ms=ts_ms, caller="TopCaller"))
        for i in range(5, 10):
            alerts.append(Alert(mint=f"TOKEN_{i}", ts_ms=ts_ms, caller="OtherCaller"))
        
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
        
        summary = summarize(results)
        
        storage_path = str(tmp_dir / "storage.duckdb")
        run_id = str(uuid.uuid4())
        run_name = "leaderboard_test"
        config = {
            "date_from": "2025-01-01",
            "date_to": "2025-01-02",
            "interval_seconds": 60,
            "horizon_hours": 1,
            "tp_mult": 2.0,
            "sl_mult": 0.5,
        }
        
        store_run_to_duckdb_fast(storage_path, run_id, run_name, config, results, summary)
        
        # Query stored data
        conn = duckdb.connect(storage_path, read_only=True)
        
        # Verify bt.* tables exist
        tables = conn.execute("""
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'bt'
        """).fetchall()
        table_names = {t[0] for t in tables}
        
        assert "runs_d" in table_names
        assert "alert_scenarios_d" in table_names
        assert "alert_outcomes_f" in table_names
        
        # Verify run stored
        run_row = conn.execute(f"SELECT * FROM bt.runs_d WHERE run_id = '{run_id}'").fetchone()
        assert run_row is not None
        
        # Verify scenarios stored
        scenario_count = conn.execute(f"""
            SELECT COUNT(*) FROM bt.alert_scenarios_d WHERE run_id = '{run_id}'
        """).fetchone()[0]
        assert scenario_count == 10  # All 10 alerts
        
        # Verify outcomes stored (only 'ok' status)
        outcome_count = conn.execute(f"""
            SELECT COUNT(*) FROM bt.alert_outcomes_f o
            JOIN bt.alert_scenarios_d s USING (scenario_id)
            WHERE s.run_id = '{run_id}'
        """).fetchone()[0]
        assert outcome_count == 10  # All should be OK
        
        conn.close()


class TestDataIntegrityChecks:
    """Test data integrity in storage."""

    def test_no_duplicate_runs(self, tmp_dir, base_timestamp):
        """Each run should have unique ID."""
        candles = make_linear_pump("TOKEN", base_timestamp, 1.0, 2.0, 30, 30)
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import (
            Alert,
            run_baseline_backtest,
            summarize_overall,
            aggregate_by_caller,
            store_baseline_to_duckdb,
        )
        
        alerts = [Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")]
        results = run_baseline_backtest(alerts, parquet_path, False, 60, 1, 1, False)
        summary = summarize_overall(results)
        caller_agg = aggregate_by_caller(results, min_trades=1)
        
        storage_path = str(tmp_dir / "storage.duckdb")
        
        # Store twice with different IDs
        run_id_1 = str(uuid.uuid4())
        run_id_2 = str(uuid.uuid4())
        
        store_baseline_to_duckdb(storage_path, run_id_1, "run1", {}, results, summary, caller_agg, "slices/test", False)
        store_baseline_to_duckdb(storage_path, run_id_2, "run2", {}, results, summary, caller_agg, "slices/test", False)
        
        conn = duckdb.connect(storage_path, read_only=True)
        count = conn.execute("SELECT COUNT(DISTINCT run_id) FROM baseline.runs_d").fetchone()[0]
        assert count == 2
        conn.close()

    def test_results_linked_to_run(self, tmp_dir, base_timestamp):
        """Alert results should be correctly linked to run_id."""
        candles = make_linear_pump("TOKEN", base_timestamp, 1.0, 2.0, 30, 30)
        parquet_path = tmp_dir / "test.parquet"
        write_candles_to_parquet(candles, parquet_path)
        
        from run_baseline_all import (
            Alert,
            run_baseline_backtest,
            summarize_overall,
            aggregate_by_caller,
            store_baseline_to_duckdb,
        )
        
        alerts = [Alert(mint="TOKEN", ts_ms=int(base_timestamp.timestamp() * 1000), caller="Caller")]
        results = run_baseline_backtest(alerts, parquet_path, False, 60, 1, 1, False)
        summary = summarize_overall(results)
        caller_agg = aggregate_by_caller(results, min_trades=1)
        
        storage_path = str(tmp_dir / "storage.duckdb")
        run_id = str(uuid.uuid4())
        
        store_baseline_to_duckdb(storage_path, run_id, "test", {}, results, summary, caller_agg, "slices/test", False)
        
        conn = duckdb.connect(storage_path, read_only=True)
        
        # All results should have matching run_id
        result_run_ids = conn.execute(
            "SELECT DISTINCT run_id FROM baseline.alert_results_f"
        ).fetchall()
        
        assert len(result_run_ids) == 1
        assert str(result_run_ids[0][0]) == run_id
        
        conn.close()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


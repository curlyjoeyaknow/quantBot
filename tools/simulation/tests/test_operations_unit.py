"""
Unit tests for DuckDB storage operations.

Tests each operation as a pure function:
- Input validation (Pydantic)
- Output validation (Pydantic)
- Correctness of operation
- Error handling
"""

import pytest
from datetime import datetime
from duckdb_storage.ops import (
    StoreStrategyInput,
    StoreStrategyOutput,
    store_strategy_run,
    StoreRunInput,
    StoreRunOutput,
    store_run_run,
    QueryCallsInput,
    QueryCallsOutput,
    query_calls_run,
    UpdateOhlcvMetadataInput,
    UpdateOhlcvMetadataOutput,
    update_ohlcv_metadata_run,
    QueryOhlcvMetadataInput,
    QueryOhlcvMetadataOutput,
    query_ohlcv_metadata_run,
    AddOhlcvExclusionInput,
    AddOhlcvExclusionOutput,
    add_ohlcv_exclusion_run,
    QueryOhlcvExclusionsInput,
    QueryOhlcvExclusionsOutput,
    query_ohlcv_exclusions_run,
    GenerateReportInput,
    GenerateReportOutput,
    generate_report_run,
)


class TestStoreStrategy:
    """Test store_strategy operation."""

    def test_store_strategy_success(self, duckdb_connection):
        """Test successful strategy storage."""
        input_data = StoreStrategyInput(
            strategy_id="PT2_SL25",
            name="PT2 SL25",
            entry_config={"type": "immediate"},
            exit_config={"targets": [{"target": 2.0, "percent": 0.5}]},
        )

        result = store_strategy_run(duckdb_connection, input_data)

        assert result.success is True
        assert result.strategy_id == "PT2_SL25"
        assert result.error is None

    def test_store_strategy_invalid_input(self):
        """Test Pydantic validation rejects invalid input."""
        # Pydantic allows empty strings by default, so test with missing required field
        with pytest.raises(Exception):  # Pydantic ValidationError
            StoreStrategyInput(
                # Missing strategy_id
                name="Test",
            )


class TestStoreRun:
    """Test store_run operation."""

    def test_store_run_success(self, duckdb_connection):
        """Test successful run storage."""
        # First create the strategy (required for foreign key)
        store_strategy_run(
            duckdb_connection,
            StoreStrategyInput(
                strategy_id="PT2_SL25",
                name="PT2 SL25",
                entry_config={"type": "immediate"},
                exit_config={"targets": [{"target": 2.0, "percent": 0.5}]},
            ),
        )
        
        input_data = StoreRunInput(
            run_id="run_123",
            strategy_id="PT2_SL25",
            mint="So11111111111111111111111111111111111111112",
            alert_timestamp="2024-01-01T12:00:00",
            start_time="2024-01-01T12:00:00",
            end_time="2024-01-02T12:00:00",
            initial_capital=1000.0,
            final_capital=1200.0,
            total_return_pct=20.0,
        )

        result = store_run_run(duckdb_connection, input_data)

        assert result.success is True
        assert result.run_id == "run_123"
        assert result.error is None

    def test_store_run_with_optional_fields(self, duckdb_connection):
        """Test run storage with all optional fields."""
        # First create the strategy (required for foreign key)
        store_strategy_run(
            duckdb_connection,
            StoreStrategyInput(
                strategy_id="PT2_SL25",
                name="PT2 SL25",
                entry_config={"type": "immediate"},
                exit_config={"targets": [{"target": 2.0, "percent": 0.5}]},
            ),
        )
        
        input_data = StoreRunInput(
            run_id="run_456",
            strategy_id="PT2_SL25",
            mint="EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            alert_timestamp="2024-01-02T12:00:00",
            start_time="2024-01-02T12:00:00",
            end_time="2024-01-03T12:00:00",
            initial_capital=1000.0,
            final_capital=1100.0,
            total_return_pct=10.0,
            max_drawdown_pct=5.0,
            sharpe_ratio=1.5,
            win_rate=0.6,
            total_trades=10,
        )

        result = store_run_run(duckdb_connection, input_data)

        assert result.success is True
        assert result.run_id == "run_456"


class TestQueryCalls:
    """Test query_calls operation."""

    def test_query_calls_success(self, duckdb_connection):
        """Test successful call querying."""
        input_data = QueryCallsInput(limit=10)

        result = query_calls_run(duckdb_connection, input_data)

        assert result.success is True
        assert result.calls is not None
        assert len(result.calls) > 0
        assert all(call.mint for call in result.calls)
        assert all(call.alert_timestamp for call in result.calls)

    def test_query_calls_with_exclusion(self, duckdb_connection):
        """Test query_calls excludes unrecoverable tokens."""
        # First, add an exclusion
        exclusion_input = AddOhlcvExclusionInput(
            mint="So11111111111111111111111111111111111111112",
            alert_timestamp="2024-01-01 12:00:00",
            reason="No data available",
        )
        add_ohlcv_exclusion_run(duckdb_connection, exclusion_input)

        # Query with exclusion enabled
        input_data = QueryCallsInput(limit=10, exclude_unrecoverable=True)
        result = query_calls_run(duckdb_connection, input_data)

        assert result.success is True
        # Should not include the excluded token
        excluded_mints = {
            call.mint for call in result.calls
            if call.alert_timestamp == "2024-01-01T12:00:00"
        }
        assert "So11111111111111111111111111111111111111112" not in excluded_mints


class TestOhlcvMetadata:
    """Test OHLCV metadata operations."""

    def test_update_metadata_success(self, duckdb_connection):
        """Test successful metadata update."""
        input_data = UpdateOhlcvMetadataInput(
            mint="So11111111111111111111111111111111111111112",
            alert_timestamp="2024-01-01T12:00:00",
            interval_seconds=300,
            time_range_start="2024-01-01T07:00:00",
            time_range_end="2024-01-02T12:00:00",
            candle_count=100,
        )

        result = update_ohlcv_metadata_run(duckdb_connection, input_data)

        assert result.success is True
        assert result.error is None

    def test_query_metadata_available(self, duckdb_connection):
        """Test querying metadata when data is available."""
        # First, update metadata
        update_input = UpdateOhlcvMetadataInput(
            mint="So11111111111111111111111111111111111111112",
            alert_timestamp="2024-01-01T12:00:00",
            interval_seconds=300,
            time_range_start="2024-01-01T07:00:00",
            time_range_end="2024-01-02T12:00:00",
            candle_count=100,
        )
        update_ohlcv_metadata_run(duckdb_connection, update_input)

        # Query metadata
        query_input = QueryOhlcvMetadataInput(
            mint="So11111111111111111111111111111111111111112",
            alert_timestamp="2024-01-01T12:00:00",
            interval_seconds=300,
            required_start="2024-01-01T08:00:00",
            required_end="2024-01-02T10:00:00",
        )

        result = query_ohlcv_metadata_run(duckdb_connection, query_input)

        assert result.success is True
        assert result.available is True
        assert result.candle_count == 100

    def test_query_metadata_not_available(self, duckdb_connection):
        """Test querying metadata when data is not available."""
        query_input = QueryOhlcvMetadataInput(
            mint="NonexistentToken",
            alert_timestamp="2024-01-01T12:00:00",
            interval_seconds=300,
        )

        result = query_ohlcv_metadata_run(duckdb_connection, query_input)

        assert result.success is True
        assert result.available is False


class TestOhlcvExclusions:
    """Test OHLCV exclusion operations."""

    def test_add_exclusion_success(self, duckdb_connection):
        """Test successful exclusion addition."""
        input_data = AddOhlcvExclusionInput(
            mint="So11111111111111111111111111111111111111112",
            alert_timestamp="2024-01-01T12:00:00",
            reason="No data available",
        )

        result = add_ohlcv_exclusion_run(duckdb_connection, input_data)

        assert result.success is True
        assert result.error is None

    def test_query_exclusions_success(self, duckdb_connection):
        """Test querying exclusions."""
        # Add some exclusions
        add_ohlcv_exclusion_run(
            duckdb_connection,
            AddOhlcvExclusionInput(
                mint="So11111111111111111111111111111111111111112",
                alert_timestamp="2024-01-01T12:00:00",
                reason="No data",
            ),
        )

        # Query exclusions
        query_input = QueryOhlcvExclusionsInput(
            mints=["So11111111111111111111111111111111111111112"],
            alert_timestamps=["2024-01-01T12:00:00"],
        )

        result = query_ohlcv_exclusions_run(duckdb_connection, query_input)

        assert result.success is True
        assert result.excluded is not None
        assert len(result.excluded) == 1
        assert result.excluded[0].mint == "So11111111111111111111111111111111111111112"
        assert result.excluded[0].reason == "No data"


class TestGenerateReport:
    """Test generate_report operation."""

    def test_generate_summary_report(self, duckdb_connection):
        """Test generating summary report."""
        # First, store some runs
        store_run_run(
            duckdb_connection,
            StoreRunInput(
                run_id="run_1",
                strategy_id="PT2_SL25",
                mint="So11111111111111111111111111111111111111112",
                alert_timestamp="2024-01-01T12:00:00",
                start_time="2024-01-01T12:00:00",
                end_time="2024-01-02T12:00:00",
                final_capital=1200.0,
                total_return_pct=20.0,
            ),
        )

        input_data = GenerateReportInput(type="summary")

        result = generate_report_run(duckdb_connection, input_data)

        assert result.success is True
        assert result.report_type == "summary"
        assert result.data is not None
        assert result.data.total_runs is not None

    def test_generate_strategy_performance_report(self, duckdb_connection):
        """Test generating strategy performance report."""
        # Store a run
        store_run_run(
            duckdb_connection,
            StoreRunInput(
                run_id="run_1",
                strategy_id="PT2_SL25",
                mint="So11111111111111111111111111111111111111112",
                alert_timestamp="2024-01-01T12:00:00",
                start_time="2024-01-01T12:00:00",
                end_time="2024-01-02T12:00:00",
                final_capital=1200.0,
                total_return_pct=20.0,
            ),
        )

        input_data = GenerateReportInput(
            type="strategy_performance", strategy_id="PT2_SL25"
        )

        result = generate_report_run(duckdb_connection, input_data)

        assert result.success is True
        assert result.report_type == "strategy_performance"
        assert result.data is not None
        assert result.data.strategy_id == "PT2_SL25"


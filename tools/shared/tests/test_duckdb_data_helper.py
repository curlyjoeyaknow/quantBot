#!/usr/bin/env python3
"""
Tests for DuckDB Data Helper

Tests validation, schema queries, and error messages.
"""

import pytest
import sys
from pathlib import Path

# Add workspace root to path
workspace_root = Path(__file__).parent.parent.parent.parent
sys.path.insert(0, str(workspace_root))

from tools.shared.duckdb_data_helper import (
    validate_view_name,
    get_view_schema,
    query_alerts,
    query_callers,
    get_database_info,
    CANON_VIEWS,
    DEPRECATED_VIEWS,
    DEFAULT_DB_PATH,
    get_readonly_connection,
)


class TestValidateViewName:
    """Test view name validation."""

    def test_valid_view_names(self):
        """Test that valid view names pass validation."""
        for view_name in CANON_VIEWS.keys():
            is_valid, error_msg = validate_view_name(view_name, "canon")
            assert is_valid, f"View {view_name} should be valid: {error_msg}"
            assert error_msg is None

    def test_deprecated_view_names(self):
        """Test that deprecated view names are rejected with helpful messages."""
        for view_name in DEPRECATED_VIEWS.keys():
            is_valid, error_msg = validate_view_name(view_name, "canon")
            assert not is_valid, f"Deprecated view {view_name} should be rejected"
            assert error_msg is not None
            assert "deprecated" in error_msg.lower() or "use" in error_msg.lower()

    def test_invalid_view_names(self):
        """Test that invalid view names are rejected."""
        invalid_views = ["nonexistent_view", "invalid", "alerts_old"]
        for view_name in invalid_views:
            is_valid, error_msg = validate_view_name(view_name, "canon")
            assert not is_valid, f"Invalid view {view_name} should be rejected"
            assert error_msg is not None
            assert "does not exist" in error_msg.lower() or "not allowed" in error_msg.lower()

    def test_wrong_schema(self):
        """Test that wrong schema is rejected."""
        is_valid, error_msg = validate_view_name("alerts_std", "wrong_schema")
        assert not is_valid
        assert "not allowed" in error_msg.lower()
        assert "canon" in error_msg.lower()


class TestGetViewSchema:
    """Test getting view schema."""

    def test_get_alerts_std_schema(self):
        """Test getting schema for alerts_std."""
        with get_readonly_connection(DEFAULT_DB_PATH) as con:
            schema = get_view_schema(con, "alerts_std", "canon")
            assert schema["view_name"] == "alerts_std"
            assert schema["schema"] == "canon"
            assert schema["primary"] is True
            assert "description" in schema
            assert "columns" in schema
            assert len(schema["columns"]) > 0

    def test_get_invalid_view_schema(self):
        """Test that invalid view names raise ValueError."""
        with get_readonly_connection(DEFAULT_DB_PATH) as con:
            with pytest.raises(ValueError) as exc_info:
                get_view_schema(con, "nonexistent_view", "canon")
            assert "does not exist" in str(exc_info.value).lower() or "not allowed" in str(
                exc_info.value
            ).lower()

    def test_get_deprecated_view_schema(self):
        """Test that deprecated view names raise ValueError."""
        with get_readonly_connection(DEFAULT_DB_PATH) as con:
            with pytest.raises(ValueError) as exc_info:
                get_view_schema(con, "alerts_canon", "canon")
            assert "deprecated" in str(exc_info.value).lower()


class TestQueryAlerts:
    """Test querying alerts."""

    def test_query_alerts_basic(self):
        """Test basic alert query."""
        with get_readonly_connection(DEFAULT_DB_PATH) as con:
            alerts = query_alerts(con, {}, limit=10)
            assert isinstance(alerts, list)
            assert len(alerts) <= 10

    def test_query_alerts_with_filters(self):
        """Test alert query with filters."""
        with get_readonly_connection(DEFAULT_DB_PATH) as con:
            # Query with date range
            alerts = query_alerts(
                con,
                {
                    "from_ts_ms": 1609459200000,  # 2021-01-01
                    "to_ts_ms": 1640995200000,  # 2022-01-01
                },
                limit=10,
            )
            assert isinstance(alerts, list)
            for alert in alerts:
                assert "alert_ts_ms" in alert
                if alert["alert_ts_ms"]:
                    assert 1609459200000 <= alert["alert_ts_ms"] <= 1640995200000

    def test_query_alerts_limit(self):
        """Test that limit is respected."""
        with get_readonly_connection(DEFAULT_DB_PATH) as con:
            alerts = query_alerts(con, {}, limit=5)
            assert len(alerts) <= 5

    def test_query_alerts_max_limit(self):
        """Test that max limit is enforced."""
        with get_readonly_connection(DEFAULT_DB_PATH) as con:
            alerts = query_alerts(con, {}, limit=20000)  # Over max
            assert len(alerts) <= 10000  # Max limit


class TestQueryCallers:
    """Test querying callers."""

    def test_query_callers_basic(self):
        """Test basic caller query."""
        with get_readonly_connection(DEFAULT_DB_PATH) as con:
            callers = query_callers(con, {})
            assert isinstance(callers, list)


class TestGetDatabaseInfo:
    """Test getting database info."""

    def test_get_database_info(self):
        """Test getting database information."""
        with get_readonly_connection(DEFAULT_DB_PATH) as con:
            info = get_database_info(con)
            assert "schemas" in info
            assert "canon_views" in info
            assert "view_count" in info
            assert "alerts_count" in info
            assert isinstance(info["schemas"], list)
            assert isinstance(info["canon_views"], list)
            assert isinstance(info["view_count"], int)
            assert isinstance(info["alerts_count"], int)
            assert "canon" in info["schemas"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


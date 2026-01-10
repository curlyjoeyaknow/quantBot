"""
Tests for alert loading from DuckDB.

Validates:
1. Alerts loaded correctly from caller_links_d table
2. Alerts loaded from user_calls_d as fallback
3. caller_name preferred over trigger_from_name
4. Chain filtering works correctly
5. Date range filtering works correctly
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import duckdb
import pytest

from fixtures import SyntheticAlert, create_alerts_duckdb

UTC = timezone.utc


class TestAlertLoadingBasic:
    """Test basic alert loading functionality."""

    def test_load_alerts_from_caller_links(self, tmp_dir, base_timestamp):
        """Alerts should be loaded from caller_links_d table."""
        duckdb_path = tmp_dir / "alerts.duckdb"
        
        ts_ms = int(base_timestamp.timestamp() * 1000)
        alerts = [
            SyntheticAlert("TOKEN_A", ts_ms, "CallerOne"),
            SyntheticAlert("TOKEN_B", ts_ms + 1000, "CallerTwo"),
        ]
        
        create_alerts_duckdb(alerts, duckdb_path)
        
        from run_baseline_all import load_alerts
        
        date_from = base_timestamp
        date_to = base_timestamp + timedelta(days=1)
        
        loaded = load_alerts(str(duckdb_path), "solana", date_from, date_to)
        
        assert len(loaded) == 2
        mints = {a.mint for a in loaded}
        assert mints == {"TOKEN_A", "TOKEN_B"}
        
        callers = {a.caller for a in loaded}
        assert callers == {"CallerOne", "CallerTwo"}

    def test_load_alerts_date_range_filtering(self, tmp_dir, base_timestamp):
        """Only alerts within date range should be loaded."""
        duckdb_path = tmp_dir / "alerts.duckdb"
        
        conn = duckdb.connect(str(duckdb_path))
        conn.execute("""
            CREATE TABLE caller_links_d (
                mint VARCHAR,
                trigger_ts_ms BIGINT,
                caller_name VARCHAR,
                trigger_from_name VARCHAR,
                chain VARCHAR DEFAULT 'solana'
            )
        """)
        
        # Alert before range
        before_ts = int((base_timestamp - timedelta(days=5)).timestamp() * 1000)
        # Alert in range
        in_range_ts = int(base_timestamp.timestamp() * 1000)
        # Alert after range
        after_ts = int((base_timestamp + timedelta(days=10)).timestamp() * 1000)
        
        conn.execute("INSERT INTO caller_links_d VALUES (?, ?, ?, ?, ?)", 
                     ["TOKEN_BEFORE", before_ts, "Caller", "Caller", "solana"])
        conn.execute("INSERT INTO caller_links_d VALUES (?, ?, ?, ?, ?)", 
                     ["TOKEN_IN", in_range_ts, "Caller", "Caller", "solana"])
        conn.execute("INSERT INTO caller_links_d VALUES (?, ?, ?, ?, ?)", 
                     ["TOKEN_AFTER", after_ts, "Caller", "Caller", "solana"])
        conn.close()
        
        from run_baseline_all import load_alerts
        
        date_from = base_timestamp
        date_to = base_timestamp + timedelta(days=1)
        
        loaded = load_alerts(str(duckdb_path), "solana", date_from, date_to)
        
        assert len(loaded) == 1
        assert loaded[0].mint == "TOKEN_IN"


class TestCallerNamePreference:
    """Test that caller_name is preferred over trigger_from_name."""

    def test_caller_name_preferred(self, tmp_dir, base_timestamp):
        """caller_name should be used when both columns exist."""
        duckdb_path = tmp_dir / "alerts.duckdb"
        
        conn = duckdb.connect(str(duckdb_path))
        conn.execute("""
            CREATE TABLE caller_links_d (
                mint VARCHAR,
                trigger_ts_ms BIGINT,
                caller_name VARCHAR,
                trigger_from_name VARCHAR,
                chain VARCHAR DEFAULT 'solana'
            )
        """)
        
        ts_ms = int(base_timestamp.timestamp() * 1000)
        # caller_name = "PreferredCaller", trigger_from_name = "FallbackCaller"
        conn.execute("INSERT INTO caller_links_d VALUES (?, ?, ?, ?, ?)",
                     ["TOKEN", ts_ms, "PreferredCaller", "FallbackCaller", "solana"])
        conn.close()
        
        from run_baseline_all import load_alerts
        
        loaded = load_alerts(str(duckdb_path), "solana", base_timestamp, base_timestamp + timedelta(days=1))
        
        assert len(loaded) == 1
        # Should prefer caller_name
        assert loaded[0].caller == "PreferredCaller"

    def test_fallback_to_trigger_from_name(self, tmp_dir, base_timestamp):
        """Should fallback to trigger_from_name when caller_name is NULL."""
        duckdb_path = tmp_dir / "alerts.duckdb"
        
        conn = duckdb.connect(str(duckdb_path))
        conn.execute("""
            CREATE TABLE caller_links_d (
                mint VARCHAR,
                trigger_ts_ms BIGINT,
                caller_name VARCHAR,
                trigger_from_name VARCHAR,
                chain VARCHAR DEFAULT 'solana'
            )
        """)
        
        ts_ms = int(base_timestamp.timestamp() * 1000)
        # caller_name = NULL, trigger_from_name = "FallbackCaller"
        conn.execute("INSERT INTO caller_links_d VALUES (?, ?, ?, ?, ?)",
                     ["TOKEN", ts_ms, None, "FallbackCaller", "solana"])
        conn.close()
        
        from run_baseline_all import load_alerts
        
        loaded = load_alerts(str(duckdb_path), "solana", base_timestamp, base_timestamp + timedelta(days=1))
        
        assert len(loaded) == 1
        # Should fallback to trigger_from_name
        assert loaded[0].caller == "FallbackCaller"


class TestChainFiltering:
    """Test chain-based alert filtering."""

    def test_chain_filter_applied(self, tmp_dir, base_timestamp):
        """Only alerts matching chain should be loaded."""
        duckdb_path = tmp_dir / "alerts.duckdb"
        
        conn = duckdb.connect(str(duckdb_path))
        conn.execute("""
            CREATE TABLE caller_links_d (
                mint VARCHAR,
                trigger_ts_ms BIGINT,
                caller_name VARCHAR,
                chain VARCHAR
            )
        """)
        
        ts_ms = int(base_timestamp.timestamp() * 1000)
        conn.execute("INSERT INTO caller_links_d VALUES (?, ?, ?, ?)",
                     ["TOKEN_SOL", ts_ms, "Caller", "solana"])
        conn.execute("INSERT INTO caller_links_d VALUES (?, ?, ?, ?)",
                     ["TOKEN_ETH", ts_ms, "Caller", "ethereum"])
        conn.execute("INSERT INTO caller_links_d VALUES (?, ?, ?, ?)",
                     ["TOKEN_BASE", ts_ms, "Caller", "base"])
        conn.close()
        
        from run_baseline_all import load_alerts
        
        loaded_sol = load_alerts(str(duckdb_path), "solana", base_timestamp, base_timestamp + timedelta(days=1))
        loaded_eth = load_alerts(str(duckdb_path), "ethereum", base_timestamp, base_timestamp + timedelta(days=1))
        
        assert len(loaded_sol) == 1
        assert loaded_sol[0].mint == "TOKEN_SOL"
        
        assert len(loaded_eth) == 1
        assert loaded_eth[0].mint == "TOKEN_ETH"

    def test_chain_filter_case_insensitive(self, tmp_dir, base_timestamp):
        """Chain filter should be case-insensitive."""
        duckdb_path = tmp_dir / "alerts.duckdb"
        
        conn = duckdb.connect(str(duckdb_path))
        conn.execute("""
            CREATE TABLE caller_links_d (
                mint VARCHAR,
                trigger_ts_ms BIGINT,
                caller_name VARCHAR,
                chain VARCHAR
            )
        """)
        
        ts_ms = int(base_timestamp.timestamp() * 1000)
        conn.execute("INSERT INTO caller_links_d VALUES (?, ?, ?, ?)",
                     ["TOKEN1", ts_ms, "Caller", "SOLANA"])  # Uppercase
        conn.execute("INSERT INTO caller_links_d VALUES (?, ?, ?, ?)",
                     ["TOKEN2", ts_ms, "Caller", "Solana"])  # Mixed case
        conn.close()
        
        from run_baseline_all import load_alerts
        
        # Query with lowercase
        loaded = load_alerts(str(duckdb_path), "solana", base_timestamp, base_timestamp + timedelta(days=1))
        
        assert len(loaded) == 2


class TestUserCallsFallback:
    """Test fallback to user_calls_d table."""

    def test_fallback_to_user_calls_when_caller_links_empty(self, tmp_dir, base_timestamp):
        """Should use user_calls_d when caller_links_d has no matching rows."""
        duckdb_path = tmp_dir / "alerts.duckdb"
        
        conn = duckdb.connect(str(duckdb_path))
        
        # Empty caller_links_d
        conn.execute("""
            CREATE TABLE caller_links_d (
                mint VARCHAR,
                trigger_ts_ms BIGINT,
                caller_name VARCHAR,
                chain VARCHAR
            )
        """)
        
        # user_calls_d has data
        conn.execute("""
            CREATE TABLE user_calls_d (
                mint VARCHAR,
                call_ts_ms BIGINT,
                caller_name VARCHAR,
                chain VARCHAR
            )
        """)
        
        ts_ms = int(base_timestamp.timestamp() * 1000)
        conn.execute("INSERT INTO user_calls_d VALUES (?, ?, ?, ?)",
                     ["TOKEN_FROM_USER_CALLS", ts_ms, "UserCaller", "solana"])
        conn.close()
        
        from run_baseline_all import load_alerts
        
        loaded = load_alerts(str(duckdb_path), "solana", base_timestamp, base_timestamp + timedelta(days=1))
        
        assert len(loaded) == 1
        assert loaded[0].mint == "TOKEN_FROM_USER_CALLS"
        assert loaded[0].caller == "UserCaller"


class TestMintAddressIntegrity:
    """Test that mint addresses are not modified."""

    def test_mint_address_not_truncated(self, tmp_dir, base_timestamp):
        """Full mint address should be preserved."""
        duckdb_path = tmp_dir / "alerts.duckdb"
        
        # Full Solana mint address (44 chars)
        full_mint = "So11111111111111111111111111111111111111112"
        
        conn = duckdb.connect(str(duckdb_path))
        conn.execute("""
            CREATE TABLE caller_links_d (
                mint VARCHAR,
                trigger_ts_ms BIGINT,
                caller_name VARCHAR,
                chain VARCHAR
            )
        """)
        
        ts_ms = int(base_timestamp.timestamp() * 1000)
        conn.execute("INSERT INTO caller_links_d VALUES (?, ?, ?, ?)",
                     [full_mint, ts_ms, "Caller", "solana"])
        conn.close()
        
        from run_baseline_all import load_alerts
        
        loaded = load_alerts(str(duckdb_path), "solana", base_timestamp, base_timestamp + timedelta(days=1))
        
        assert len(loaded) == 1
        assert loaded[0].mint == full_mint
        assert len(loaded[0].mint) == len(full_mint)


class TestAlertSorting:
    """Test that alerts are sorted correctly."""

    def test_alerts_sorted_by_ts_then_mint(self, tmp_dir, base_timestamp):
        """Alerts should be sorted by timestamp, then mint."""
        duckdb_path = tmp_dir / "alerts.duckdb"
        
        conn = duckdb.connect(str(duckdb_path))
        conn.execute("""
            CREATE TABLE caller_links_d (
                mint VARCHAR,
                trigger_ts_ms BIGINT,
                caller_name VARCHAR,
                chain VARCHAR
            )
        """)
        
        ts1 = int(base_timestamp.timestamp() * 1000)
        ts2 = ts1 + 60000  # 1 minute later
        
        # Insert in random order
        conn.execute("INSERT INTO caller_links_d VALUES (?, ?, ?, ?)",
                     ["TOKEN_Z", ts1, "Caller", "solana"])
        conn.execute("INSERT INTO caller_links_d VALUES (?, ?, ?, ?)",
                     ["TOKEN_A", ts2, "Caller", "solana"])
        conn.execute("INSERT INTO caller_links_d VALUES (?, ?, ?, ?)",
                     ["TOKEN_M", ts1, "Caller", "solana"])
        conn.close()
        
        from run_baseline_all import load_alerts
        
        loaded = load_alerts(str(duckdb_path), "solana", base_timestamp, base_timestamp + timedelta(days=1))
        
        assert len(loaded) == 3
        
        # Should be sorted: ts1/TOKEN_M, ts1/TOKEN_Z, ts2/TOKEN_A
        assert loaded[0].ts_ms == ts1
        assert loaded[0].mint == "TOKEN_M"
        
        assert loaded[1].ts_ms == ts1
        assert loaded[1].mint == "TOKEN_Z"
        
        assert loaded[2].ts_ms == ts2
        assert loaded[2].mint == "TOKEN_A"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


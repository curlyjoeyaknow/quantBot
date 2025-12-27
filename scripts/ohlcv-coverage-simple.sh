#!/usr/bin/env bash
set -euo pipefail

# Shows OHLCV coverage for calls in DuckDB (no ClickHouse needed)
# Queries DuckDB directly to check which calls have OHLCV data
#
# Usage:
#   ./scripts/ohlcv-coverage-simple.sh [duckdb-path]
# Examples:
#   ./scripts/ohlcv-coverage-simple.sh data/tele.duckdb

DUCKDB="${1:-data/tele.duckdb}"

if [[ ! -f "$DUCKDB" ]]; then
  echo "❌ DuckDB file not found: $DUCKDB" >&2
  echo "Usage: $0 [duckdb-path]" >&2
  exit 1
fi

python3 <<PYTHON
import sys
import duckdb
from datetime import datetime

duckdb_path = "$DUCKDB"

try:
    con = duckdb.connect(duckdb_path, read_only=True)
except Exception as e:
    print(f"❌ Failed to connect to DuckDB: {e}", file=sys.stderr)
    sys.exit(1)

dim = "\033[2m"
reset = "\033[0m"
green = "\033[32m"
yellow = "\033[33m"
red = "\033[31m"

# Check what tables exist
tables = con.execute("""
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'main'
    ORDER BY table_name
""").fetchall()

table_names = [t[0] for t in tables]

print("")
print("📊 OHLCV Coverage for Calls in DuckDB")
print(f"{dim}Analyzing: {duckdb_path}{reset}")
print("")

# Try different approaches based on what tables exist
if 'ohlcv_coverage_matrix' in table_names:
    # Use pre-computed coverage matrix
    query = """
    SELECT 
        COUNT(*) as total_calls,
        COUNT(DISTINCT mint) as unique_mints,
        COUNT(DISTINCT caller_name) as unique_callers,
        COUNT(*) FILTER (WHERE has_ohlcv_data = TRUE) as calls_with_ohlcv,
        COUNT(*) FILTER (WHERE has_ohlcv_data = FALSE) as calls_without_ohlcv,
        CAST(COUNT(*) FILTER (WHERE has_ohlcv_data = TRUE) AS DOUBLE) / COUNT(*) * 100 as coverage_pct
    FROM ohlcv_coverage_matrix
    """
    
    result = con.execute(query).fetchone()
    if result:
        total_calls, unique_mints, unique_callers, calls_with_ohlcv, calls_without_ohlcv, coverage_pct = result
        coverage_pct = float(coverage_pct) if coverage_pct else 0.0
        
        width = 40
        filled = max(0, min(width, int((coverage_pct / 100) * width)))
        empty = width - filled
        bar = "█" * filled + "░" * empty
        
        color = green if coverage_pct >= 90 else yellow if coverage_pct >= 75 else red
        
        print(f"{dim}Source: ohlcv_coverage_matrix table{reset}")
        print(f"{dim}What: Percentage of calls that have OHLCV candle data available{reset}")
        print("")
        print(f"Coverage: {color}{bar}{reset}  {coverage_pct:.2f}%")
        print("")
        print(f"Total calls:     {total_calls:,}")
        print(f"With OHLCV:      {calls_with_ohlcv:,}")
        print(f"Without OHLCV:   {calls_without_ohlcv:,}")
        print(f"Unique mints:    {unique_mints:,}")
        print(f"Unique callers:  {unique_callers:,}")
        print("")
        con.close()
        sys.exit(0)

# Try to query calls and check for OHLCV data directly
if 'calls' in table_names or 'caller_links_d' in table_names:
    calls_table = 'calls' if 'calls' in table_names else 'caller_links_d'
    
    # Check if there's an ohlcv table or candles table
    ohlcv_table = None
    for t in ['ohlcv_candles', 'candles', 'ohlcv', 'token_data']:
        if t in table_names:
            ohlcv_table = t
            break
    
    if ohlcv_table:
        # Count calls and check which have OHLCV data
        query = f"""
        WITH call_mints AS (
            SELECT DISTINCT 
                mint,
                caller_name,
                trigger_ts_ms
            FROM {calls_table}
            WHERE mint IS NOT NULL
        ),
        ohlcv_mints AS (
            SELECT DISTINCT mint
            FROM {ohlcv_table}
        )
        SELECT 
            COUNT(*) as total_calls,
            COUNT(DISTINCT cm.mint) as unique_mints,
            COUNT(DISTINCT cm.caller_name) as unique_callers,
            COUNT(*) FILTER (WHERE om.mint IS NOT NULL) as calls_with_ohlcv,
            COUNT(*) FILTER (WHERE om.mint IS NULL) as calls_without_ohlcv,
            CAST(COUNT(*) FILTER (WHERE om.mint IS NOT NULL) AS DOUBLE) / COUNT(*) * 100 as coverage_pct
        FROM call_mints cm
        LEFT JOIN ohlcv_mints om ON cm.mint = om.mint
        """
        
        try:
            result = con.execute(query).fetchone()
            if result:
                total_calls, unique_mints, unique_callers, calls_with_ohlcv, calls_without_ohlcv, coverage_pct = result
                coverage_pct = float(coverage_pct) if coverage_pct else 0.0
                
                width = 40
                filled = max(0, min(width, int((coverage_pct / 100) * width)))
                empty = width - filled
                bar = "█" * filled + "░" * empty
                
                color = green if coverage_pct >= 90 else yellow if coverage_pct >= 75 else red
                
                print(f"{dim}Source: {calls_table} + {ohlcv_table} tables{reset}")
                print(f"{dim}What: Percentage of calls (by mint) that have OHLCV data{reset}")
                print("")
                print(f"Coverage: {color}{bar}{reset}  {coverage_pct:.2f}%")
                print("")
                print(f"Total calls:     {total_calls:,}")
                print(f"With OHLCV:      {calls_with_ohlcv:,}")
                print(f"Without OHLCV:   {calls_without_ohlcv:,}")
                print(f"Unique mints:    {unique_mints:,}")
                print(f"Unique callers:  {unique_callers:,}")
                print("")
                con.close()
                sys.exit(0)
        except Exception as e:
            print(f"⚠️  Could not query directly: {e}", file=sys.stderr)
            print("", file=sys.stderr)

# Fallback: just show what tables exist
print(f"Available tables: {', '.join(table_names)}")
print("")
print("❌ Could not compute OHLCV coverage automatically")
print("")
print("Options:")
print("1. If ohlcv_coverage_matrix exists, it may need to be populated")
print("2. If calls/ohlcv tables exist, check column names match expected schema")
print("3. Run: python3 tools/storage/populate_coverage_matrix.py (requires ClickHouse)")
print("")

con.close()
PYTHON

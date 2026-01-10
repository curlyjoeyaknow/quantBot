#!/usr/bin/env bash
set -euo pipefail

# Shows OHLCV coverage histogram for calls in DuckDB
#
# Usage:
#   ./scripts/ohlcv-coverage-histogram.sh [duckdb-path]
# Examples:
#   ./scripts/ohlcv-coverage-histogram.sh data/tele.duckdb
#   ./scripts/ohlcv-coverage-histogram.sh

DUCKDB="${1:-data/tele.duckdb}"

if [[ ! -f "$DUCKDB" ]]; then
  echo "❌ DuckDB file not found: $DUCKDB" >&2
  echo "Usage: $0 [duckdb-path]" >&2
  exit 1
fi

python3 <<'PYTHON'
import sys
import duckdb
import json
from datetime import datetime

duckdb_path = sys.argv[1]

try:
    con = duckdb.connect(duckdb_path, read_only=True)
except Exception as e:
    print(f"❌ Failed to connect to DuckDB: {e}", file=sys.stderr)
    sys.exit(1)

# Query: Overall OHLCV coverage
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

try:
    # Check if table exists
    table_check = con.execute("""
        SELECT COUNT(*) as cnt 
        FROM information_schema.tables 
        WHERE table_name = 'ohlcv_coverage_matrix'
    """).fetchone()
    
    if not table_check or table_check[0] == 0:
        print("❌ Table 'ohlcv_coverage_matrix' not found in DuckDB", file=sys.stderr)
        print("💡 Run: python3 tools/storage/populate_coverage_matrix.py to create it", file=sys.stderr)
        sys.exit(1)
    
    result = con.execute(query).fetchone()
    if not result:
        print("❌ No coverage data found in ohlcv_coverage_matrix table", file=sys.stderr)
        sys.exit(1)
    
    total_calls, unique_mints, unique_callers, calls_with_ohlcv, calls_without_ohlcv, coverage_pct = result
    
    coverage_pct = float(coverage_pct) if coverage_pct else 0.0
    
    # Histogram bar
    width = 40
    filled = max(0, min(width, int((coverage_pct / 100) * width)))
    empty = width - filled
    bar = "█" * filled + "░" * empty
    
    # Color
    if coverage_pct >= 90:
        color = "\033[32m"  # green
    elif coverage_pct >= 75:
        color = "\033[33m"  # yellow
    else:
        color = "\033[31m"  # red
    reset = "\033[0m"
    dim = "\033[2m"
    
    print("")
    print("📊 OHLCV Coverage for Calls in DuckDB")
    print(f"{dim}Scope: All calls in ohlcv_coverage_matrix table{reset}")
    print(f"{dim}What: Percentage of calls that have OHLCV candle data available{reset}")
    print("")
    print(f"Coverage: {color}{bar}{reset}  {coverage_pct:.2f}%")
    print(f"")
    print(f"Total calls:     {total_calls:,}")
    print(f"With OHLCV:      {calls_with_ohlcv:,}")
    print(f"Without OHLCV:   {calls_without_ohlcv:,}")
    print(f"Unique mints:    {unique_mints:,}")
    print(f"Unique callers:  {unique_callers:,}")
    print("")
    
except Exception as e:
    print(f"❌ Query failed: {e}", file=sys.stderr)
    sys.exit(1)
finally:
    con.close()
PYTHON "$DUCKDB"

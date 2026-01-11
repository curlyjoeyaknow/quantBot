#!/usr/bin/env bash
set -euo pipefail

# Shows OHLCV coverage distribution by caller/month/interval
#
# Usage:
#   ./scripts/ohlcv-coverage-buckets.sh [duckdb-path] [--by caller|month|interval]
# Examples:
#   ./scripts/ohlcv-coverage-buckets.sh data/tele.duckdb
#   ./scripts/ohlcv-coverage-buckets.sh data/tele.duckdb --by caller

DUCKDB="${1:-data/tele.duckdb}"

# Handle --by argument
if [[ "${2:-}" == "--by" ]]; then
  GROUP_BY="--by ${3:-}"
else
  GROUP_BY="${2:-}"
fi

if [[ ! -f "$DUCKDB" ]]; then
  echo "❌ DuckDB file not found: $DUCKDB" >&2
  exit 1
fi

DUCKDB_PATH="$DUCKDB" GROUP_BY="$GROUP_BY" python3 <<PYTHON
import sys
import os
import duckdb
from datetime import datetime

duckdb_path = os.environ.get("DUCKDB_PATH", "")
group_by = os.environ.get("GROUP_BY", "")

try:
    con = duckdb.connect(duckdb_path, read_only=True)
    
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
except Exception as e:
    print(f"❌ Failed to connect to DuckDB: {e}", file=sys.stderr)
    sys.exit(1)

dim = "\033[2m"
reset = "\033[0m"

if group_by.startswith("--by"):
    parts = group_by.split()
    group_type = parts[1] if len(parts) > 1 else ""
else:
    group_type = ""

if group_type == "caller":
    query = """
    SELECT 
        caller_name,
        COUNT(*) as total_calls,
        COUNT(*) FILTER (WHERE has_ohlcv_data = TRUE) as with_ohlcv,
        CAST(COUNT(*) FILTER (WHERE has_ohlcv_data = TRUE) AS DOUBLE) / COUNT(*) * 100 as coverage_pct
    FROM ohlcv_coverage_matrix
    GROUP BY caller_name
    ORDER BY coverage_pct ASC, total_calls DESC
    LIMIT 20
    """
    print("")
    print("📊 OHLCV Coverage by Caller")
    print(f"{dim}Top 20 callers by coverage (worst first){reset}")
    print("")
    
    results = con.execute(query).fetchall()
    for caller, total, with_ohlcv, pct in results:
        width = 30
        filled = max(0, min(width, int((pct / 100) * width)))
        bar = "█" * filled + "░" * (width - filled)
        color = "\033[32m" if pct >= 90 else "\033[33m" if pct >= 75 else "\033[31m"
        print(f"{caller[:20]:20} {color}{bar}{reset} {pct:5.1f}% ({with_ohlcv:,}/{total:,})")
    print("")
    
elif group_type == "month":
    query = """
    SELECT 
        strftime(to_timestamp(CAST(trigger_ts_ms / 1000 AS BIGINT)), '%Y-%m') as month,
        COUNT(*) as total_calls,
        COUNT(*) FILTER (WHERE has_ohlcv_data = TRUE) as with_ohlcv,
        CAST(COUNT(*) FILTER (WHERE has_ohlcv_data = TRUE) AS DOUBLE) / COUNT(*) * 100 as coverage_pct
    FROM ohlcv_coverage_matrix
    GROUP BY month
    ORDER BY month DESC
    LIMIT 12
    """
    print("")
    print("📊 OHLCV Coverage by Month")
    print(f"{dim}Last 12 months{reset}")
    print("")
    
    results = con.execute(query).fetchall()
    for month, total, with_ohlcv, pct in results:
        width = 30
        filled = max(0, min(width, int((pct / 100) * width)))
        bar = "█" * filled + "░" * (width - filled)
        color = "\033[32m" if pct >= 90 else "\033[33m" if pct >= 75 else "\033[31m"
        print(f"{month:10} {color}{bar}{reset} {pct:5.1f}% ({with_ohlcv:,}/{total:,})")
    print("")
elif group_type:
    print(f"❌ Unknown group type: {group_type}. Use 'caller' or 'month'", file=sys.stderr)
    sys.exit(1)
else:
    # Overall coverage buckets (0-9%, 10-19%, etc.)
    query = """
    WITH caller_coverage AS (
        SELECT 
            caller_name,
            CAST(COUNT(*) FILTER (WHERE has_ohlcv_data = TRUE) AS DOUBLE) / COUNT(*) * 100 as coverage_pct
        FROM ohlcv_coverage_matrix
        GROUP BY caller_name
    )
    SELECT 
        CASE 
            WHEN coverage_pct >= 100 THEN 10
            ELSE FLOOR(coverage_pct / 10)
        END as bucket,
        COUNT(*) as count
    FROM caller_coverage
    GROUP BY bucket
    ORDER BY bucket
    """
    
    print("")
    print("📊 OHLCV Coverage Distribution")
    print(f"{dim}Distribution of callers by their coverage percentage{reset}")
    print("")
    
    results = con.execute(query).fetchall()
    buckets = {i: 0 for i in range(11)}
    for bucket, count in results:
        buckets[int(bucket)] = count
    
    max_count = max(buckets.values()) if buckets.values() else 1
    bar_width = 30
    
    for i in range(11):
        count = buckets[i]
        label = "100" if i == 10 else f"{i*10:02d}-{i*10+9:02d}"
        filled = int((count / max_count) * bar_width) if max_count > 0 else 0
        bar = "█" * filled + "░" * (bar_width - filled)
        print(f"{label}% | {bar} | {count} callers")
    
    print("")

con.close()
PYTHON

#!/bin/bash

# Monitor OHLCV ingestion progress with coverage histogram
# Shows: current count, progress bar, monthly coverage histogram

DUCKDB_PATH="${DUCKDB_PATH:-data/tele.duckdb}"
CLICKHOUSE_CONTAINER="${CLICKHOUSE_CONTAINER:-quantbot-clickhouse-1}"
MIN_CANDLES_THRESHOLD=5000  # Minimum candles required (age-aware eligibility will adjust for new mints)
INTERVAL_SECONDS=60  # 1m interval

# Find actual ClickHouse container name (docker-compose may add prefix)
if ! docker ps --format '{{.Names}}' | grep -q "^${CLICKHOUSE_CONTAINER}$"; then
  # Try to find container by name pattern
  actual_container=$(docker ps --format '{{.Names}}' --filter "name=${CLICKHOUSE_CONTAINER}" | head -1)
  if [ -n "$actual_container" ]; then
    CLICKHOUSE_CONTAINER="$actual_container"
  fi
fi

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get current count from ClickHouse
get_current_count() {
  docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "SELECT COUNT(*) FROM quantbot.ohlcv_candles" 2>/dev/null || echo "0"
}

# Get alerts from DuckDB and calculate expected coverage
get_alerts_coverage() {
  local duckdb_path="$1"
  local expected_candles="$2"
  
  python3 << PYTHON_EOF
import sys
import duckdb
from datetime import datetime
from collections import defaultdict

duckdb_path = "$duckdb_path"
expected_candles = int("$expected_candles")

try:
    conn = duckdb.connect(duckdb_path, read_only=True)
    
    # Get all alerts with their dates
    # caller_links_d uses trigger_ts_ms, user_calls_d uses call_ts_ms or call_datetime
    query = """
    SELECT 
        DATE_TRUNC('month', alert_time) as month,
        COUNT(DISTINCT mint) as unique_mints,
        COUNT(*) as total_alerts
    FROM (
        SELECT DISTINCT
            mint,
            TO_TIMESTAMP(trigger_ts_ms / 1000.0) as alert_time
        FROM caller_links_d
        WHERE mint IS NOT NULL AND mint != '' AND trigger_ts_ms IS NOT NULL
        UNION ALL
        SELECT DISTINCT
            mint,
            COALESCE(call_datetime, TO_TIMESTAMP(call_ts_ms / 1000.0)) as alert_time
        FROM user_calls_d
        WHERE mint IS NOT NULL AND mint != '' 
          AND (call_datetime IS NOT NULL OR call_ts_ms IS NOT NULL)
    )
    GROUP BY DATE_TRUNC('month', alert_time)
    ORDER BY month
    """
    
    result = conn.execute(query).fetchall()
    
    if not result:
        print("TOTAL|0|0")
        conn.close()
        sys.exit(0)
    
    total_alerts = 0
    total_expected = 0
    monthly_data = []
    
    for row in result:
        if len(row) < 3:
            continue
        # Handle timezone-aware datetime
        month_obj = row[0]
        if hasattr(month_obj, 'strftime'):
            month_str = month_obj.strftime('%Y-%m')
        else:
            month_str = str(month_obj)[:7]
        unique_mints = int(row[1]) if row[1] is not None else 0
        alerts = int(row[2]) if row[2] is not None else 0
        expected = unique_mints * expected_candles
        
        total_alerts += alerts
        total_expected += expected
        monthly_data.append({
            'month': month_str,
            'unique_mints': unique_mints,
            'alerts': alerts,
            'expected': expected
        })
    
    # Output format: month|unique_mints|alerts|expected
    print(f"TOTAL|{total_alerts}|{total_expected}")
    for data in monthly_data:
        print(f"{data['month']}|{data['unique_mints']}|{data['alerts']}|{data['expected']}")
    
    conn.close()
except Exception as e:
    print(f"ERROR|{str(e)}", file=sys.stderr)
    sys.exit(1)
PYTHON_EOF
}

# Get current coverage by month from ClickHouse
# Note: This groups by candle timestamp month, not alert month
# For accurate coverage, we'd need to join with alert data, but this gives a rough estimate
get_current_coverage_by_month() {
  docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    SELECT 
        toStartOfMonth(timestamp) as month,
        COUNT(DISTINCT token_address) as unique_tokens,
        COUNT(*) as candle_count
    FROM quantbot.ohlcv_candles
    WHERE interval = 60
    GROUP BY month
    ORDER BY month
    FORMAT CSV
  " 2>/dev/null || echo ""
}

# Get total unique mints with candles (for overall progress)
get_total_unique_mints_with_candles() {
  docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    SELECT COUNT(DISTINCT token_address)
    FROM quantbot.ohlcv_candles
    WHERE interval = 60
  " 2>/dev/null || echo "0"
}

# Get count of tokens with >= 5,000 candles for 1m interval (strict coverage)
get_tokens_with_full_coverage_1m() {
  docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    SELECT COUNT(DISTINCT token_address)
    FROM (
        SELECT token_address, COUNT(*) as candle_count
        FROM quantbot.ohlcv_candles
        WHERE interval = 60
        GROUP BY token_address
        HAVING candle_count >= 5000
    )
  " 2>/dev/null || echo "0"
}

# Get count of tokens with >= 5,000 candles for 5m interval (strict coverage)
get_tokens_with_full_coverage_5m() {
  docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    SELECT COUNT(DISTINCT token_address)
    FROM (
        SELECT token_address, COUNT(*) as candle_count
        FROM quantbot.ohlcv_candles
        WHERE interval = 300
        GROUP BY token_address
        HAVING candle_count >= 5000
    )
  " 2>/dev/null || echo "0"
}

# Get age-aware coverage statistics (includes token age and candle counts)
# Returns: month,interval,eligible_count,too_new_count,insufficient_count,total_count,median_candles,p10_candles
get_age_aware_coverage_stats() {
  local duckdb_path="$1"
  
  python3 << PYTHON_EOF
import duckdb
import subprocess
import sys
from datetime import datetime, timezone
from collections import defaultdict
import statistics

duckdb_path = "$duckdb_path"
container = "$CLICKHOUSE_CONTAINER"
MIN_CANDLES = 5000
COVERAGE_RATIO = 0.98  # Require 98% of expected candles

# Buffer to tolerate edge effects (in candles)
BUFFER_1M = 20
BUFFER_5M = 5

try:
    conn = duckdb.connect(duckdb_path, read_only=True)
    
    # Get all mints with their first alert time and token creation time
    query = """
    SELECT DISTINCT
        mint,
        MIN(TO_TIMESTAMP(trigger_ts_ms / 1000.0)) as first_alert_time,
        MIN(token_created_ts_ms) as token_created_ts_ms
    FROM caller_links_d
    WHERE mint IS NOT NULL AND mint != '' AND trigger_ts_ms IS NOT NULL
    GROUP BY mint
    UNION
    SELECT DISTINCT
        mint,
        MIN(COALESCE(call_datetime, TO_TIMESTAMP(call_ts_ms / 1000.0))) as first_alert_time,
        NULL as token_created_ts_ms
    FROM user_calls_d
    WHERE mint IS NOT NULL AND mint != '' 
      AND (call_datetime IS NOT NULL OR call_ts_ms IS NOT NULL)
    GROUP BY mint
    """
    
    mint_data = {}
    for row in conn.execute(query).fetchall():
        if len(row) < 2:
            continue
        mint = row[0]
        first_alert = row[1]
        token_created = row[2] if len(row) > 2 else None
        
        # Use token creation time if available, otherwise use first alert time as proxy
        if token_created and token_created > 0:
            mint_data[mint] = {
                'created_ts': token_created / 1000.0,  # Convert ms to seconds
                'first_alert': first_alert
            }
        else:
            # Use first alert as proxy for creation (conservative estimate)
            if hasattr(first_alert, 'timestamp'):
                mint_data[mint] = {
                    'created_ts': first_alert.timestamp(),
                    'first_alert': first_alert
                }
            else:
                continue
    
    conn.close()
    
    # Get candle counts from ClickHouse for both intervals
    now_ts = datetime.now(timezone.utc).timestamp()
    
    # Query 1m candles
    query_1m = """
    SELECT 
        token_address,
        COUNT(*) as candle_count,
        MIN(toUnixTimestamp(timestamp)) as min_ts,
        MAX(toUnixTimestamp(timestamp)) as max_ts
    FROM quantbot.ohlcv_candles
    WHERE interval = 60
    GROUP BY token_address
    """
    
    result_1m = subprocess.run(
        ['docker', 'exec', container, 'clickhouse-client', '--query', query_1m, '--format', 'JSONEachRow'],
        capture_output=True,
        text=True
    )
    
    candle_data_1m = {}
    if result_1m.returncode == 0:
        for line in result_1m.stdout.strip().split('\n'):
            if line.strip():
                import json
                data = json.loads(line)
                mint = data['token_address']
                candle_data_1m[mint] = {
                    'count': int(data['candle_count']),
                    'min_ts': int(data['min_ts']) if data['min_ts'] else None,
                    'max_ts': int(data['max_ts']) if data['max_ts'] else None
                }
    
    # Query 5m candles
    query_5m = """
    SELECT 
        token_address,
        COUNT(*) as candle_count,
        MIN(toUnixTimestamp(timestamp)) as min_ts,
        MAX(toUnixTimestamp(timestamp)) as max_ts
    FROM quantbot.ohlcv_candles
    WHERE interval = 300
    GROUP BY token_address
    """
    
    result_5m = subprocess.run(
        ['docker', 'exec', container, 'clickhouse-client', '--query', query_5m, '--format', 'JSONEachRow'],
        capture_output=True,
        text=True
    )
    
    candle_data_5m = {}
    if result_5m.returncode == 0:
        for line in result_5m.stdout.strip().split('\n'):
            if line.strip():
                import json
                data = json.loads(line)
                mint = data['token_address']
                candle_data_5m[mint] = {
                    'count': int(data['candle_count']),
                    'min_ts': int(data['min_ts']) if data['min_ts'] else None,
                    'max_ts': int(data['max_ts']) if data['max_ts'] else None
                }
    
    # Group mints by month (based on first alert)
    mints_by_month = defaultdict(list)
    for mint, data in mint_data.items():
        first_alert = data['first_alert']
        if hasattr(first_alert, 'strftime'):
            month_str = first_alert.strftime('%Y-%m')
        else:
            month_str = str(first_alert)[:7]
        mints_by_month[month_str].append(mint)
    
    # Calculate age-aware eligibility for each month and interval
    for month in sorted(mints_by_month.keys()):
        mints_in_month = mints_by_month[month]
        
        for interval_name, interval_sec, buffer in [('1m', 60, BUFFER_1M), ('5m', 300, BUFFER_5M)]:
            candle_data = candle_data_1m if interval_name == '1m' else candle_data_5m
            
            eligible_count = 0
            too_new_count = 0
            insufficient_count = 0
            candle_counts = []
            
            for mint in mints_in_month:
                mint_info = mint_data.get(mint)
                if not mint_info:
                    continue
                
                created_ts = mint_info['created_ts']
                age_sec = now_ts - created_ts
                
                # Calculate max possible candles based on age
                max_possible = int(age_sec / interval_sec) + 1
                required = min(MIN_CANDLES, max_possible - buffer)
                
                if required <= 0:
                    too_new_count += 1
                    continue
                
                # Get actual candle count
                actual_count = candle_data.get(mint, {}).get('count', 0)
                candle_counts.append(actual_count)
                
                # Check if meets age-aware requirement
                required_with_ratio = int(required * COVERAGE_RATIO)
                if actual_count >= required_with_ratio:
                    eligible_count += 1
                else:
                    insufficient_count += 1
            
            # Calculate statistics
            total_count = len(mints_in_month)
            median_candles = int(statistics.median(candle_counts)) if candle_counts else 0
            # P10 = 10th percentile (10% of values are below this)
            if candle_counts and len(candle_counts) >= 10:
                sorted_counts = sorted(candle_counts)
                p10_index = max(0, int(len(sorted_counts) * 0.1) - 1)
                p10_candles = int(sorted_counts[p10_index])
            else:
                p10_candles = 0
            
            print(f"{month},{interval_name},{eligible_count},{too_new_count},{insufficient_count},{total_count},{median_candles},{p10_candles}")
    
except Exception as e:
    import traceback
    print(f"ERROR: {str(e)}", file=sys.stderr)
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
PYTHON_EOF
}

# Get tokens with >= 5,000 candles per month (for monthly coverage - strict threshold)
# For each month, count how many of the unique mints from that month have >= 5,000 total candles
# Only count tokens in the month they were first alerted
get_tokens_with_coverage_by_month() {
  local duckdb_path="$1"
  
  python3 << PYTHON_EOF
import duckdb
import subprocess
import sys
from collections import defaultdict

duckdb_path = "$duckdb_path"
container = "$CLICKHOUSE_CONTAINER"
MIN_CANDLES = 5000

try:
    # Get unique mints per month from DuckDB (only first occurrence per mint)
    conn = duckdb.connect(duckdb_path, read_only=True)
    
    # Get all alerts with their dates, ordered by time
    all_alerts_query = """
    SELECT 
        mint,
        TO_TIMESTAMP(trigger_ts_ms / 1000.0) as alert_time
    FROM caller_links_d
    WHERE mint IS NOT NULL AND mint != '' AND trigger_ts_ms IS NOT NULL
    UNION ALL
    SELECT 
        mint,
        COALESCE(call_datetime, TO_TIMESTAMP(call_ts_ms / 1000.0)) as alert_time
    FROM user_calls_d
    WHERE mint IS NOT NULL AND mint != '' 
      AND (call_datetime IS NOT NULL OR call_ts_ms IS NOT NULL)
    ORDER BY alert_time
    """
    
    all_alerts = conn.execute(all_alerts_query).fetchall()
    conn.close()
    
    # Track first month each mint appears in
    mint_first_month = {}
    mints_by_month = defaultdict(set)
    
    for row in all_alerts:
        if len(row) < 2:
            continue
        mint = row[0]  # First column is mint
        alert_time = row[1]  # Second column is alert_time
        
        # Skip if we've already seen this mint (only count first occurrence)
        if mint in mint_first_month:
            continue
        
        # Format month
        if hasattr(alert_time, 'strftime'):
            month_str = alert_time.strftime('%Y-%m')
        else:
            month_str = str(alert_time)[:7]
        
        mint_first_month[mint] = month_str
        mints_by_month[month_str].add(mint)
    
    # Get tokens with >= 5,000 candles from ClickHouse for both intervals
    # We'll query separately for 1m and 5m
    clickhouse_query_1m = f"""
    SELECT token_address
    FROM (
        SELECT token_address, COUNT(*) as candle_count
        FROM quantbot.ohlcv_candles
        WHERE interval = 60
        GROUP BY token_address
        HAVING candle_count >= {MIN_CANDLES}
    )
    """
    
    clickhouse_query_5m = f"""
    SELECT token_address
    FROM (
        SELECT token_address, COUNT(*) as candle_count
        FROM quantbot.ohlcv_candles
        WHERE interval = 300
        GROUP BY token_address
        HAVING candle_count >= {MIN_CANDLES}
    )
    """
    
    # Get tokens with 1m coverage
    result_1m = subprocess.run(
        ['docker', 'exec', container, 'clickhouse-client', '--query', clickhouse_query_1m],
        capture_output=True,
        text=True
    )
    
    if result_1m.returncode != 0:
        print("", file=sys.stderr)
        sys.exit(1)
    
    tokens_with_coverage_1m = set()
    for line in result_1m.stdout.strip().split('\n'):
        if line.strip():
            tokens_with_coverage_1m.add(line.strip())
    
    # Get tokens with 5m coverage
    result_5m = subprocess.run(
        ['docker', 'exec', container, 'clickhouse-client', '--query', clickhouse_query_5m],
        capture_output=True,
        text=True
    )
    
    if result_5m.returncode != 0:
        print("", file=sys.stderr)
        sys.exit(1)
    
    tokens_with_coverage_5m = set()
    for line in result_5m.stdout.strip().split('\n'):
        if line.strip():
            tokens_with_coverage_5m.add(line.strip())
    
    # For each month, count how many mints from that month have coverage for both intervals
    for month in sorted(mints_by_month.keys()):
        mints_in_month = mints_by_month[month]
        covered_count_1m = len([m for m in mints_in_month if m in tokens_with_coverage_1m])
        covered_count_5m = len([m for m in mints_in_month if m in tokens_with_coverage_5m])
        print(f"{month},{covered_count_1m},{covered_count_5m}")
    
except Exception as e:
    import traceback
    print(f"ERROR: {str(e)}", file=sys.stderr)
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
PYTHON_EOF
}

# Draw progress bar
draw_progress_bar() {
  local current=$1
  local total=$2
  local width=50
  local percentage=$((current * 100 / total))
  local filled=$((current * width / total))
  local empty=$((width - filled))
  
  printf "${BLUE}["
  printf "%${filled}s" | tr ' ' '='
  printf "${NC}"
  printf "%${empty}s" | tr ' ' '-'
  printf "${BLUE}]${NC} ${GREEN}%3d%%${NC} (%'d / %'d)\n" "$percentage" "$current" "$total"
}

# Draw histogram bar
draw_histogram_bar() {
  local value=$1
  local max=$2
  local width=40
  
  if [ "$max" -eq 0 ]; then
    printf "%${width}s" | tr ' ' '░'
    return
  fi
  
  local filled=$((value * width / max))
  local empty=$((width - filled))
  
  if [ "$filled" -gt 0 ]; then
    printf "${GREEN}"
    # Use block characters for better visibility
    for ((i=0; i<filled; i++)); do
      printf "█"
    done
    printf "${NC}"
  fi
  
  if [ "$empty" -gt 0 ]; then
    for ((i=0; i<empty; i++)); do
      printf "░"
    done
  fi
}

# Main monitoring loop
main() {
  while true; do
    clear
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "${BLUE}  OHLCV Ingestion Progress Monitor${NC}"
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo ""
    
    # Get current count
    current_count=$(get_current_count)
    echo -e "${GREEN}Current candles in ClickHouse:${NC} $(printf "%'d" "$current_count")"
    echo ""
    
    # Get alerts coverage data
    coverage_data=$(get_alerts_coverage "$DUCKDB_PATH" "$MIN_CANDLES_THRESHOLD")
    
    if echo "$coverage_data" | grep -q "ERROR"; then
      echo -e "${RED}Error querying DuckDB:${NC} $(echo "$coverage_data" | grep "ERROR" | cut -d'|' -f2)"
      sleep 5
      continue
    fi
    
    # Parse total unique mints from DuckDB
    total_line=$(echo "$coverage_data" | grep "^TOTAL")
    total_alerts=$(echo "$total_line" | cut -d'|' -f2)
    
    # Get total unique mints (we need to recalculate from DuckDB)
    total_unique_mints=$(python3 << PYTHON_EOF
import duckdb
import sys
try:
    conn = duckdb.connect('$DUCKDB_PATH', read_only=True)
    result = conn.execute("""
        SELECT COUNT(DISTINCT mint) as unique_mints
        FROM (
            SELECT DISTINCT mint FROM caller_links_d 
            WHERE mint IS NOT NULL AND mint != ''
            UNION
            SELECT DISTINCT mint FROM user_calls_d 
            WHERE mint IS NOT NULL AND mint != ''
        )
    """).fetchone()
    if result and len(result) > 0 and result[0] is not None:
        print(int(result[0]))
    else:
        print('0')
    conn.close()
except Exception as e:
    print('0', file=sys.stderr)
    sys.exit(1)
PYTHON_EOF
)
    
    if [ -z "$total_unique_mints" ] || [ "$total_unique_mints" = "0" ]; then
      echo -e "${YELLOW}No tokens found in DuckDB${NC}"
      sleep 5
      continue
    fi
    
    # Get tokens with >= 10,000 candles for both intervals
    tokens_with_coverage_1m=$(get_tokens_with_full_coverage_1m)
    tokens_with_coverage_5m=$(get_tokens_with_full_coverage_5m)
    
    # Show 1m coverage progress (strict threshold)
    echo -e "${BLUE}1m Coverage (Strict):${NC} % of tokens with >= 5,000 candles (1m interval)"
    draw_progress_bar "$tokens_with_coverage_1m" "$total_unique_mints"
    echo ""
    
    # Show 5m coverage progress (strict threshold)
    echo -e "${BLUE}5m Coverage (Strict):${NC} % of tokens with >= 5,000 candles (5m interval)"
    draw_progress_bar "$tokens_with_coverage_5m" "$total_unique_mints"
    echo ""
    
    # Get age-aware coverage statistics
    echo -e "${BLUE}Age-Aware Coverage Statistics:${NC}"
    age_aware_stats=$(get_age_aware_coverage_stats "$DUCKDB_PATH")
    
    if [ -n "$age_aware_stats" ] && ! echo "$age_aware_stats" | grep -q "ERROR"; then
      echo -e "${YELLOW}Month${NC} | ${YELLOW}Interval${NC} | ${GREEN}Eligible${NC} | ${BLUE}Too New${NC} | ${RED}Insufficient${NC} | ${YELLOW}Total${NC} | ${YELLOW}Median${NC} | ${YELLOW}P10${NC}"
      echo "────────────────────────────────────────────────────────────────────────────"
      while IFS=',' read -r month interval eligible too_new insufficient total median p10; do
        if [ -n "$month" ]; then
          printf "${YELLOW}%s${NC} | %-6s | ${GREEN}%6d${NC} | ${BLUE}%7d${NC} | ${RED}%11d${NC} | ${YELLOW}%5d${NC} | ${YELLOW}%6d${NC} | ${YELLOW}%4d${NC}\n" \
            "$month" "$interval" "$eligible" "$too_new" "$insufficient" "$total" "$median" "$p10"
        fi
      done <<< "$age_aware_stats"
    else
      echo -e "${YELLOW}Age-aware statistics unavailable${NC}"
    fi
    echo ""
    
    # Get tokens with coverage by month
    tokens_coverage_by_month=$(get_tokens_with_coverage_by_month "$DUCKDB_PATH")
    
    # Parse monthly data and show histogram
    echo -e "${BLUE}Monthly Coverage (Strict): % of tokens with >= 5,000 candles${NC}"
    echo ""
    
    max_mints=0
    declare -A monthly_mints
    declare -A monthly_tokens_with_coverage_1m
    declare -A monthly_tokens_with_coverage_5m
    
    # First pass: collect expected unique mints per month
    while IFS='|' read -r month unique_mints alerts expected; do
      if [ "$month" != "TOTAL" ] && [ -n "$month" ]; then
        monthly_mints["$month"]=$unique_mints
        if [ "$unique_mints" -gt "$max_mints" ]; then
          max_mints=$unique_mints
        fi
      fi
    done <<< "$coverage_data"
    
    # Second pass: collect tokens with coverage from Python output
    # Format: YYYY-MM,count_1m,count_5m (month, tokens_with_coverage_1m, tokens_with_coverage_5m)
    if [ -n "$tokens_coverage_by_month" ]; then
      while IFS=',' read -r month tokens_covered_1m tokens_covered_5m; do
        if [ -n "$month" ]; then
          if [ -n "$tokens_covered_1m" ] && [ "$tokens_covered_1m" != "0" ]; then
            monthly_tokens_with_coverage_1m["$month"]=$tokens_covered_1m
          fi
          if [ -n "$tokens_covered_5m" ] && [ "$tokens_covered_5m" != "0" ]; then
            monthly_tokens_with_coverage_5m["$month"]=$tokens_covered_5m
          fi
        fi
      done <<< "$tokens_coverage_by_month"
    fi
    
    # Display histogram for 1m interval
    echo -e "${BLUE}1m Interval:${NC}"
    while IFS='|' read -r month unique_mints alerts expected; do
      if [ "$month" != "TOTAL" ] && [ -n "$month" ]; then
        tokens_covered=${monthly_tokens_with_coverage_1m["$month"]:-0}
        expected_mints=${monthly_mints["$month"]:-0}
        
        if [ "$expected_mints" -gt 0 ]; then
          coverage_pct=$((tokens_covered * 100 / expected_mints))
        else
          coverage_pct=0
        fi
        
        printf "${YELLOW}%s${NC} " "$month"
        printf "Mints: %4d " "$expected_mints"
        # Draw histogram bar relative to expected_mints for this month (not max_mints)
        draw_histogram_bar "$tokens_covered" "$expected_mints"
        printf " %'4d / %'4d tokens " "$tokens_covered" "$expected_mints"
        
        if [ "$coverage_pct" -ge 100 ]; then
          printf "${GREEN}%3d%%${NC}\n" "$coverage_pct"
        elif [ "$coverage_pct" -ge 50 ]; then
          printf "${YELLOW}%3d%%${NC}\n" "$coverage_pct"
        else
          printf "${RED}%3d%%${NC}\n" "$coverage_pct"
        fi
      fi
    done <<< "$coverage_data"
    
    echo ""
    echo -e "${BLUE}5m Interval:${NC}"
    # Display histogram for 5m interval
    while IFS='|' read -r month unique_mints alerts expected; do
      if [ "$month" != "TOTAL" ] && [ -n "$month" ]; then
        tokens_covered=${monthly_tokens_with_coverage_5m["$month"]:-0}
        expected_mints=${monthly_mints["$month"]:-0}
        
        if [ "$expected_mints" -gt 0 ]; then
          coverage_pct=$((tokens_covered * 100 / expected_mints))
        else
          coverage_pct=0
        fi
        
        printf "${YELLOW}%s${NC} " "$month"
        printf "Mints: %4d " "$expected_mints"
        # Draw histogram bar relative to expected_mints for this month (not max_mints)
        draw_histogram_bar "$tokens_covered" "$expected_mints"
        printf " %'4d / %'4d tokens " "$tokens_covered" "$expected_mints"
        
        if [ "$coverage_pct" -ge 100 ]; then
          printf "${GREEN}%3d%%${NC}\n" "$coverage_pct"
        elif [ "$coverage_pct" -ge 50 ]; then
          printf "${YELLOW}%3d%%${NC}\n" "$coverage_pct"
        else
          printf "${RED}%3d%%${NC}\n" "$coverage_pct"
        fi
      fi
    done <<< "$coverage_data"
    
    echo ""
    echo -e "${BLUE}═══════════════════════════════════════════════════════════════${NC}"
    echo -e "Refreshing in 5 seconds... (Ctrl+C to exit)"
    
    sleep 5
  done
}

# Run main function
main


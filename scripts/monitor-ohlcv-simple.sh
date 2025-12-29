#!/bin/bash

# Simple one-liner version for watch command
# Usage: watch -n 5 ./scripts/monitor-ohlcv-simple.sh
# Coverage = % of tokens that have >= 10,000 candles

DUCKDB_PATH="${DUCKDB_PATH:-data/tele.duckdb}"
CLICKHOUSE_CONTAINER="${CLICKHOUSE_CONTAINER:-quantbot-clickhouse-1}"
MIN_CANDLES_PER_TOKEN=10000

# Find actual ClickHouse container name (docker-compose may add prefix)
if ! docker ps --format '{{.Names}}' | grep -q "^${CLICKHOUSE_CONTAINER}$"; then
  # Try to find container by name pattern
  actual_container=$(docker ps --format '{{.Names}}' --filter "name=${CLICKHOUSE_CONTAINER}" | head -1)
  if [ -n "$actual_container" ]; then
    CLICKHOUSE_CONTAINER="$actual_container"
  fi
fi

# Get total unique mints from DuckDB (expected tokens)
total_tokens=$(python3 -c "
import duckdb
import sys
try:
    conn = duckdb.connect('$DUCKDB_PATH', read_only=True)
    result = conn.execute(\"\"\"
        SELECT COUNT(DISTINCT mint) as unique_mints
        FROM (
            SELECT DISTINCT mint FROM caller_links_d 
            WHERE mint IS NOT NULL AND mint != ''
            UNION
            SELECT DISTINCT mint FROM user_calls_d 
            WHERE mint IS NOT NULL AND mint != ''
        )
    \"\"\").fetchone()
    if result and len(result) > 0 and result[0] is not None:
        print(int(result[0]))
    else:
        print('0')
    conn.close()
except Exception as e:
    print('0', file=sys.stderr)
    sys.exit(1)
" 2>/dev/null || echo "0")

# Get count of tokens with >= 10,000 candles for 1m interval (60 seconds)
tokens_1m=$(docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    SELECT COUNT(DISTINCT token_address)
    FROM (
        SELECT token_address, COUNT(*) as candle_count
        FROM quantbot.ohlcv_candles
        WHERE interval = 60
        GROUP BY token_address
        HAVING candle_count >= $MIN_CANDLES_PER_TOKEN
    )
" 2>/dev/null || echo "0")

# Get count of tokens with >= 10,000 candles for 5m interval (300 seconds)
tokens_5m=$(docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    SELECT COUNT(DISTINCT token_address)
    FROM (
        SELECT token_address, COUNT(*) as candle_count
        FROM quantbot.ohlcv_candles
        WHERE interval = 300
        GROUP BY token_address
        HAVING candle_count >= $MIN_CANDLES_PER_TOKEN
    )
" 2>/dev/null || echo "0")

# Get total candle count for display
total_candles=$(docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "SELECT COUNT(*) FROM quantbot.ohlcv_candles" 2>/dev/null || echo "0")

# Calculate coverage percentages
if [ "$total_tokens" -gt 0 ]; then
  pct_1m=$((tokens_1m * 100 / total_tokens))
  pct_5m=$((tokens_5m * 100 / total_tokens))
  width=50
  
  # 1m coverage
  filled_1m=$((tokens_1m * width / total_tokens))
  empty_1m=$((width - filled_1m))
  
  # 5m coverage
  filled_5m=$((tokens_5m * width / total_tokens))
  empty_5m=$((width - filled_5m))
  
  echo "1m Coverage: $(printf "%'d" "$tokens_1m") / $(printf "%'d" "$total_tokens") tokens with >= $MIN_CANDLES_PER_TOKEN candles"
  printf "["
  printf "%${filled_1m}s" | tr ' ' '='
  printf "%${empty_1m}s" | tr ' ' '-'
  printf "] %d%%\n" "$pct_1m"
  
  echo ""
  echo "5m Coverage: $(printf "%'d" "$tokens_5m") / $(printf "%'d" "$total_tokens") tokens with >= $MIN_CANDLES_PER_TOKEN candles"
  printf "["
  printf "%${filled_5m}s" | tr ' ' '='
  printf "%${empty_5m}s" | tr ' ' '-'
  printf "] %d%%\n" "$pct_5m"
  
  echo ""
  echo "Total candles: $(printf "%'d" "$total_candles")"
else
  echo "Total candles: $(printf "%'d" "$total_candles")"
  echo "1m tokens with >= $MIN_CANDLES_PER_TOKEN candles: $(printf "%'d" "$tokens_1m")"
  echo "5m tokens with >= $MIN_CANDLES_PER_TOKEN candles: $(printf "%'d" "$tokens_5m")"
  echo "Unable to calculate coverage (no tokens found in DuckDB)"
fi


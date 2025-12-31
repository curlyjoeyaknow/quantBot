#!/bin/bash

# Backfill progress monitor
# Shows progress for gap fills (existing data) and new fetches (no data)
# Usage: watch -n 5 ./scripts/monitor-ohlcv-backfill.sh

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

# Count tokens with existing candles (need gap fill)
tokens_with_1m=$(docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    SELECT COUNT(DISTINCT token_address)
    FROM quantbot.ohlcv_candles
    WHERE interval = 60
" 2>/dev/null || echo "0")

tokens_with_5m=$(docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    SELECT COUNT(DISTINCT token_address)
    FROM quantbot.ohlcv_candles
    WHERE interval = 300
" 2>/dev/null || echo "0")

# Count tokens with >= 10,000 candles (complete)
tokens_complete_1m=$(docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    SELECT COUNT(DISTINCT token_address)
    FROM (
        SELECT token_address, COUNT(*) as candle_count
        FROM quantbot.ohlcv_candles
        WHERE interval = 60
        GROUP BY token_address
        HAVING candle_count >= $MIN_CANDLES_PER_TOKEN
    )
" 2>/dev/null || echo "0")

tokens_complete_5m=$(docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    SELECT COUNT(DISTINCT token_address)
    FROM (
        SELECT token_address, COUNT(*) as candle_count
        FROM quantbot.ohlcv_candles
        WHERE interval = 300
        GROUP BY token_address
        HAVING candle_count >= $MIN_CANDLES_PER_TOKEN
    )
" 2>/dev/null || echo "0")

# Calculate tokens needing work
tokens_need_1m=$((total_tokens - tokens_complete_1m))
tokens_need_5m=$((total_tokens - tokens_complete_5m))

# Calculate tokens with existing but incomplete (need gap fill)
tokens_gapfill_1m=$((tokens_with_1m - tokens_complete_1m))
tokens_gapfill_5m=$((tokens_with_5m - tokens_complete_5m))

# Calculate tokens with no data (need new fetch)
tokens_new_1m=$((tokens_need_1m - tokens_gapfill_1m))
tokens_new_5m=$((tokens_need_5m - tokens_gapfill_5m))

# Get total candle count
total_candles=$(docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "SELECT COUNT(*) FROM quantbot.ohlcv_candles" 2>/dev/null || echo "0")

echo "=== OHLCV Backfill Progress ==="
echo ""
echo "Total tokens: $(printf "%'d" "$total_tokens")"
echo "Total candles: $(printf "%'d" "$total_candles")"
echo ""

# 1m Interval
echo "1m Interval:"
echo "  Complete (>=10k): $(printf "%'d" "$tokens_complete_1m") / $(printf "%'d" "$total_tokens") ($((tokens_complete_1m * 100 / total_tokens))%)%)"
echo "  Need work: $(printf "%'d" "$tokens_need_1m")"
echo "    - Gap fill (has some): $(printf "%'d" "$tokens_gapfill_1m")"
echo "    - New fetch (none): $(printf "%'d" "$tokens_new_1m")"
echo ""

# 5m Interval
echo "5m Interval:"
echo "  Complete (>=10k): $(printf "%'d" "$tokens_complete_5m") / $(printf "%'d" "$total_tokens") ($((tokens_complete_5m * 100 / total_tokens))%)%)"
echo "  Need work: $(printf "%'d" "$tokens_need_5m")"
echo "    - Gap fill (has some): $(printf "%'d" "$tokens_gapfill_5m")"
echo "    - New fetch (none): $(printf "%'d" "$tokens_new_5m")"
echo ""

# Worklist summary
if [ -f "patch-worklist-existing.json" ]; then
  existing_items=$(python3 -c "import json; f=open('patch-worklist-existing.json'); d=json.load(f); print(d.get('totalItems', 0))" 2>/dev/null || echo "0")
  echo "Existing worklist (gap fills): $(printf "%'d" "$existing_items") items"
fi

if [ -f "patch-worklist-new.json" ]; then
  new_items=$(python3 -c "import json; f=open('patch-worklist-new.json'); d=json.load(f); print(d.get('totalItems', 0))" 2>/dev/null || echo "0")
  echo "New worklist (normal fetches): $(printf "%'d" "$new_items") items"
fi


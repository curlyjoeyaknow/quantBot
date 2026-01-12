#!/bin/bash
# Run ClickHouse migration asynchronously in background

set -e

cd "$(dirname "$0")/../.."

# Load environment
export $(grep -v '^#' .env | grep CLICKHOUSE | xargs)

DATABASE="${CLICKHOUSE_DATABASE:-quantbot}"
HOST="${CLICKHOUSE_HOST:-localhost}"
PORT="${CLICKHOUSE_PORT:-19000}"
USER="${CLICKHOUSE_USER:-quantbot_app}"
PASSWORD="${CLICKHOUSE_PASSWORD}"

echo "======================================================================="
echo "OHLCV CANDLES MIGRATION - ASYNC MODE"
echo "======================================================================="
echo "Database: $DATABASE"
echo "Host: $HOST:$PORT"
echo ""

# Step 1: Check current state
echo "[1/4] Checking current state..."
TOTAL=$(clickhouse-client --host=$HOST --port=$PORT --user=$USER --password="$PASSWORD" --database=$DATABASE --query="SELECT count() FROM ohlcv_candles FORMAT TabSeparated")
DUPS=$(clickhouse-client --host=$HOST --port=$PORT --user=$USER --password="$PASSWORD" --database=$DATABASE --query="SELECT count() FROM (SELECT token_address, chain, timestamp, interval_seconds, count() as cnt FROM ohlcv_candles GROUP BY token_address, chain, timestamp, interval_seconds HAVING cnt > 1) FORMAT TabSeparated")
echo "  Total rows: $TOTAL"
echo "  Duplicate groups: $DUPS"
echo ""

# Step 2: Create new table
echo "[2/4] Creating new table..."
clickhouse-client --host=$HOST --port=$PORT --user=$USER --password="$PASSWORD" --database=$DATABASE --query="DROP TABLE IF EXISTS ${DATABASE}.ohlcv_candles_v2"

clickhouse-client --host=$HOST --port=$PORT --user=$USER --password="$PASSWORD" --database=$DATABASE --query="CREATE TABLE ${DATABASE}.ohlcv_candles_v2 (
    token_address String,
    chain String,
    timestamp DateTime,
    interval_seconds UInt32,
    open Float64,
    high Float64,
    low Float64,
    close Float64,
    volume Float64,
    ingested_at DateTime DEFAULT now()
)
ENGINE = ReplacingMergeTree(ingested_at)
PARTITION BY (chain, toYYYYMM(timestamp))
ORDER BY (token_address, chain, timestamp, interval_seconds)
SETTINGS index_granularity = 8192"

echo "✓ Table created: ohlcv_candles_v2"
echo ""

# Step 3: Start migration in background
echo "[3/4] Starting data migration (async)..."
LOG_FILE="/tmp/clickhouse_migration_$(date +%s).log"

nohup clickhouse-client --host=$HOST --port=$PORT --user=$USER --password="$PASSWORD" --database=$DATABASE --query="
INSERT INTO ${DATABASE}.ohlcv_candles_v2
SELECT 
    token_address,
    chain,
    timestamp,
    interval_seconds,
    anyLast(open) as open,
    anyLast(high) as high,
    anyLast(low) as low,
    anyLast(close) as close,
    anyLast(volume) as volume,
    now() as ingested_at
FROM ${DATABASE}.ohlcv_candles
GROUP BY token_address, chain, timestamp, interval_seconds
" > "$LOG_FILE" 2>&1 &

MIGRATION_PID=$!
echo "✓ Migration started (PID: $MIGRATION_PID)"
echo "  Log file: $LOG_FILE"
echo ""

# Step 4: Monitor progress
echo "[4/4] Monitoring progress..."
echo "  Press Ctrl+C to stop monitoring (migration will continue in background)"
echo ""

monitor_progress() {
    while kill -0 $MIGRATION_PID 2>/dev/null; do
        COUNT=$(clickhouse-client --host=$HOST --port=$PORT --user=$USER --password="$PASSWORD" --database=$DATABASE --query="SELECT count() FROM ohlcv_candles_v2 FORMAT TabSeparated" 2>/dev/null || echo "0")
        PERCENT=$(awk "BEGIN {printf \"%.1f\", ($COUNT / $TOTAL) * 100}")
        echo "  Progress: $COUNT / $TOTAL rows ($PERCENT%)"
        sleep 10
    done
    
    # Final count
    FINAL_COUNT=$(clickhouse-client --host=$HOST --port=$PORT --user=$USER --password="$PASSWORD" --database=$DATABASE --query="SELECT count() FROM ohlcv_candles_v2 FORMAT TabSeparated")
    echo ""
    echo "✓ Migration complete: $FINAL_COUNT rows"
    
    REMOVED=$((TOTAL - FINAL_COUNT))
    echo "  Duplicates removed: $REMOVED"
}

trap "echo ''; echo 'Monitoring stopped. Migration continues in background (PID: $MIGRATION_PID)'; exit 0" INT

monitor_progress

echo ""
echo "======================================================================="
echo "MIGRATION DATA INSERTED"
echo "======================================================================="
echo ""
echo "Next steps:"
echo "  1. Verify the data: SELECT count() FROM ohlcv_candles_v2;"
echo "  2. Check for duplicates (should be 0)"
echo "  3. When ready, swap tables:"
echo "     RENAME TABLE ohlcv_candles TO ohlcv_candles_old;"
echo "     RENAME TABLE ohlcv_candles_v2 TO ohlcv_candles;"
echo ""


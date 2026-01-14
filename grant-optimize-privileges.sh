#!/bin/bash
# Grant OPTIMIZE privileges to quantbot_app user on OHLCV tables
#
# This script connects to ClickHouse via Docker and grants OPTIMIZE privileges
# to the quantbot_app user so it can run deduplication sweeps.

set -e

echo "Granting OPTIMIZE privileges to quantbot_app user..."

# Use the known container name
CONTAINER_NAME="quantbot-clickhouse"

# Verify container exists and is running
if ! docker ps --format "{{.Names}}" | grep -q "^${CONTAINER_NAME}$"; then
    echo "Error: ClickHouse container '${CONTAINER_NAME}' not found or not running."
    echo "Available containers:"
    docker ps --format "{{.Names}}"
    exit 1
fi

echo "Using ClickHouse container: $CONTAINER_NAME"

# Get database name from environment or use default
DATABASE="${CLICKHOUSE_DATABASE:-quantbot}"

echo "Using database: $DATABASE"

# Grant OPTIMIZE privileges on OHLCV tables
docker exec -i "$CONTAINER_NAME" clickhouse-client \
    --user=default \
    --password="${CLICKHOUSE_PASSWORD:-UxdtDJVj}" \
    --multiline <<EOF

-- Grant OPTIMIZE privilege on ohlcv_candles_1m table
GRANT OPTIMIZE ON ${DATABASE}.ohlcv_candles_1m TO quantbot_app;

-- Grant OPTIMIZE privilege on ohlcv_candles_5m table
GRANT OPTIMIZE ON ${DATABASE}.ohlcv_candles_5m TO quantbot_app;

-- Verify grants
SHOW GRANTS FOR quantbot_app;

EOF

echo ""
echo "✅ OPTIMIZE privileges granted successfully!"
echo "You can now run: quantbot ohlcv dedup-sweep"


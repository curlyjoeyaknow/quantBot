#!/usr/bin/env bash
set -euo pipefail

# Fix ClickHouse symlinks after restore
# Run after restore-clickhouse-complete.sh if symlinks are broken

CLICKHOUSE_CONTAINER=$(docker ps --format "{{.Names}}" | grep -i clickhouse | head -1)
if [[ -z "$CLICKHOUSE_CONTAINER" ]]; then
    echo "Error: ClickHouse container not found"
    exit 1
fi

echo "Container: $CLICKHOUSE_CONTAINER"
echo ""

# Check if store directory exists
if ! docker exec "$CLICKHOUSE_CONTAINER" test -d /var/lib/clickhouse/store/b6d/b6d4a709-7580-4561-9b07-1fca7588b206; then
    echo "Error: Store directory not found"
    exit 1
fi

echo "✓ Store directory exists"
echo ""

# Recreate ohlcv_candles symlink
echo "Recreating ohlcv_candles symlink..."
docker exec "$CLICKHOUSE_CONTAINER" rm -f /var/lib/clickhouse/data/quantbot/ohlcv_candles 2>&1 || true
docker exec "$CLICKHOUSE_CONTAINER" mkdir -p /var/lib/clickhouse/data/quantbot 2>&1 || true
docker exec "$CLICKHOUSE_CONTAINER" ln -s /var/lib/clickhouse/store/b6d/b6d4a709-7580-4561-9b07-1fca7588b206 /var/lib/clickhouse/data/quantbot/ohlcv_candles 2>&1 && {
    echo "✓ Symlink created"
} || {
    echo "✗ Failed to create symlink"
    exit 1
}

# Fix permissions
docker exec "$CLICKHOUSE_CONTAINER" chown -h clickhouse:clickhouse /var/lib/clickhouse/data/quantbot/ohlcv_candles 2>&1 || true

# Verify
echo ""
echo "Verifying..."
ROW_COUNT=$(docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "SELECT COUNT(*) FROM quantbot.ohlcv_candles" 2>&1 || echo "0")

if [[ "$ROW_COUNT" =~ ^[0-9]+$ ]] && [[ $ROW_COUNT -gt 0 ]]; then
    echo "✓ Success! Rows: $ROW_COUNT"
else
    echo "⚠ Table exists but is empty (0 rows)"
    echo ""
    echo "Checking for partitions in store..."
    PARTITIONS=$(docker exec "$CLICKHOUSE_CONTAINER" find /var/lib/clickhouse/store/b6d/b6d4a709-7580-4561-9b07-1fca7588b206 -type d -name "*2024*" -o -name "*2025*" 2>/dev/null | wc -l)
    echo "  Found $PARTITIONS partition directories"
    
    if [[ $PARTITIONS -eq 0 ]]; then
        echo ""
        echo "  The store directory exists but has no partition data."
        echo "  The data may be in a different store location."
        echo "  Check: docker exec $CLICKHOUSE_CONTAINER find /var/lib/clickhouse/store -type d -name '*2024*' -o -name '*2025*'"
    fi
fi


#!/usr/bin/env bash
set -euo pipefail

# Complete ClickHouse restore - copies entire data and store directories
# Run with: ./scripts/system/restore-clickhouse-complete.sh [source_directory]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
SOURCE_DIR="${1:-${PROJECT_ROOT}/clickhouse-data}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Complete ClickHouse Restore ===${NC}"
echo "Source: $SOURCE_DIR"
echo ""

# Detect container
CLICKHOUSE_CONTAINER=$(docker ps --format "{{.Names}}" | grep -i clickhouse | head -1)
if [[ -z "$CLICKHOUSE_CONTAINER" ]]; then
    echo -e "${RED}Error: ClickHouse container not found${NC}"
    exit 1
fi
echo "Container: $CLICKHOUSE_CONTAINER"
echo ""

# Check source
if [[ ! -d "$SOURCE_DIR" ]]; then
    echo -e "${RED}Error: Source directory not found: $SOURCE_DIR${NC}"
    exit 1
fi

if [[ ! -d "$SOURCE_DIR/data" ]] && [[ ! -d "$SOURCE_DIR/store" ]]; then
    echo -e "${RED}Error: No data/ or store/ directories found${NC}"
    exit 1
fi

# Warning
echo -e "${RED}⚠️  WARNING: This will OVERWRITE all ClickHouse data!${NC}"
read -p "Continue? (type 'yes'): " CONFIRM
if [[ "$CONFIRM" != "yes" ]]; then
    echo "Cancelled"
    exit 0
fi

# Stop ClickHouse
echo ""
echo -e "${YELLOW}Stopping ClickHouse...${NC}"
docker-compose -f "$PROJECT_ROOT/docker-compose.yml" stop clickhouse 2>&1 || true
sleep 2

# Get volume path
VOLUME_PATH=$(docker volume inspect quantbot_clickhouse-data 2>/dev/null | grep -oP '(?<="Mountpoint": ")[^"]+')
echo "Volume: $VOLUME_PATH"
echo ""

# Create temp container for copying
TEMP_CONTAINER="temp-ch-restore-$$"
echo -e "${YELLOW}Creating temporary container...${NC}"
docker run -d --name "$TEMP_CONTAINER" \
    -v quantbot_clickhouse-data:/var/lib/clickhouse \
    clickhouse/clickhouse-server:latest \
    sleep 3600 2>&1 || {
    echo -e "${RED}Failed to create temp container${NC}"
    exit 1
}
sleep 2

# Copy data directory (ignore symlink errors, we'll recreate them)
if [[ -d "$SOURCE_DIR/data" ]]; then
    echo -e "${YELLOW}Copying data/ directory...${NC}"
    docker cp "$SOURCE_DIR/data/." "${TEMP_CONTAINER}:/var/lib/clickhouse/data/." 2>&1 | grep -v "invalid symlink" || true
    
    # Check if copy succeeded (may have symlink errors but directories copied)
    if docker exec "$TEMP_CONTAINER" test -d /var/lib/clickhouse/data/quantbot; then
        echo -e "${GREEN}✓ Data directory structure copied${NC}"
        
        # Recreate symlinks for tables that use store
        echo "  Recreating symlinks..."
        if [[ -L "$SOURCE_DIR/data/quantbot/ohlcv_candles" ]]; then
            TARGET=$(readlink "$SOURCE_DIR/data/quantbot/ohlcv_candles")
            # Convert relative path to absolute
            ABS_TARGET="/var/lib/clickhouse/store/$(echo "$TARGET" | sed 's|../../store/||')"
            docker exec "$TEMP_CONTAINER" rm -f /var/lib/clickhouse/data/quantbot/ohlcv_candles 2>&1 || true
            docker exec "$TEMP_CONTAINER" ln -s "$ABS_TARGET" /var/lib/clickhouse/data/quantbot/ohlcv_candles 2>&1 && {
                echo -e "    ${GREEN}✓ Recreated ohlcv_candles symlink${NC}"
            } || {
                echo -e "    ${YELLOW}⚠ Could not recreate ohlcv_candles symlink${NC}"
            }
        fi
        
        # Handle backup database symlinks too
        if [[ -L "$SOURCE_DIR/data/quantbot_backup_20251227/ohlcv_candles" ]]; then
            TARGET=$(readlink "$SOURCE_DIR/data/quantbot_backup_20251227/ohlcv_candles")
            ABS_TARGET="/var/lib/clickhouse/store/$(echo "$TARGET" | sed 's|../../store/||')"
            docker exec "$TEMP_CONTAINER" mkdir -p /var/lib/clickhouse/data/quantbot_backup_20251227 2>&1 || true
            docker exec "$TEMP_CONTAINER" rm -f /var/lib/clickhouse/data/quantbot_backup_20251227/ohlcv_candles 2>&1 || true
            docker exec "$TEMP_CONTAINER" ln -s "$ABS_TARGET" /var/lib/clickhouse/data/quantbot_backup_20251227/ohlcv_candles 2>&1 && {
                echo -e "    ${GREEN}✓ Recreated backup database symlink${NC}"
            } || true
        fi
    else
        echo -e "${RED}✗ Failed to copy data directory${NC}"
    fi
fi

# Copy store directory (CRITICAL - this contains the actual data)
if [[ -d "$SOURCE_DIR/store" ]]; then
    echo -e "${YELLOW}Copying store/ directory (this may take a while)...${NC}"
    STORE_SIZE=$(du -sh "$SOURCE_DIR/store" 2>/dev/null | cut -f1)
    echo "  Store size: $STORE_SIZE"
    
    docker cp "$SOURCE_DIR/store/." "${TEMP_CONTAINER}:/var/lib/clickhouse/store/." 2>&1 && {
        echo -e "${GREEN}✓ Store directory copied${NC}"
    } || {
        echo -e "${RED}✗ Failed to copy store directory${NC}"
        echo "  Trying alternative method..."
        
        # Alternative: copy via volume mount with sudo
        if [[ -n "$VOLUME_PATH" ]]; then
            echo "  Using direct volume copy..."
            sudo cp -r "$SOURCE_DIR/store/." "$VOLUME_PATH/store/." 2>&1 && {
                echo -e "    ${GREEN}✓ Store copied directly${NC}"
                sudo chown -R 101:101 "$VOLUME_PATH/store" 2>&1 || true
            } || {
                echo -e "    ${RED}✗ Direct copy also failed${NC}"
            }
        fi
    }
fi

# Copy metadata if exists
if [[ -d "$SOURCE_DIR/metadata" ]]; then
    echo -e "${YELLOW}Copying metadata/ directory...${NC}"
    docker cp "$SOURCE_DIR/metadata/." "${TEMP_CONTAINER}:/var/lib/clickhouse/metadata/." 2>&1 && {
        echo -e "${GREEN}✓ Metadata copied${NC}"
    } || {
        echo -e "${YELLOW}⚠ Metadata copy failed (may not be critical)${NC}"
    }
fi

# Fix permissions
echo -e "${YELLOW}Fixing permissions...${NC}"
docker exec "$TEMP_CONTAINER" chown -R 101:101 /var/lib/clickhouse/data 2>&1 || true
docker exec "$TEMP_CONTAINER" chown -R 101:101 /var/lib/clickhouse/store 2>&1 || true
docker exec "$TEMP_CONTAINER" chown -R 101:101 /var/lib/clickhouse/metadata 2>&1 || true

# Cleanup
echo -e "${YELLOW}Cleaning up...${NC}"
docker stop "$TEMP_CONTAINER" 2>&1 || true
docker rm "$TEMP_CONTAINER" 2>&1 || true

# Start ClickHouse
echo -e "${YELLOW}Starting ClickHouse...${NC}"
docker-compose -f "$PROJECT_ROOT/docker-compose.yml" start clickhouse 2>&1 || true

# Wait for ClickHouse
echo "Waiting for ClickHouse to be ready..."
MAX_WAIT=60
WAIT_COUNT=0
while [[ $WAIT_COUNT -lt $MAX_WAIT ]]; do
    if docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "SELECT 1" &>/dev/null; then
        echo -e "${GREEN}✓ ClickHouse is ready${NC}"
        break
    fi
    sleep 1
    WAIT_COUNT=$((WAIT_COUNT + 1))
    echo -n "."
done
echo ""

# Verify
echo ""
echo -e "${YELLOW}Verifying restore...${NC}"
ROW_COUNT=$(docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "SELECT COUNT(*) FROM quantbot.ohlcv_candles" 2>&1 || echo "0")

if [[ "$ROW_COUNT" =~ ^[0-9]+$ ]] && [[ $ROW_COUNT -gt 0 ]]; then
    echo -e "${GREEN}✓ Restore successful!${NC}"
    echo "  Rows: $ROW_COUNT"
    
    # Show partitions
    echo ""
    echo "  Partitions:"
    docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client \
        --query "SELECT partition, count() as rows, formatReadableSize(sum(bytes_on_disk)) as size FROM system.parts WHERE database = 'quantbot' AND table = 'ohlcv_candles' AND active GROUP BY partition ORDER BY partition DESC LIMIT 10" 2>&1 || true
else
    echo -e "${YELLOW}⚠ Table exists but is empty (0 rows)${NC}"
    echo ""
    echo "  Checking for detached parts..."
    DETACHED=$(docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client \
        --query "SELECT COUNT(*) FROM system.detached_parts WHERE database = 'quantbot' AND table = 'ohlcv_candles'" 2>&1 || echo "0")
    if [[ "$DETACHED" =~ ^[0-9]+$ ]] && [[ $DETACHED -gt 0 ]]; then
        echo "  Found $DETACHED detached parts. You may need to attach them."
    fi
    
    echo ""
    echo "  Check ClickHouse logs: docker logs $CLICKHOUSE_CONTAINER"
fi

echo ""
echo -e "${BLUE}=== Restore Complete ===${NC}"


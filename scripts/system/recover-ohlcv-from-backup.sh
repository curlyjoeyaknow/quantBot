#!/usr/bin/env bash
set -euo pipefail

# Recover 130M OHLCV candles from Docker backup
# Run with: sudo ./scripts/system/recover-ohlcv-from-backup.sh

BACKUP_TAR="/home/memez/docker-backup/20251228_224159/volumes/quantbot_clickhouse-data.tar"
EXTRACT_DIR="/tmp/clickhouse-recovery-$$"
CLICKHOUSE_DATA="/var/lib/clickhouse"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== Recover OHLCV Data from Backup ===${NC}"
echo ""

if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}Error: This script must be run as root (use sudo)${NC}"
   exit 1
fi

# Check if backup exists
if [[ ! -f "$BACKUP_TAR" ]]; then
    echo -e "${RED}Error: Backup file not found: $BACKUP_TAR${NC}"
    exit 1
fi

BACKUP_SIZE=$(du -sh "$BACKUP_TAR" | cut -f1)
echo -e "${YELLOW}Backup file: $BACKUP_TAR${NC}"
echo -e "${YELLOW}Size: $BACKUP_SIZE${NC}"
echo ""

# Check available space
AVAILABLE=$(df -BG /tmp | tail -1 | awk '{print $4}' | sed 's/G//')
echo "Available space in /tmp: ${AVAILABLE}GB"
echo ""

read -p "Continue with recovery? This will extract the backup and restore OHLCV data. (yes/no): " -r
if [[ ! $REPLY =~ ^[Yy][Ee][Ss]$ ]]; then
    echo "Recovery cancelled"
    exit 0
fi

echo ""
echo -e "${YELLOW}[1/6] Stopping ClickHouse containers...${NC}"
systemctl stop clickhouse-server || true
docker stop quantbot-clickhouse-1 || true
sleep 3

echo -e "${YELLOW}[2/6] Creating temporary extract directory...${NC}"
mkdir -p "$EXTRACT_DIR"
trap "rm -rf $EXTRACT_DIR" EXIT

echo -e "${YELLOW}[3/6] Extracting backup (this may take a while)...${NC}"
cd "$EXTRACT_DIR"
tar -xf "$BACKUP_TAR" 2>&1 | tail -5 || {
    echo -e "${RED}Error extracting backup${NC}"
    exit 1
}
echo -e "${GREEN}✓ Extraction complete${NC}"

echo -e "${YELLOW}[4/6] Checking for OHLCV data in backup...${NC}"

# Check for ohlcv_candles data
OHLCV_DATA_DIR="$EXTRACT_DIR/data/quantbot/ohlcv_candles"
OHLCV_STORE_DIR="$EXTRACT_DIR/store/b6d/b6d4a709-7580-4561-9b07-1fca7588b206"

if [[ -d "$OHLCV_DATA_DIR" ]] || [[ -d "$OHLCV_STORE_DIR" ]]; then
    echo -e "${GREEN}✓ Found OHLCV data directories${NC}"
    
    # Count partition directories
    PARTITIONS=$(find "$EXTRACT_DIR" -type d -path "*/ohlcv_candles/*" -o -path "*/store/*b6d4a709*/*2025*" 2>/dev/null | wc -l)
    echo "  Partition directories found: $PARTITIONS"
    
    # Count data files
    BIN_FILES=$(find "$EXTRACT_DIR" -name "data.bin" -path "*ohlcv*" -o -path "*b6d4a709*" 2>/dev/null | wc -l)
    echo "  Data files (.bin) found: $BIN_FILES"
    
    if [[ $BIN_FILES -gt 0 ]]; then
        echo -e "${GREEN}✓ Found $BIN_FILES data files - data exists!${NC}"
    else
        echo -e "${YELLOW}⚠ No data files found${NC}"
    fi
else
    echo -e "${RED}✗ OHLCV data directories not found in backup${NC}"
    exit 1
fi

echo -e "${YELLOW}[5/6] Restoring to Docker ClickHouse...${NC}"

# Get Docker volume path
DOCKER_VOLUME=$(docker volume inspect quantbot_clickhouse-data 2>/dev/null | grep -oP '"Mountpoint":\s*"\K[^"]+' || echo "")
if [[ -z "$DOCKER_VOLUME" ]]; then
    echo -e "${RED}Error: Could not find Docker volume path${NC}"
    exit 1
fi

echo "  Docker volume: $DOCKER_VOLUME"

# Restore data directory
if [[ -d "$OHLCV_DATA_DIR" ]]; then
    echo "  Restoring data directory..."
    mkdir -p "$DOCKER_VOLUME/data/quantbot"
    cp -r "$OHLCV_DATA_DIR" "$DOCKER_VOLUME/data/quantbot/" 2>&1 | tail -5 || {
        echo -e "${YELLOW}⚠ Some files may have failed to copy${NC}"
    }
    chown -R 101:101 "$DOCKER_VOLUME/data/quantbot/ohlcv_candles" 2>/dev/null || true
    echo -e "${GREEN}✓ Data directory restored${NC}"
fi

# Restore store directory
if [[ -d "$OHLCV_STORE_DIR" ]]; then
    echo "  Restoring store directory..."
    mkdir -p "$DOCKER_VOLUME/store/b6d"
    cp -r "$OHLCV_STORE_DIR" "$DOCKER_VOLUME/store/b6d/" 2>&1 | tail -5 || {
        echo -e "${YELLOW}⚠ Some files may have failed to copy${NC}"
    }
    chown -R 101:101 "$DOCKER_VOLUME/store/b6d" 2>/dev/null || true
    echo -e "${GREEN}✓ Store directory restored${NC}"
fi

# Also restore any other store directories that might contain OHLCV data
echo "  Checking for other store directories with OHLCV data..."
find "$EXTRACT_DIR/store" -type d -name "*2025*" 2>/dev/null | while read -r store_part; do
    # Check if this partition has data files
    if find "$store_part" -name "data.bin" 2>/dev/null | head -1 | grep -q .; then
        STORE_PARENT=$(dirname "$store_part")
        STORE_BASE=$(basename "$STORE_PARENT" | cut -c1-3)
        echo "    Found partition: $(basename "$store_part")"
        mkdir -p "$DOCKER_VOLUME/store/$STORE_BASE"
        cp -r "$STORE_PARENT" "$DOCKER_VOLUME/store/$STORE_BASE/" 2>&1 | tail -1 || true
    fi
done

echo -e "${GREEN}✓ Data restored to Docker volume${NC}"

echo -e "${YELLOW}[6/6] Starting ClickHouse and verifying...${NC}"
docker start quantbot-clickhouse-1 || true
sleep 5

echo ""
echo -e "${BLUE}=== Verification ===${NC}"

# Wait for ClickHouse to be ready
for i in {1..10}; do
    if docker exec quantbot-clickhouse-1 clickhouse-client --query "SELECT 1" &>/dev/null; then
        break
    fi
    sleep 1
done

if docker exec quantbot-clickhouse-1 clickhouse-client --query "SELECT COUNT(*) FROM quantbot.ohlcv_candles" 2>&1 | grep -qE "^[0-9]+$"; then
    ROW_COUNT=$(docker exec quantbot-clickhouse-1 clickhouse-client --query "SELECT COUNT(*) FROM quantbot.ohlcv_candles" 2>&1)
    echo ""
    echo -e "${GREEN}🎉 SUCCESS! OHLCV data recovered!${NC}"
    echo "  Total rows: $ROW_COUNT"
    echo ""
    
    # Get statistics
    echo "Date range:"
    docker exec quantbot-clickhouse-1 clickhouse-client --query "SELECT min(timestamp) as oldest, max(timestamp) as newest FROM quantbot.ohlcv_candles" 2>&1 || true
    
    echo ""
    echo "Unique tokens:"
    docker exec quantbot-clickhouse-1 clickhouse-client --query "SELECT COUNT(DISTINCT token_address) as unique_tokens FROM quantbot.ohlcv_candles" 2>&1 || true
    
    echo ""
    echo "Data by interval:"
    docker exec quantbot-clickhouse-1 clickhouse-client --query "SELECT \`interval\`, COUNT(*) as candle_count FROM quantbot.ohlcv_candles GROUP BY \`interval\` ORDER BY candle_count DESC" 2>&1 || true
    
    echo ""
    echo "Total table size:"
    docker exec quantbot-clickhouse-1 clickhouse-client --query "SELECT formatReadableSize(sum(bytes)) as size, sum(rows) as total_rows FROM system.parts WHERE database = 'quantbot' AND table = 'ohlcv_candles' AND active" 2>&1 || true
else
    echo -e "${YELLOW}⚠ Data restored but table still shows 0 rows${NC}"
    echo "  The data may need to be reattached. Checking for detached parts..."
    
    # Try to reattach parts
    docker exec quantbot-clickhouse-1 clickhouse-client --query "SELECT name FROM system.detached_parts WHERE database = 'quantbot' AND table = 'ohlcv_candles'" 2>&1 | head -10 || true
    
    echo ""
    echo "You may need to manually reattach parts using:"
    echo "  ALTER TABLE quantbot.ohlcv_candles ATTACH PART 'partition_name'"
fi

echo ""
echo "Recovery complete!"
echo "Temporary files will be cleaned up automatically."



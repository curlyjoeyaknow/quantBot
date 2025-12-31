#!/usr/bin/env bash
set -euo pipefail

# Backup ClickHouse OHLCV data to /home
# This script exports all OHLCV candle data from ClickHouse to CSV/Parquet files
# Run with: ./scripts/system/backup-clickhouse-ohlcv.sh

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKUP_DIR="/home/memez/clickhouse-ohlcv-backup"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_PATH="${BACKUP_DIR}/${TIMESTAMP}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== ClickHouse OHLCV Backup Script ===${NC}"
echo ""

# Check if ClickHouse is accessible
if ! docker exec quantbot-clickhouse-1 clickhouse-client --query "SELECT 1" &>/dev/null; then
    echo -e "${RED}Error: Cannot connect to ClickHouse${NC}"
    echo "Make sure ClickHouse container is running: docker ps | grep clickhouse"
    exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_PATH"
echo -e "${YELLOW}Backup directory: $BACKUP_PATH${NC}"
echo ""

# Check for data in main database
echo -e "${YELLOW}[1/4] Checking quantbot database...${NC}"
MAIN_COUNT=$(docker exec quantbot-clickhouse-1 clickhouse-client --query "SELECT COUNT(*) FROM quantbot.ohlcv_candles" 2>&1 || echo "0")
echo "  Rows in quantbot.ohlcv_candles: $MAIN_COUNT"

# Check for data in backup database
echo -e "${YELLOW}[2/4] Checking backup database...${NC}"
BACKUP_COUNT=$(docker exec quantbot-clickhouse-1 clickhouse-client --query "SELECT COUNT(*) FROM quantbot_backup_20251227.ohlcv_candles" 2>&1 || echo "0")
echo "  Rows in quantbot_backup_20251227.ohlcv_candles: $BACKUP_COUNT"

# Check for detached parts
echo -e "${YELLOW}[3/4] Checking for detached parts...${NC}"
DETACHED=$(docker exec quantbot-clickhouse-1 clickhouse-client --query "SELECT COUNT(*) FROM system.detached_parts WHERE database = 'quantbot' AND table = 'ohlcv_candles'" 2>&1 || echo "0")
echo "  Detached parts found: $DETACHED"

if [[ "$DETACHED" != "0" ]] && [[ "$DETACHED" != "" ]]; then
    echo "  Detached parts details:"
    docker exec quantbot-clickhouse-1 clickhouse-client --query "SELECT name, formatReadableSize(bytes_on_disk) as size, rows FROM system.detached_parts WHERE database = 'quantbot' AND table = 'ohlcv_candles' LIMIT 10" 2>&1 || true
fi

# Check inactive parts
echo -e "${YELLOW}[4/4] Checking for inactive parts...${NC}"
INACTIVE=$(docker exec quantbot-clickhouse-1 clickhouse-client --query "SELECT COUNT(*) FROM system.parts WHERE database = 'quantbot' AND table = 'ohlcv_candles' AND active = 0" 2>&1 || echo "0")
echo "  Inactive parts found: $INACTIVE"

TOTAL_ROWS=$((MAIN_COUNT + BACKUP_COUNT))

if [[ $TOTAL_ROWS -eq 0 ]] && [[ "$DETACHED" == "0" ]] && [[ "$INACTIVE" == "0" ]]; then
    echo ""
    echo -e "${YELLOW}⚠ No data found in ClickHouse OHLCV tables${NC}"
    echo "The tables exist but are empty."
    echo ""
    echo "Checking for data in store directories..."
    
    # Check store directories for actual data files
    STORE_DATA=$(docker exec quantbot-clickhouse-1 find /var/lib/clickhouse/store -type d -name "*2025*" -o -name "*2024*" 2>&1 | wc -l)
    if [[ $STORE_DATA -gt 0 ]]; then
        echo "  Found $STORE_DATA partition directories in store"
        echo "  These may contain data that needs to be reattached"
    fi
    
    echo ""
    echo "Options:"
    echo "  1. Export schema only (no data)"
    echo "  2. Check for data in other locations"
    echo "  3. Exit"
    read -p "Choose option (1-3): " -r
    case $REPLY in
        1)
            echo "Exporting schema..."
            docker exec quantbot-clickhouse-1 clickhouse-client --query "SHOW CREATE TABLE quantbot.ohlcv_candles" > "${BACKUP_PATH}/ohlcv_candles_schema.sql" 2>&1
            echo -e "${GREEN}✓ Schema exported to ${BACKUP_PATH}/ohlcv_candles_schema.sql${NC}"
            ;;
        2)
            echo "Checking store directories..."
            docker exec quantbot-clickhouse-1 find /var/lib/clickhouse/store -type d -name "*2025*" 2>&1 | while read -r dir; do
                SIZE=$(docker exec quantbot-clickhouse-1 du -sh "$dir" 2>&1 | cut -f1)
                echo "  $dir: $SIZE"
            done
            ;;
        3)
            echo "Exiting..."
            exit 0
            ;;
    esac
else
    echo ""
    echo -e "${GREEN}Found data! Creating backup...${NC}"
    echo ""
    
    # Export main database
    if [[ $MAIN_COUNT -gt 0 ]]; then
        echo "Exporting quantbot.ohlcv_candles ($MAIN_COUNT rows)..."
        docker exec quantbot-clickhouse-1 clickhouse-client \
            --query "SELECT * FROM quantbot.ohlcv_candles FORMAT CSV" \
            > "${BACKUP_PATH}/quantbot_ohlcv_candles.csv" 2>&1
        
        # Also export as Parquet for better compression
        docker exec quantbot-clickhouse-1 clickhouse-client \
            --query "SELECT * FROM quantbot.ohlcv_candles FORMAT Parquet" \
            > "${BACKUP_PATH}/quantbot_ohlcv_candles.parquet" 2>&1
        
        echo -e "${GREEN}✓ Exported to ${BACKUP_PATH}/quantbot_ohlcv_candles.{csv,parquet}${NC}"
    fi
    
    # Export backup database
    if [[ $BACKUP_COUNT -gt 0 ]]; then
        echo "Exporting quantbot_backup_20251227.ohlcv_candles ($BACKUP_COUNT rows)..."
        docker exec quantbot-clickhouse-1 clickhouse-client \
            --query "SELECT * FROM quantbot_backup_20251227.ohlcv_candles FORMAT CSV" \
            > "${BACKUP_PATH}/quantbot_backup_20251227_ohlcv_candles.csv" 2>&1
        
        docker exec quantbot-clickhouse-1 clickhouse-client \
            --query "SELECT * FROM quantbot_backup_20251227.ohlcv_candles FORMAT Parquet" \
            > "${BACKUP_PATH}/quantbot_backup_20251227_ohlcv_candles.parquet" 2>&1
        
        echo -e "${GREEN}✓ Exported to ${BACKUP_PATH}/quantbot_backup_20251227_ohlcv_candles.{csv,parquet}${NC}"
    fi
    
    # Export schema
    echo "Exporting schema..."
    docker exec quantbot-clickhouse-1 clickhouse-client --query "SHOW CREATE TABLE quantbot.ohlcv_candles" > "${BACKUP_PATH}/ohlcv_candles_schema.sql" 2>&1
    echo -e "${GREEN}✓ Schema exported${NC}"
    
    # Calculate backup size
    BACKUP_SIZE=$(du -sh "$BACKUP_PATH" | cut -f1)
    echo ""
    echo -e "${GREEN}=== Backup Complete ===${NC}"
    echo "Backup location: $BACKUP_PATH"
    echo "Backup size: $BACKUP_SIZE"
    echo "Total rows backed up: $TOTAL_ROWS"
fi

echo ""
echo "To restore data:"
echo "  clickhouse-client --query \"INSERT INTO quantbot.ohlcv_candles FORMAT CSV\" < ${BACKUP_PATH}/quantbot_ohlcv_candles.csv"


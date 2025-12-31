#!/usr/bin/env bash
set -euo pipefail

# Verify ClickHouse backup and check for OHLCV data
# Run with: ./scripts/system/verify-clickhouse-backup.sh

BACKUP_TAR="/home/memez/docker-backup/20251228_224159/volumes/quantbot_clickhouse-data.tar"
EXTRACT_DIR="/tmp/clickhouse-backup-verify-$$"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== ClickHouse Backup Verification ===${NC}"
echo ""

# Check if backup exists
if [[ ! -f "$BACKUP_TAR" ]]; then
    echo -e "${RED}Error: Backup file not found: $BACKUP_TAR${NC}"
    exit 1
fi

BACKUP_SIZE=$(du -sh "$BACKUP_TAR" | cut -f1)
echo -e "${YELLOW}Backup file: $BACKUP_TAR${NC}"
echo -e "${YELLOW}Size: $BACKUP_SIZE${NC}"
echo ""

# Create temporary extract directory
mkdir -p "$EXTRACT_DIR"
trap "rm -rf $EXTRACT_DIR" EXIT

echo -e "${YELLOW}[1/4] Extracting backup (this may take a while)...${NC}"
cd "$EXTRACT_DIR"
tar -xf "$BACKUP_TAR" 2>&1 | head -20 || {
    echo -e "${RED}Error extracting backup${NC}"
    exit 1
}
echo -e "${GREEN}✓ Extraction complete${NC}"
echo ""

# Check structure
echo -e "${YELLOW}[2/4] Checking backup structure...${NC}"
if [[ -d "$EXTRACT_DIR/data" ]]; then
    echo -e "${GREEN}✓ Data directory found${NC}"
    DATABASES=$(find "$EXTRACT_DIR/data" -mindepth 1 -maxdepth 1 -type d | wc -l)
    echo "  Databases found: $DATABASES"
    find "$EXTRACT_DIR/data" -mindepth 1 -maxdepth 1 -type d | while read -r db; do
        echo "    - $(basename "$db")"
    done
else
    echo -e "${RED}✗ Data directory not found${NC}"
fi

if [[ -d "$EXTRACT_DIR/store" ]]; then
    echo -e "${GREEN}✓ Store directory found${NC}"
    STORE_SIZE=$(du -sh "$EXTRACT_DIR/store" 2>/dev/null | cut -f1 || echo "0")
    echo "  Store size: $STORE_SIZE"
else
    echo -e "${YELLOW}⚠ Store directory not found${NC}"
fi

if [[ -d "$EXTRACT_DIR/metadata" ]]; then
    echo -e "${GREEN}✓ Metadata directory found${NC}"
    METADATA_DBS=$(find "$EXTRACT_DIR/metadata" -name "*.sql" -o -name "*" -type d | grep -v "^$EXTRACT_DIR/metadata$" | wc -l)
    echo "  Metadata files/dirs: $METADATA_DBS"
else
    echo -e "${YELLOW}⚠ Metadata directory not found${NC}"
fi
echo ""

# Check for OHLCV data
echo -e "${YELLOW}[3/4] Checking for OHLCV candle data...${NC}"

# Check in data directory
if [[ -d "$EXTRACT_DIR/data/quantbot" ]]; then
    echo "  Checking quantbot database..."
    if [[ -d "$EXTRACT_DIR/data/quantbot/ohlcv_candles" ]]; then
        echo -e "    ${GREEN}✓ ohlcv_candles table directory found${NC}"
        
        # Check for partition directories
        PARTITIONS=$(find "$EXTRACT_DIR/data/quantbot/ohlcv_candles" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
        if [[ $PARTITIONS -gt 0 ]]; then
            echo "    Partitions found: $PARTITIONS"
            find "$EXTRACT_DIR/data/quantbot/ohlcv_candles" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | while read -r part; do
                SIZE=$(du -sh "$part" 2>/dev/null | cut -f1 || echo "0")
                echo "      - $(basename "$part"): $SIZE"
            done
        else
            echo -e "    ${YELLOW}⚠ No partition directories found${NC}"
        fi
        
        # Check for data files
        DATA_FILES=$(find "$EXTRACT_DIR/data/quantbot/ohlcv_candles" -name "*.bin" -o -name "*.mrk" 2>/dev/null | wc -l)
        if [[ $DATA_FILES -gt 0 ]]; then
            echo -e "    ${GREEN}✓ Found $DATA_FILES data files (.bin/.mrk)${NC}"
            find "$EXTRACT_DIR/data/quantbot/ohlcv_candles" -name "*.bin" 2>/dev/null | head -5 | while read -r file; do
                SIZE=$(du -sh "$file" 2>/dev/null | cut -f1 || echo "0")
                echo "      - $(basename "$file"): $SIZE"
            done
        else
            echo -e "    ${YELLOW}⚠ No data files found${NC}"
        fi
    else
        echo -e "    ${YELLOW}⚠ ohlcv_candles table directory not found${NC}"
    fi
fi

# Check in store directory
if [[ -d "$EXTRACT_DIR/store" ]]; then
    echo "  Checking store directory for OHLCV data..."
    
    # Find store directories that might contain OHLCV data
    STORE_DIRS=$(find "$EXTRACT_DIR/store" -type d -name "*b6d*" 2>/dev/null | head -5)
    if [[ -n "$STORE_DIRS" ]]; then
        echo "    Found potential OHLCV store directories:"
        echo "$STORE_DIRS" | while read -r dir; do
            SIZE=$(du -sh "$dir" 2>/dev/null | cut -f1 || echo "0")
            PARTITIONS=$(find "$dir" -type d -name "*2025*" -o -name "*2024*" 2>/dev/null | wc -l)
            echo "      - $dir: $SIZE ($PARTITIONS partitions)"
        done
    fi
    
    # Check for partition directories with data
    PARTITION_DIRS=$(find "$EXTRACT_DIR/store" -type d -name "*2025*" -o -name "*2024*" 2>/dev/null | head -10)
    if [[ -n "$PARTITION_DIRS" ]]; then
        echo "    Found partition directories:"
        echo "$PARTITION_DIRS" | while read -r part; do
            SIZE=$(du -sh "$part" 2>/dev/null | cut -f1 || echo "0")
            BIN_FILES=$(find "$part" -name "*.bin" 2>/dev/null | wc -l)
            echo "      - $(basename "$part"): $SIZE ($BIN_FILES .bin files)"
        done
    fi
fi

# Check backup database
if [[ -d "$EXTRACT_DIR/data/quantbot_backup_20251227" ]]; then
    echo "  Checking quantbot_backup_20251227 database..."
    if [[ -d "$EXTRACT_DIR/data/quantbot_backup_20251227/ohlcv_candles" ]]; then
        echo -e "    ${GREEN}✓ Backup database ohlcv_candles found${NC}"
        BACKUP_PARTITIONS=$(find "$EXTRACT_DIR/data/quantbot_backup_20251227/ohlcv_candles" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | wc -l)
        echo "    Partitions: $BACKUP_PARTITIONS"
    fi
fi
echo ""

# Calculate total OHLCV data size
echo -e "${YELLOW}[4/4] Calculating OHLCV data size...${NC}"
OHLCV_SIZE=0
if [[ -d "$EXTRACT_DIR/data/quantbot/ohlcv_candles" ]]; then
    OHLCV_SIZE=$(du -sb "$EXTRACT_DIR/data/quantbot/ohlcv_candles" 2>/dev/null | cut -f1 || echo "0")
fi
if [[ -d "$EXTRACT_DIR/data/quantbot_backup_20251227/ohlcv_candles" ]]; then
    BACKUP_SIZE_BYTES=$(du -sb "$EXTRACT_DIR/data/quantbot_backup_20251227/ohlcv_candles" 2>/dev/null | cut -f1 || echo "0")
    OHLCV_SIZE=$((OHLCV_SIZE + BACKUP_SIZE_BYTES))
fi

if [[ $OHLCV_SIZE -gt 0 ]]; then
    OHLCV_SIZE_HUMAN=$(numfmt --to=iec-i --suffix=B $OHLCV_SIZE 2>/dev/null || echo "${OHLCV_SIZE} bytes")
    echo -e "${GREEN}✓ OHLCV data found: $OHLCV_SIZE_HUMAN${NC}"
else
    echo -e "${YELLOW}⚠ No OHLCV data found in backup${NC}"
fi

# Summary
echo ""
echo -e "${BLUE}=== Summary ===${NC}"
echo "Backup file: $BACKUP_TAR"
echo "Backup size: $BACKUP_SIZE"
if [[ $OHLCV_SIZE -gt 0 ]]; then
    echo -e "${GREEN}OHLCV data: Found ($OHLCV_SIZE_HUMAN)${NC}"
    echo ""
    echo "To restore OHLCV data:"
    echo "  1. Stop ClickHouse container"
    echo "  2. Extract backup to ClickHouse data directory"
    echo "  3. Restart ClickHouse container"
else
    echo -e "${YELLOW}OHLCV data: Not found in backup${NC}"
fi

echo ""
echo "Extracted backup location: $EXTRACT_DIR"
echo "You can inspect it manually before it's cleaned up."


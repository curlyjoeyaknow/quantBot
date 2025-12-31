#!/usr/bin/env bash
set -euo pipefail

# Attempt to recover ClickHouse OHLCV data from store directories
# This script tries to reattach detached parts or identify recoverable data
# Run with: sudo ./scripts/system/recover-clickhouse-ohlcv.sh

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== ClickHouse OHLCV Recovery Script ===${NC}"
echo ""

# Check if ClickHouse is accessible
if ! docker exec quantbot-clickhouse-1 clickhouse-client --query "SELECT 1" &>/dev/null; then
    echo -e "${RED}Error: Cannot connect to ClickHouse${NC}"
    exit 1
fi

# Get table UUID
echo -e "${YELLOW}[1/3] Finding table UUID...${NC}"
TABLE_UUID=$(docker exec quantbot-clickhouse-1 clickhouse-client --query "SELECT uuid FROM system.tables WHERE database = 'quantbot' AND name = 'ohlcv_candles'" 2>&1 || echo "")
if [[ -z "$TABLE_UUID" ]] || [[ "$TABLE_UUID" == *"Exception"* ]]; then
    echo -e "${RED}Error: Could not find table UUID${NC}"
    exit 1
fi
echo "  Table UUID: $TABLE_UUID"

# Find store directory for this table
echo -e "${YELLOW}[2/3] Finding data in store...${NC}"
STORE_DIR=$(docker exec quantbot-clickhouse-1 find /var/lib/clickhouse/store -type d -name "*${TABLE_UUID:0:3}*" 2>&1 | head -1)
if [[ -n "$STORE_DIR" ]]; then
    echo "  Store directory: $STORE_DIR"
    STORE_SIZE=$(docker exec quantbot-clickhouse-1 du -sh "$STORE_DIR" 2>&1 | cut -f1)
    echo "  Store size: $STORE_SIZE"
    
    # Count partition directories
    PARTITION_COUNT=$(docker exec quantbot-clickhouse-1 find "$STORE_DIR" -type d -name "*2025*" -o -name "*2024*" 2>&1 | wc -l)
    echo "  Partition directories found: $PARTITION_COUNT"
    
    if [[ $PARTITION_COUNT -gt 0 ]]; then
        echo ""
        echo -e "${YELLOW}Found $PARTITION_COUNT partition directories with potential data!${NC}"
        echo ""
        echo "These partitions may contain OHLCV data that can be recovered."
        echo ""
        echo "Options:"
        echo "  1. List all partitions with sizes"
        echo "  2. Attempt to reattach parts (requires ClickHouse knowledge)"
        echo "  3. Export raw data files to /home for manual recovery"
        echo "  4. Exit"
        read -p "Choose option (1-4): " -r
        case $REPLY in
            1)
                echo ""
                echo "Partitions with data:"
                docker exec quantbot-clickhouse-1 find "$STORE_DIR" -type d -name "*2025*" -o -name "*2024*" 2>&1 | while read -r part; do
                    SIZE=$(docker exec quantbot-clickhouse-1 du -sh "$part" 2>&1 | cut -f1)
                    echo "  $(basename "$part"): $SIZE"
                done | sort -h
                ;;
            2)
                echo ""
                echo -e "${YELLOW}Attempting to reattach parts...${NC}"
                echo "This is advanced and may require manual intervention."
                echo "Parts need to be moved to the correct location and reattached."
                echo ""
                echo "To manually reattach, you would need to:"
                echo "  1. Identify the correct partition format"
                echo "  2. Move parts to /var/lib/clickhouse/data/quantbot/ohlcv_candles/detached/"
                echo "  3. Use: ALTER TABLE quantbot.ohlcv_candles ATTACH PART 'partition_name'"
                ;;
            3)
                BACKUP_DIR="/home/memez/clickhouse-raw-recovery/$(date +%Y%m%d_%H%M%S)"
                mkdir -p "$BACKUP_DIR"
                echo ""
                echo -e "${YELLOW}Copying raw data files to: $BACKUP_DIR${NC}"
                echo "This will copy the partition directories for manual recovery..."
                
                # Copy store directory structure
                docker cp "quantbot-clickhouse-1:$STORE_DIR" "$BACKUP_DIR/store" 2>&1 || {
                    echo -e "${RED}Error: Could not copy data files${NC}"
                    echo "You may need to copy manually or use a different method"
                }
                
                if [[ -d "$BACKUP_DIR/store" ]]; then
                    BACKUP_SIZE=$(du -sh "$BACKUP_DIR" | cut -f1)
                    echo -e "${GREEN}✓ Copied to $BACKUP_DIR${NC}"
                    echo "  Backup size: $BACKUP_SIZE"
                    echo ""
                    echo "Raw data files are now in: $BACKUP_DIR"
                    echo "These can be used for manual recovery or analysis."
                fi
                ;;
            4)
                echo "Exiting..."
                exit 0
                ;;
        esac
    else
        echo -e "${YELLOW}No partition directories found in store${NC}"
    fi
else
    echo -e "${YELLOW}Could not find store directory for this table${NC}"
fi

echo ""
echo -e "${YELLOW}[3/3] Summary${NC}"
echo "The ClickHouse ohlcv_candles table currently shows 0 rows."
echo "However, there are partition directories in the store that may contain data."
echo ""
echo "The data migration from root to /home preserved the store structure,"
echo "but the parts may need to be reattached to the table."
echo ""
echo "For recovery, you may need to:"
echo "  1. Identify which partitions belong to ohlcv_candles"
echo "  2. Move them to the detached directory"
echo "  3. Use ALTER TABLE ... ATTACH PART to reattach them"
echo ""
echo "Or export the raw files and restore manually."


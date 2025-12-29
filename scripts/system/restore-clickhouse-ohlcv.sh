#!/usr/bin/env bash
set -euo pipefail

# Restore ClickHouse OHLCV data from backup directory
# Supports CSV, Parquet, and raw ClickHouse data directory formats
# Run with: ./scripts/system/restore-clickhouse-ohlcv.sh [source_directory]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Default source directory (can be overridden)
SOURCE_DIR="${1:-${PROJECT_ROOT}/clickhouse-data}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}=== ClickHouse OHLCV Restore Script ===${NC}"
echo ""

# Check if source directory exists
if [[ ! -d "$SOURCE_DIR" ]]; then
    echo -e "${RED}Error: Source directory not found: $SOURCE_DIR${NC}"
    echo ""
    echo "Usage: $0 [source_directory]"
    echo ""
    echo "Examples:"
    echo "  $0                                    # Uses ./clickhouse-data"
    echo "  $0 /home/memez/clickhouse-data       # Uses specified directory"
    echo "  $0 /home/memez/clickhouse-ohlcv-backup/20251228_120000"
    exit 1
fi

echo -e "${YELLOW}Source directory: $SOURCE_DIR${NC}"
echo ""

# Detect ClickHouse container name (handles both naming conventions)
CLICKHOUSE_CONTAINER=$(docker ps --format "{{.Names}}" | grep -i clickhouse | head -1)
if [[ -z "$CLICKHOUSE_CONTAINER" ]]; then
    echo -e "${RED}Error: ClickHouse container not found${NC}"
    echo "Make sure ClickHouse container is running: docker ps | grep clickhouse"
    exit 1
fi

echo "  Using ClickHouse container: $CLICKHOUSE_CONTAINER"

# Check if ClickHouse is accessible
if ! docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "SELECT 1" &>/dev/null; then
    echo -e "${RED}Error: Cannot connect to ClickHouse${NC}"
    echo "Container $CLICKHOUSE_CONTAINER is running but not responding"
    exit 1
fi

# Detect backup format
echo -e "${YELLOW}[1/5] Detecting backup format...${NC}"

HAS_CSV=false
HAS_PARQUET=false
HAS_SCHEMA=false
HAS_RAW_DATA=false

# Check for CSV files
if find "$SOURCE_DIR" -maxdepth 1 -type f -name "*.csv" | grep -q .; then
    HAS_CSV=true
    CSV_FILES=$(find "$SOURCE_DIR" -maxdepth 1 -type f -name "*.csv")
    echo -e "${GREEN}✓ Found CSV files${NC}"
    echo "$CSV_FILES" | while read -r file; do
        SIZE=$(du -sh "$file" 2>/dev/null | cut -f1 || echo "unknown")
        echo "    - $(basename "$file"): $SIZE"
    done
fi

# Check for Parquet files
if find "$SOURCE_DIR" -maxdepth 1 -type f -name "*.parquet" | grep -q .; then
    HAS_PARQUET=true
    PARQUET_FILES=$(find "$SOURCE_DIR" -maxdepth 1 -type f -name "*.parquet")
    echo -e "${GREEN}✓ Found Parquet files${NC}"
    echo "$PARQUET_FILES" | while read -r file; do
        SIZE=$(du -sh "$file" 2>/dev/null | cut -f1 || echo "unknown")
        echo "    - $(basename "$file"): $SIZE"
    done
fi

# Check for schema SQL
if find "$SOURCE_DIR" -maxdepth 1 -type f -name "*schema*.sql" | grep -q .; then
    HAS_SCHEMA=true
    SCHEMA_FILE=$(find "$SOURCE_DIR" -maxdepth 1 -type f -name "*schema*.sql" | head -1)
    echo -e "${GREEN}✓ Found schema file: $(basename "$SCHEMA_FILE")${NC}"
fi

# Check for raw ClickHouse data structure
if [[ -d "$SOURCE_DIR/data" ]] || [[ -d "$SOURCE_DIR/store" ]]; then
    HAS_RAW_DATA=true
    echo -e "${GREEN}✓ Found raw ClickHouse data structure${NC}"
    if [[ -d "$SOURCE_DIR/data" ]]; then
        echo "    - data/ directory found"
    fi
    if [[ -d "$SOURCE_DIR/store" ]]; then
        echo "    - store/ directory found"
    fi
fi

if [[ "$HAS_CSV" == "false" ]] && [[ "$HAS_PARQUET" == "false" ]] && [[ "$HAS_RAW_DATA" == "false" ]]; then
    echo -e "${RED}Error: No backup files found in $SOURCE_DIR${NC}"
    echo ""
    echo "Expected files:"
    echo "  - CSV files (*.csv)"
    echo "  - Parquet files (*.parquet)"
    echo "  - Schema file (*schema*.sql)"
    echo "  - Or raw ClickHouse data (data/ and/or store/ directories)"
    exit 1
fi

echo ""

# Warning
echo -e "${RED}⚠️  WARNING: This will OVERWRITE existing OHLCV data!${NC}"
echo -e "${RED}   Current data in quantbot.ohlcv_candles will be DESTROYED${NC}"
echo ""
read -p "Are you sure you want to continue? (type 'yes' to confirm): " CONFIRM

if [[ "$CONFIRM" != "yes" ]]; then
    echo -e "${YELLOW}❌ Restore cancelled${NC}"
    exit 0
fi

# Check current row count
echo ""
echo -e "${YELLOW}[2/5] Checking current database state...${NC}"
CURRENT_COUNT=$(docker exec $CLICKHOUSE_CONTAINER clickhouse-client --query "SELECT COUNT(*) FROM quantbot.ohlcv_candles" 2>&1 || echo "0")
if [[ "$CURRENT_COUNT" =~ ^[0-9]+$ ]]; then
    echo "  Current rows in quantbot.ohlcv_candles: $CURRENT_COUNT"
    if [[ $CURRENT_COUNT -gt 0 ]]; then
        echo -e "${YELLOW}  ⚠ Existing data will be replaced${NC}"
    fi
else
    echo "  Table may not exist or is empty"
fi

# Restore schema if needed
if [[ "$HAS_SCHEMA" == "true" ]]; then
    echo ""
    echo -e "${YELLOW}[3/5] Restoring schema...${NC}"
    
    # Check if table exists
    TABLE_EXISTS=$(docker exec $CLICKHOUSE_CONTAINER clickhouse-client --query "EXISTS TABLE quantbot.ohlcv_candles" 2>&1 || echo "0")
    
    if [[ "$TABLE_EXISTS" == "1" ]]; then
        echo "  Table exists, dropping and recreating..."
        docker exec $CLICKHOUSE_CONTAINER clickhouse-client --query "DROP TABLE IF EXISTS quantbot.ohlcv_candles" 2>&1
    fi
    
    # Create table from schema
    echo "  Creating table from schema..."
    if docker exec -i $CLICKHOUSE_CONTAINER clickhouse-client < "$SCHEMA_FILE" 2>&1; then
        echo -e "${GREEN}✓ Schema restored${NC}"
    else
        echo -e "${RED}✗ Failed to restore schema${NC}"
        echo "  Attempting to continue with existing table..."
    fi
else
    echo ""
    echo -e "${YELLOW}[3/5] Schema restoration skipped (no schema file found)${NC}"
    echo "  Assuming table already exists or will be created automatically"
fi

# Restore data
echo ""
echo -e "${YELLOW}[4/5] Restoring data...${NC}"

RESTORED_ROWS=0

# Restore from CSV files
if [[ "$HAS_CSV" == "true" ]]; then
    echo "  Restoring from CSV files..."
    echo "$CSV_FILES" | while read -r csv_file; do
        FILENAME=$(basename "$csv_file")
        echo "    Processing $FILENAME..."
        
        # Count rows in CSV (approximate)
        CSV_ROWS=$(wc -l < "$csv_file" 2>/dev/null || echo "0")
        if [[ $CSV_ROWS -gt 0 ]]; then
            CSV_ROWS=$((CSV_ROWS - 1))  # Subtract header if present
        fi
        echo "      Estimated rows: $CSV_ROWS"
        
        # Import CSV
        if docker exec -i $CLICKHOUSE_CONTAINER clickhouse-client \
            --query "INSERT INTO quantbot.ohlcv_candles FORMAT CSV" < "$csv_file" 2>&1; then
            echo -e "      ${GREEN}✓ Imported $FILENAME${NC}"
            RESTORED_ROWS=$((RESTORED_ROWS + CSV_ROWS))
        else
            echo -e "      ${RED}✗ Failed to import $FILENAME${NC}"
        fi
    done
fi

# Restore from Parquet files (preferred if available)
if [[ "$HAS_PARQUET" == "true" ]]; then
    echo "  Restoring from Parquet files..."
    echo "$PARQUET_FILES" | while read -r parquet_file; do
        FILENAME=$(basename "$parquet_file")
        echo "    Processing $FILENAME..."
        
        # Copy Parquet file to container
        TEMP_FILE="/tmp/$(basename "$parquet_file")"
        docker cp "$parquet_file" "$CLICKHOUSE_CONTAINER:$TEMP_FILE" 2>&1
        
        # Import Parquet
        if docker exec $CLICKHOUSE_CONTAINER clickhouse-client \
            --query "INSERT INTO quantbot.ohlcv_candles FROM INFILE '$TEMP_FILE' FORMAT Parquet" 2>&1; then
            echo -e "      ${GREEN}✓ Imported $FILENAME${NC}"
            
            # Get actual row count
            ROWS=$(docker exec $CLICKHOUSE_CONTAINER clickhouse-client \
                --query "SELECT COUNT(*) FROM quantbot.ohlcv_candles" 2>&1 || echo "0")
            RESTORED_ROWS=$ROWS
        else
            echo -e "      ${RED}✗ Failed to import $FILENAME${NC}"
        fi
        
        # Clean up temp file
        docker exec $CLICKHOUSE_CONTAINER rm -f "$TEMP_FILE" 2>&1 || true
    done
fi

# Handle raw ClickHouse data (advanced - requires stopping container)
if [[ "$HAS_RAW_DATA" == "true" ]]; then
    echo ""
    echo -e "${YELLOW}⚠ Raw ClickHouse data detected${NC}"
    echo "  Raw data restoration requires:"
    echo "    1. Stopping ClickHouse container"
    echo "    2. Copying data/store directories"
    echo "    3. Restarting container"
    echo ""
    read -p "  Attempt automatic raw data restore? (type 'yes'): " RESTORE_RAW
    
    if [[ "$RESTORE_RAW" == "yes" ]]; then
        echo ""
        echo -e "${YELLOW}  Stopping ClickHouse container...${NC}"
        docker-compose -f "$PROJECT_ROOT/docker-compose.yml" stop clickhouse 2>&1 || true
        
        # Get Docker volume mount point
        echo "  Finding ClickHouse volume..."
        VOLUME_MOUNT=$(docker volume inspect quantbot_clickhouse-data 2>/dev/null | grep -oP '(?<="Mountpoint": ")[^"]+' || echo "")
        
        if [[ -z "$VOLUME_MOUNT" ]]; then
            echo -e "${RED}  ✗ Could not find ClickHouse volume mount point${NC}"
            echo "  Attempting to use container path..."
            VOLUME_MOUNT="/var/lib/clickhouse"
            USE_DOCKER_CP=true
        else
            USE_DOCKER_CP=false
            echo "  Volume mount: $VOLUME_MOUNT"
        fi
        
        echo "  Copying data files..."
        
        # Method 1: Use temporary container with volume mounted (preferred)
        echo "    Using temporary container to access volume..."
        TEMP_CONTAINER="temp-clickhouse-restore-$$"
        
        # Start temporary container with volume mounted
        docker run -d --name "$TEMP_CONTAINER" \
            -v quantbot_clickhouse-data:/var/lib/clickhouse \
            clickhouse/clickhouse-server:latest \
            sleep 3600 2>&1 || {
            echo -e "${RED}    ✗ Failed to create temporary container${NC}"
            echo "    Trying alternative method..."
        }
        
        sleep 2
        
        # Remove existing table symlinks/directories that might conflict
        echo "    Cleaning up existing table directories..."
        docker exec "$TEMP_CONTAINER" rm -rf /var/lib/clickhouse/data/quantbot/ohlcv_candles 2>&1 || true
        
        # Copy data directory if it exists
        if [[ -d "$SOURCE_DIR/data" ]]; then
            echo "    Copying data/ directory..."
            
            # Check if source has quantbot database
            if [[ -d "$SOURCE_DIR/data/quantbot" ]]; then
                echo "      Found quantbot database in source..."
                
                # Copy quantbot database specifically
                docker cp "$SOURCE_DIR/data/quantbot/." "${TEMP_CONTAINER}:/var/lib/clickhouse/data/quantbot/." 2>&1 && {
                    echo -e "      ${GREEN}✓ Copied quantbot database${NC}"
                } || {
                    echo -e "${YELLOW}      ⚠ Direct copy failed, trying individual table copy...${NC}"
                    
                    # Try copying individual tables
                    if [[ -d "$SOURCE_DIR/data/quantbot/ohlcv_candles" ]]; then
                        echo "      Copying ohlcv_candles table..."
                        docker exec "$TEMP_CONTAINER" mkdir -p /var/lib/clickhouse/data/quantbot 2>&1 || true
                        docker cp "$SOURCE_DIR/data/quantbot/ohlcv_candles" "${TEMP_CONTAINER}:/var/lib/clickhouse/data/quantbot/" 2>&1 && {
                            echo -e "        ${GREEN}✓ Copied ohlcv_candles table${NC}"
                        } || {
                            echo -e "${RED}        ✗ Failed to copy ohlcv_candles table${NC}"
                        }
                    fi
                }
            else
                # Copy entire data directory structure
                echo "      Copying entire data directory structure..."
                docker cp "$SOURCE_DIR/data/." "${TEMP_CONTAINER}:/var/lib/clickhouse/data/." 2>&1 && {
                    echo -e "      ${GREEN}✓ Copied data directory${NC}"
                } || {
                    echo -e "${RED}      ✗ Failed to copy data directory${NC}"
                    echo "      Attempting direct volume copy..."
                    
                    # Fallback: direct copy to volume mount
                    if [[ -n "$VOLUME_MOUNT" ]] && sudo test -d "$VOLUME_MOUNT"; then
                        echo "      Using sudo to copy directly to volume..."
                        # Remove existing symlink first
                        sudo rm -f "$VOLUME_MOUNT/data/quantbot/ohlcv_candles" 2>&1 || true
                        sudo cp -r "$SOURCE_DIR/data/." "$VOLUME_MOUNT/data/." 2>&1 && {
                            echo -e "        ${GREEN}✓ Copied data directory (direct)${NC}"
                            sudo chown -R 101:101 "$VOLUME_MOUNT/data" 2>&1 || true
                        } || {
                            echo -e "${RED}        ✗ Direct copy also failed${NC}"
                        }
                    fi
                }
            fi
        fi
        
        # Copy store directory if it exists
        if [[ -d "$SOURCE_DIR/store" ]]; then
            echo "    Copying store/ directory..."
            docker cp "$SOURCE_DIR/store/." "${TEMP_CONTAINER}:/var/lib/clickhouse/store/." 2>&1 && {
                echo -e "      ${GREEN}✓ Copied store directory${NC}"
            } || {
                echo -e "${YELLOW}      ⚠ Failed to copy store directory via docker cp${NC}"
                echo "      Attempting direct volume copy..."
                
                # Fallback: direct copy to volume mount
                if [[ -n "$VOLUME_MOUNT" ]] && sudo test -d "$VOLUME_MOUNT"; then
                    echo "      Using sudo to copy store directory directly..."
                    sudo cp -r "$SOURCE_DIR/store/." "$VOLUME_MOUNT/store/." 2>&1 && {
                        echo -e "        ${GREEN}✓ Copied store directory (direct)${NC}"
                        sudo chown -R 101:101 "$VOLUME_MOUNT/store" 2>&1 || true
                    } || {
                        echo -e "${YELLOW}        ⚠ Store directory copy failed (may not be critical)${NC}"
                    }
                fi
            }
        else
            echo "    No store/ directory found in source (this is OK if data is in data/ only)"
        fi
        
        # Fix permissions on copied data
        echo "    Fixing permissions..."
        docker exec "$TEMP_CONTAINER" chown -R 101:101 /var/lib/clickhouse/data 2>&1 || true
        docker exec "$TEMP_CONTAINER" chown -R 101:101 /var/lib/clickhouse/store 2>&1 || true
        
        # Clean up temporary container
        docker stop "$TEMP_CONTAINER" 2>&1 || true
        docker rm "$TEMP_CONTAINER" 2>&1 || true
        
        echo "  Restarting ClickHouse container..."
        docker-compose -f "$PROJECT_ROOT/docker-compose.yml" start clickhouse 2>&1 || true
        
        echo "  Waiting for ClickHouse to be ready..."
        MAX_WAIT=30
        WAIT_COUNT=0
        while [[ $WAIT_COUNT -lt $MAX_WAIT ]]; do
            if docker exec $CLICKHOUSE_CONTAINER clickhouse-client --query "SELECT 1" &>/dev/null; then
                echo -e "    ${GREEN}✓ ClickHouse is ready${NC}"
                break
            fi
            sleep 1
            WAIT_COUNT=$((WAIT_COUNT + 1))
            echo -n "."
        done
        echo ""
        
        if [[ $WAIT_COUNT -ge $MAX_WAIT ]]; then
            echo -e "${YELLOW}  ⚠ ClickHouse may not be fully ready, but continuing...${NC}"
        fi
    fi
fi

# Verify restore
echo ""
echo -e "${YELLOW}[5/5] Verifying restore...${NC}"

# Check if table exists
TABLE_EXISTS=$(docker exec $CLICKHOUSE_CONTAINER clickhouse-client --query "EXISTS TABLE quantbot.ohlcv_candles" 2>&1 || echo "0")
if [[ "$TABLE_EXISTS" != "1" ]]; then
    echo -e "${RED}✗ Table quantbot.ohlcv_candles does not exist${NC}"
    echo ""
    echo "  Attempting to create table from schema if available..."
    if [[ "$HAS_SCHEMA" == "true" ]] && [[ -f "$SCHEMA_FILE" ]]; then
        docker exec -i $CLICKHOUSE_CONTAINER clickhouse-client < "$SCHEMA_FILE" 2>&1 && {
            echo -e "  ${GREEN}✓ Table created from schema${NC}"
        } || {
            echo -e "  ${RED}✗ Failed to create table${NC}"
        }
    else
        echo "  No schema file available. Please create the table manually."
        exit 1
    fi
fi

FINAL_COUNT=$(docker exec $CLICKHOUSE_CONTAINER clickhouse-client --query "SELECT COUNT(*) FROM quantbot.ohlcv_candles" 2>&1 || echo "0")

# Check for errors in the count query
if [[ "$FINAL_COUNT" == *"Exception"* ]] || [[ "$FINAL_COUNT" == *"error"* ]]; then
    echo -e "${RED}✗ Error querying table: $FINAL_COUNT${NC}"
    echo ""
    echo "  Checking ClickHouse logs..."
    docker logs $CLICKHOUSE_CONTAINER --tail 50 2>&1 | grep -i error | tail -10 || echo "  No recent errors in logs"
    exit 1
fi

if [[ "$FINAL_COUNT" =~ ^[0-9]+$ ]] && [[ $FINAL_COUNT -gt 0 ]]; then
    echo -e "${GREEN}✓ Restore successful!${NC}"
    echo ""
    echo "  Final row count: $FINAL_COUNT"
    
    # Show sample data
    echo ""
    echo "  Sample data (first 3 rows):"
    docker exec $CLICKHOUSE_CONTAINER clickhouse-client \
        --query "SELECT * FROM quantbot.ohlcv_candles LIMIT 3 FORMAT PrettyCompact" 2>&1 || true
    
    # Show partition info if available
    echo ""
    echo "  Partition information:"
    docker exec $CLICKHOUSE_CONTAINER clickhouse-client \
        --query "SELECT partition, count() as rows, formatReadableSize(sum(bytes_on_disk)) as size FROM system.parts WHERE database = 'quantbot' AND table = 'ohlcv_candles' AND active GROUP BY partition ORDER BY partition DESC LIMIT 10" 2>&1 || true
    
    echo ""
    echo -e "${GREEN}=== Restore Complete ===${NC}"
    echo "Rows restored: $FINAL_COUNT"
    echo ""
    echo "You can verify the data with:"
    echo "  docker exec $CLICKHOUSE_CONTAINER clickhouse-client --query \"SELECT COUNT(*) FROM quantbot.ohlcv_candles\""
else
    echo -e "${YELLOW}⚠ Restore completed but table is empty${NC}"
    echo "  Final count: $FINAL_COUNT"
    echo ""
    
    # Diagnostic information
    echo "  Diagnostic information:"
    echo "    Checking table structure..."
    docker exec $CLICKHOUSE_CONTAINER clickhouse-client \
        --query "SHOW CREATE TABLE quantbot.ohlcv_candles" 2>&1 | head -5 || true
    
    echo ""
    echo "    Checking for data files in ClickHouse..."
    docker exec $CLICKHOUSE_CONTAINER ls -la /var/lib/clickhouse/data/quantbot/ohlcv_candles/ 2>&1 | head -10 || true
    
    echo ""
    echo "    Checking for detached parts..."
    DETACHED_COUNT=$(docker exec $CLICKHOUSE_CONTAINER clickhouse-client \
        --query "SELECT COUNT(*) FROM system.detached_parts WHERE database = 'quantbot' AND table = 'ohlcv_candles'" 2>&1 || echo "0")
    if [[ "$DETACHED_COUNT" =~ ^[0-9]+$ ]] && [[ $DETACHED_COUNT -gt 0 ]]; then
        echo "    Found $DETACHED_COUNT detached parts. You may need to attach them:"
        echo "      docker exec $CLICKHOUSE_CONTAINER clickhouse-client --query \"ALTER TABLE quantbot.ohlcv_candles ATTACH PART 'partition_name'\""
    fi
    
    echo ""
    echo "  Please check:"
    echo "    1. Data files were copied correctly to the volume"
    echo "    2. Schema matches the data format"
    echo "    3. ClickHouse logs for errors: docker logs $CLICKHOUSE_CONTAINER"
    echo ""
    echo "  If data files exist but table is empty, you may need to:"
    echo "    - Attach detached parts"
    echo "    - Check file permissions"
    echo "    - Verify the data directory structure matches ClickHouse expectations"
    
    exit 1
fi


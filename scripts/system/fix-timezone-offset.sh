#!/bin/bash

# Fix timezone offset in ClickHouse data
# All timestamps are 10 hours ahead (UTC+10 local timezone was used instead of UTC)
# This script subtracts 10 hours from all timestamps in affected tables

set -e

CLICKHOUSE_CONTAINER="${CLICKHOUSE_CONTAINER:-quantbot-clickhouse-1}"
CLICKHOUSE_DATABASE="${CLICKHOUSE_DATABASE:-quantbot}"
HOURS_TO_SUBTRACT=10

echo "=========================================="
echo "Fix Timezone Offset in ClickHouse Data"
echo "=========================================="
echo ""
echo "This script will subtract $HOURS_TO_SUBTRACT hours from all timestamps"
echo "in the following tables:"
echo "  - ohlcv_candles"
echo "  - tick_events"
echo "  - token_metadata"
echo "  - indicators"
echo "  - simulation_events"
echo ""
echo "⚠️  WARNING: This will modify existing data!"
echo ""
echo "⚠️  IMPORTANT: This fixes the stored timestamps, but you may still have"
echo "    gaps in OHLCV coverage because candles were fetched for the wrong"
echo "    time windows (10 hours in the future relative to actual alerts)."
echo "    You may need to re-fetch candles for the correct time windows."
echo ""
read -p "Are you sure you want to continue? (type 'yes' to confirm): " confirm

if [ "$confirm" != "yes" ]; then
  echo "Aborted."
  exit 1
fi

echo ""
echo "Checking ClickHouse connection..."
if ! docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "SELECT 1" > /dev/null 2>&1; then
  echo "Error: Cannot connect to ClickHouse container: $CLICKHOUSE_CONTAINER"
  exit 1
fi

echo "✓ ClickHouse connection OK"
echo ""

# Function to fix timestamps in a table
fix_table_timestamps() {
  local table=$1
  local timestamp_column=$2
  
  echo "Fixing timestamps in $table..."
  
  # Check if table exists
  table_exists=$(docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    SELECT count() FROM system.tables 
    WHERE database = '$CLICKHOUSE_DATABASE' AND name = '$table'
  " 2>/dev/null || echo "0")
  
  if [ "$table_exists" != "1" ]; then
    echo "  ⚠️  Table $table does not exist, skipping..."
    return
  fi
  
  # Check if column exists
  column_exists=$(docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    SELECT count() FROM system.columns 
    WHERE database = '$CLICKHOUSE_DATABASE' 
      AND table = '$table' 
      AND name = '$timestamp_column'
  " 2>/dev/null || echo "0")
  
  if [ "$column_exists" != "1" ]; then
    echo "  ⚠️  Column $timestamp_column does not exist in $table, skipping..."
    return
  fi
  
  # Get row count before
  row_count=$(docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    SELECT count() FROM $CLICKHOUSE_DATABASE.$table
  " 2>/dev/null || echo "0")
  
  if [ "$row_count" = "0" ]; then
    echo "  ⚠️  Table $table is empty, skipping..."
    return
  fi
  
  echo "  Found $row_count rows to fix"
  
  # Create a temporary table with corrected timestamps
  temp_table="${table}_temp_$(date +%s)"
  
  echo "  Creating temporary table $temp_table..."
  
  # Get table structure
  table_structure=$(docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    SELECT create_table_query 
    FROM system.tables 
    WHERE database = '$CLICKHOUSE_DATABASE' AND name = '$table'
  " 2>/dev/null | sed "s/$table/$temp_table/g")
  
  if [ -z "$table_structure" ]; then
    echo "  ✗ Error: Could not get table structure for $table"
    return
  fi
  
  # Create temp table
  docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "$table_structure" > /dev/null 2>&1 || {
    echo "  ✗ Error: Could not create temporary table"
    return
  }
  
  # Get all column names
  all_columns=$(docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    SELECT name 
    FROM system.columns 
    WHERE database = '$CLICKHOUSE_DATABASE' AND table = '$table'
    ORDER BY position
    FORMAT TSV
  " 2>/dev/null | tr '\n' ',' | sed 's/,$//')
  
  if [ -z "$all_columns" ]; then
    echo "  ✗ Error: Could not get column names"
    docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "DROP TABLE IF EXISTS $CLICKHOUSE_DATABASE.$temp_table" > /dev/null 2>&1
    return
  fi
  
  # Build SELECT statement with corrected timestamp
  select_columns=""
  for col in $(echo "$all_columns" | tr ',' ' '); do
    if [ "$col" = "$timestamp_column" ]; then
      select_columns="${select_columns}subtractHours($timestamp_column, $HOURS_TO_SUBTRACT) as $timestamp_column,"
    else
      select_columns="${select_columns}$col,"
    fi
  done
  select_columns=$(echo "$select_columns" | sed 's/,$//')
  
  # Copy data with corrected timestamps
  echo "  Copying data with corrected timestamps..."
  docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    INSERT INTO $CLICKHOUSE_DATABASE.$temp_table
    SELECT $select_columns
    FROM $CLICKHOUSE_DATABASE.$table
  " > /dev/null 2>&1 || {
    echo "  ✗ Error: Could not copy data to temporary table"
    docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "DROP TABLE IF EXISTS $CLICKHOUSE_DATABASE.$temp_table" > /dev/null 2>&1
    return
  }
  
  # Verify row count matches
  temp_row_count=$(docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    SELECT count() FROM $CLICKHOUSE_DATABASE.$temp_table
  " 2>/dev/null || echo "0")
  
  if [ "$temp_row_count" != "$row_count" ]; then
    echo "  ✗ Error: Row count mismatch (original: $row_count, temp: $temp_row_count)"
    docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "DROP TABLE IF EXISTS $CLICKHOUSE_DATABASE.$temp_table" > /dev/null 2>&1
    return
  fi
  
  # Drop original table and rename temp table
  echo "  Replacing original table..."
  docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    DROP TABLE IF EXISTS $CLICKHOUSE_DATABASE.$table
  " > /dev/null 2>&1
  
  docker exec "$CLICKHOUSE_CONTAINER" clickhouse-client --query "
    RENAME TABLE $CLICKHOUSE_DATABASE.$temp_table TO $CLICKHOUSE_DATABASE.$table
  " > /dev/null 2>&1 || {
    echo "  ✗ Error: Could not rename temporary table"
    return
  }
  
  echo "  ✓ Fixed $row_count rows in $table"
}

# Fix each table
echo "Starting migration..."
echo ""

fix_table_timestamps "ohlcv_candles" "timestamp"
fix_table_timestamps "tick_events" "timestamp"
fix_table_timestamps "token_metadata" "timestamp"
fix_table_timestamps "indicators" "timestamp"
fix_table_timestamps "simulation_events" "event_time"

echo ""
echo "=========================================="
echo "Migration complete!"
echo "=========================================="
echo ""
echo "All timestamps have been adjusted by -$HOURS_TO_SUBTRACT hours."
echo ""


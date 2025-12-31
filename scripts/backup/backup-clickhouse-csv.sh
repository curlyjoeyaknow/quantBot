#!/bin/bash
# Export Data to Files (CSV exports - additional safety measure)
# Usage: ./scripts/backup/backup-clickhouse-csv.sh [BACKUP_DATE]

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/data/backup/clickhouse"

BACKUP_DATE=${1:-$(date +%Y%m%d)}

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "Exporting data to CSV files..."

# Get list of tables
TABLES=$(docker-compose exec -T clickhouse clickhouse-client --query "SHOW TABLES FROM quantbot" 2>&1 | grep -v "^$" | tr '\n' ' ')

if [ -z "$TABLES" ]; then
    echo "WARNING: No tables found in quantbot database"
    exit 0
fi

echo "Found tables: ${TABLES}"
echo ""

# Export each table to CSV
for TABLE in $TABLES; do
    if [ -n "$TABLE" ] && [ "$TABLE" != " " ]; then
        echo "Exporting ${TABLE} to CSV..."
        
        CSV_FILE="${BACKUP_DIR}/data_${TABLE}_${BACKUP_DATE}.csv"
        
        # Export to CSV
        docker-compose exec -T clickhouse clickhouse-client --query "SELECT * FROM quantbot.${TABLE} FORMAT CSV" > "$CSV_FILE" 2>&1
        
        # Verify export has data
        if [ -f "$CSV_FILE" ]; then
            ROW_COUNT=$(wc -l < "$CSV_FILE" 2>/dev/null || echo "0")
            SIZE=$(wc -c < "$CSV_FILE" 2>/dev/null || echo "0")
            
            if [ "$ROW_COUNT" -gt 0 ]; then
                echo "  ✓ ${TABLE}: ${ROW_COUNT} rows exported (${SIZE} bytes)"
            else
                echo "  WARNING: ${TABLE} export is empty (0 rows)"
            fi
        else
            echo "  ERROR: Failed to create CSV file for ${TABLE}"
            exit 1
        fi
    fi
done

echo ""
echo "CSV export complete"


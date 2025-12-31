#!/bin/bash
# Backup Data to Cloned Database (in-database backup - fastest restore method)
# Usage: ./scripts/backup/backup-clickhouse-clone.sh [BACKUP_DATE] [BACKUP_DB]

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/data/backup/clickhouse"

BACKUP_DATE=${1:-$(date +%Y%m%d)}
BACKUP_DB=${2:-"quantbot_backup_${BACKUP_DATE}"}

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "Creating backup database: ${BACKUP_DB}"

# Create backup database
docker-compose exec -T clickhouse clickhouse-client --query "CREATE DATABASE IF NOT EXISTS ${BACKUP_DB}" 2>&1

# Get list of all tables in quantbot database
TABLES=$(docker-compose exec -T clickhouse clickhouse-client --query "SHOW TABLES FROM quantbot" 2>&1 | grep -v "^$" | tr '\n' ' ')

if [ -z "$TABLES" ]; then
    echo "WARNING: No tables found in quantbot database"
    exit 0
fi

echo "Found tables: ${TABLES}"
echo ""

# Clone all tables with data
for TABLE in $TABLES; do
    if [ -n "$TABLE" ] && [ "$TABLE" != " " ]; then
        echo "Backing up table: $TABLE"
        
        # Get table structure
        TABLE_DDL=$(docker-compose exec -T clickhouse clickhouse-client --query "SHOW CREATE TABLE quantbot.${TABLE}" 2>&1)
        
        if [ -z "$TABLE_DDL" ]; then
            echo "  ERROR: Failed to get DDL for ${TABLE}"
            exit 1
        fi
        
        # Convert literal \n to actual newlines and replace database/table name
        BACKUP_DDL=$(echo -e "$TABLE_DDL" | sed "s/quantbot\.${TABLE}/${BACKUP_DB}.${TABLE}/g" | sed "s/CREATE TABLE quantbot\.${TABLE}/CREATE TABLE ${BACKUP_DB}.${TABLE}/g")
        
        echo -e "$BACKUP_DDL" | docker-compose exec -T clickhouse clickhouse-client 2>&1
        
        # Copy all data
        echo "  Copying data..."
        docker-compose exec -T clickhouse clickhouse-client --query "INSERT INTO ${BACKUP_DB}.${TABLE} SELECT * FROM quantbot.${TABLE}" 2>&1
        
        # Verify row count matches
        ORIGINAL_COUNT=$(docker-compose exec -T clickhouse clickhouse-client --query "SELECT COUNT(*) FROM quantbot.${TABLE}" 2>&1 | grep -v "^$" || echo "0")
        BACKUP_COUNT=$(docker-compose exec -T clickhouse clickhouse-client --query "SELECT COUNT(*) FROM ${BACKUP_DB}.${TABLE}" 2>&1 | grep -v "^$" || echo "0")
        
        if [ "$ORIGINAL_COUNT" != "$BACKUP_COUNT" ]; then
            echo "  ERROR: Row count mismatch for ${TABLE}! Original: $ORIGINAL_COUNT, Backup: $BACKUP_COUNT"
            exit 1
        fi
        
        echo "  ✓ ${TABLE}: ${BACKUP_COUNT} rows backed up"
    fi
done

# Document backup database name and tables
mkdir -p "$BACKUP_DIR"
cat >> "${BACKUP_DIR}/README.md" << EOF
Backup database: ${BACKUP_DB}
Tables backed up: ${TABLES}
Backup completed: $(date)

EOF

echo ""
echo "Backup database created: ${BACKUP_DB}"
echo "All tables backed up successfully"


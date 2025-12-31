#!/bin/bash
# Backup ClickHouse Schema (table definitions)
# Usage: ./scripts/backup/backup-clickhouse-schema.sh [BACKUP_DATE]

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/data/backup/clickhouse"

BACKUP_DATE=${1:-$(date +%Y%m%d)}

# Create backup directory
mkdir -p "$BACKUP_DIR"

echo "Backing up database schema..."
docker-compose exec -T clickhouse clickhouse-client --query "SHOW CREATE DATABASE quantbot" > "${BACKUP_DIR}/schema_database_${BACKUP_DATE}.sql" 2>&1

# Get list of all tables
TABLES=$(docker-compose exec -T clickhouse clickhouse-client --query "SHOW TABLES FROM quantbot" 2>&1 | grep -v "^$" | tr '\n' ' ')

if [ -z "$TABLES" ]; then
    echo "WARNING: No tables found in quantbot database"
    exit 0
fi

echo "Found tables: ${TABLES}"
echo ""

# Backup each table schema
for TABLE in $TABLES; do
    if [ -n "$TABLE" ] && [ "$TABLE" != " " ]; then
        echo "Backing up schema for ${TABLE}..."
        docker-compose exec -T clickhouse clickhouse-client --query "SHOW CREATE TABLE quantbot.${TABLE}" > "${BACKUP_DIR}/schema_${TABLE}_${BACKUP_DATE}.sql" 2>&1
        
        # Verify schema file was created and has content
        if [ -f "${BACKUP_DIR}/schema_${TABLE}_${BACKUP_DATE}.sql" ]; then
            SIZE=$(wc -c < "${BACKUP_DIR}/schema_${TABLE}_${BACKUP_DATE}.sql")
            if [ "$SIZE" -gt 0 ]; then
                echo "  ✓ ${TABLE}: ${SIZE} bytes"
            else
                echo "  WARNING: Empty schema file for ${TABLE}"
            fi
        else
            echo "  ERROR: Failed to create schema file for ${TABLE}"
            exit 1
        fi
    fi
done

echo ""
echo "Schema backup complete for tables: ${TABLES}"


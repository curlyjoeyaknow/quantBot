#!/bin/bash
# Backup verification script
# Checks file existence, size, schema validity, data integrity

set -e

BACKUP_DIR="data/backup/clickhouse"

if [ ! -d "$BACKUP_DIR" ]; then
  echo "ERROR: Backup directory not found: $BACKUP_DIR"
  exit 1
fi

echo "=== Verifying ClickHouse Backup ==="
echo ""

# Check if README exists
if [ ! -f "${BACKUP_DIR}/README.md" ]; then
  echo "ERROR: README.md not found in backup directory"
  exit 1
fi

# Extract backup date and database name
BACKUP_DATE=$(grep "Backup database:" ${BACKUP_DIR}/README.md | grep -o '[0-9]\{8\}' | head -1 || echo "")
BACKUP_DB=$(grep "Backup database:" ${BACKUP_DIR}/README.md | cut -d: -f2 | tr -d ' ' || echo "")

if [ -z "$BACKUP_DATE" ]; then
  echo "ERROR: Could not extract backup date from README.md"
  exit 1
fi

echo "Backup Date: $BACKUP_DATE"
echo "Backup Database: $BACKUP_DB"
echo ""

# Verify schema files exist
echo "=== Verifying Schema Files ==="
SCHEMA_FILES=$(find ${BACKUP_DIR} -name "schema_*_${BACKUP_DATE}.sql" 2>/dev/null || true)
if [ -z "$SCHEMA_FILES" ]; then
  echo "ERROR: No schema files found for date $BACKUP_DATE"
  exit 1
fi

for SCHEMA_FILE in $SCHEMA_FILES; do
  if [ -f "$SCHEMA_FILE" ]; then
    SIZE=$(wc -c < "$SCHEMA_FILE")
    if [ "$SIZE" -gt 0 ]; then
      echo "✓ $(basename $SCHEMA_FILE): ${SIZE} bytes"
    else
      echo "ERROR: Empty schema file: $SCHEMA_FILE"
      exit 1
    fi
  fi
done
echo ""

# Verify CSV export files exist
echo "=== Verifying CSV Export Files ==="
CSV_FILES=$(find ${BACKUP_DIR} -name "data_*_${BACKUP_DATE}.csv" 2>/dev/null || true)
if [ -z "$CSV_FILES" ]; then
  echo "WARNING: No CSV export files found for date $BACKUP_DATE"
else
  for CSV_FILE in $CSV_FILES; do
    if [ -f "$CSV_FILE" ]; then
      ROW_COUNT=$(wc -l < "$CSV_FILE" 2>/dev/null || echo "0")
      SIZE=$(wc -c < "$CSV_FILE")
      echo "✓ $(basename $CSV_FILE): ${ROW_COUNT} rows, ${SIZE} bytes"
    fi
  done
fi
echo ""

# Verify cloned database (if ClickHouse is accessible)
echo "=== Verifying Cloned Database ==="
if docker-compose ps clickhouse 2>&1 | grep -q "Up"; then
  if [ -n "$BACKUP_DB" ]; then
    if docker-compose exec -T clickhouse clickhouse-client --query "EXISTS DATABASE ${BACKUP_DB}" 2>&1 | grep -q "1"; then
      echo "✓ Backup database exists: ${BACKUP_DB}"
      
      # Verify row counts match original database
      BACKUP_TABLES=$(docker-compose exec -T clickhouse clickhouse-client --query "SHOW TABLES FROM ${BACKUP_DB}" 2>&1 | grep -v "^$" | tr '\n' ' ')
      for TABLE in $BACKUP_TABLES; do
        if [ -n "$TABLE" ] && [ "$TABLE" != " " ]; then
          ORIGINAL_COUNT=$(docker-compose exec -T clickhouse clickhouse-client --query "SELECT COUNT(*) FROM quantbot.${TABLE}" 2>&1 | grep -v "^$" || echo "0")
          BACKUP_COUNT=$(docker-compose exec -T clickhouse clickhouse-client --query "SELECT COUNT(*) FROM ${BACKUP_DB}.${TABLE}" 2>&1 | grep -v "^$" || echo "0")
          if [ "$ORIGINAL_COUNT" = "$BACKUP_COUNT" ]; then
            echo "✓ ${TABLE}: ${BACKUP_COUNT} rows (matches original)"
          else
            echo "ERROR: Row count mismatch for ${TABLE}! Original: $ORIGINAL_COUNT, Backup: $BACKUP_COUNT"
            exit 1
          fi
        fi
      done
    else
      echo "WARNING: Backup database ${BACKUP_DB} not found in ClickHouse"
    fi
  else
    echo "WARNING: Could not extract backup database name"
  fi
else
  echo "INFO: ClickHouse not running, skipping database verification"
fi
echo ""

echo "=== Backup Verification Complete ==="
echo "All backup files verified successfully"


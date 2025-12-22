#!/bin/bash
# Backup all SQLite databases before migration
# Usage: ./scripts/migration/backup-sqlite-dbs.sh

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

# Backup directory
BACKUP_DIR="$PROJECT_ROOT/data/backups/pre-migration-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

echo "Creating SQLite database backups in: $BACKUP_DIR"

# Find all .db files in data directory
DB_COUNT=0
for db_file in "$PROJECT_ROOT"/data/*.db "$PROJECT_ROOT"/data/databases/*.db; do
  if [ -f "$db_file" ]; then
    filename=$(basename "$db_file")
    cp "$db_file" "$BACKUP_DIR/$filename"
    echo "✓ Backed up: $filename"
    DB_COUNT=$((DB_COUNT + 1))
  fi
done

# Create a tar.gz archive
cd "$PROJECT_ROOT/data/backups"
ARCHIVE_NAME="pre-migration-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$ARCHIVE_NAME" "$(basename "$BACKUP_DIR")"
echo ""
echo "✓ Created archive: $ARCHIVE_NAME"
echo "✓ Backed up $DB_COUNT database files"
echo ""
echo "Backup location: $BACKUP_DIR"
echo "Archive location: $PROJECT_ROOT/data/backups/$ARCHIVE_NAME"


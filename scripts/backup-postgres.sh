#!/bin/bash
#
# PostgreSQL Backup Script
# Backs up the QuantBot PostgreSQL database daily
#

set -e

# Configuration
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_DIR="/home/memez/quantBot/data/backups/postgres"
CONTAINER_NAME="quantbot-postgres"
DB_USER="quantbot"
DB_NAME="quantbot"
RETENTION_DAYS=7

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}╔════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║     PostgreSQL Backup - QuantBot              ║${NC}"
echo -e "${YELLOW}╚════════════════════════════════════════════════╝${NC}"
echo ""

# Create backup directory if it doesn't exist
mkdir -p "$BACKUP_DIR"

# Check if container is running
if ! docker ps | grep -q "$CONTAINER_NAME"; then
    echo -e "${RED}❌ Error: PostgreSQL container is not running${NC}"
    exit 1
fi

# Perform backup
echo -e "${YELLOW}📦 Creating backup...${NC}"
BACKUP_FILE="$BACKUP_DIR/quantbot_$DATE.sql.gz"

if docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$BACKUP_FILE"; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo -e "${GREEN}✅ Backup successful: $BACKUP_FILE${NC}"
    echo -e "${GREEN}   Size: $BACKUP_SIZE${NC}"
else
    echo -e "${RED}❌ Backup failed${NC}"
    exit 1
fi

# Clean up old backups
echo -e "${YELLOW}🧹 Cleaning up backups older than $RETENTION_DAYS days...${NC}"
DELETED=$(find "$BACKUP_DIR" -name "quantbot_*.sql.gz" -mtime +$RETENTION_DAYS -delete -print | wc -l)

if [ "$DELETED" -gt 0 ]; then
    echo -e "${GREEN}✅ Deleted $DELETED old backup(s)${NC}"
else
    echo -e "${GREEN}✅ No old backups to delete${NC}"
fi

# List current backups
echo ""
echo -e "${YELLOW}📋 Current backups:${NC}"
ls -lh "$BACKUP_DIR"/quantbot_*.sql.gz 2>/dev/null | tail -5 | awk '{print "   " $9 " (" $5 ")"}'

# Count total backups
TOTAL_BACKUPS=$(ls -1 "$BACKUP_DIR"/quantbot_*.sql.gz 2>/dev/null | wc -l)
echo ""
echo -e "${GREEN}✅ Total backups: $TOTAL_BACKUPS${NC}"
echo -e "${GREEN}✅ Backup complete!${NC}"
echo ""

# Optional: Create a "latest" symlink
ln -sf "$BACKUP_FILE" "$BACKUP_DIR/latest.sql.gz"

exit 0


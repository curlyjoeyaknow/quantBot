#!/bin/bash
#
# PostgreSQL Restore Script
# Restores the QuantBot PostgreSQL database from backup
#

set -e

# Configuration
BACKUP_DIR="/home/memez/quantBot/data/backups/postgres"
CONTAINER_NAME="quantbot-postgres"
DB_USER="quantbot"
DB_NAME="quantbot"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${YELLOW}╔════════════════════════════════════════════════╗${NC}"
echo -e "${YELLOW}║     PostgreSQL Restore - QuantBot             ║${NC}"
echo -e "${YELLOW}╚════════════════════════════════════════════════╝${NC}"
echo ""

# Check if backup directory exists
if [ ! -d "$BACKUP_DIR" ]; then
    echo -e "${RED}❌ Error: Backup directory not found: $BACKUP_DIR${NC}"
    exit 1
fi

# List available backups
echo -e "${YELLOW}📋 Available backups:${NC}"
ls -lht "$BACKUP_DIR"/quantbot_*.sql.gz | head -10 | nl -w2 -s'. '

echo ""

# Get backup file to restore
if [ -z "$1" ]; then
    echo -e "${YELLOW}Usage: $0 <backup_file>${NC}"
    echo ""
    echo "Examples:"
    echo "  $0 latest.sql.gz"
    echo "  $0 quantbot_20251205_120000.sql.gz"
    echo ""
    exit 1
fi

BACKUP_FILE="$BACKUP_DIR/$1"

# Check if backup file exists
if [ ! -f "$BACKUP_FILE" ]; then
    echo -e "${RED}❌ Error: Backup file not found: $BACKUP_FILE${NC}"
    exit 1
fi

echo -e "${YELLOW}📦 Backup file: $BACKUP_FILE${NC}"
echo -e "${YELLOW}   Size: $(du -h "$BACKUP_FILE" | cut -f1)${NC}"
echo ""

# Warning
echo -e "${RED}⚠️  WARNING: This will OVERWRITE the current database!${NC}"
echo -e "${RED}   Current database will be DESTROYED and replaced with backup${NC}"
echo ""
read -p "Are you sure you want to continue? (type 'yes' to confirm): " CONFIRM

if [ "$CONFIRM" != "yes" ]; then
    echo -e "${YELLOW}❌ Restore cancelled${NC}"
    exit 0
fi

# Check if container is running
if ! docker ps | grep -q "$CONTAINER_NAME"; then
    echo -e "${RED}❌ Error: PostgreSQL container is not running${NC}"
    exit 1
fi

# Create a quick backup of current database before restore
echo -e "${YELLOW}📦 Creating safety backup of current database...${NC}"
SAFETY_BACKUP="$BACKUP_DIR/pre_restore_$(date +%Y%m%d_%H%M%S).sql.gz"
docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" "$DB_NAME" | gzip > "$SAFETY_BACKUP"
echo -e "${GREEN}✅ Safety backup created: $SAFETY_BACKUP${NC}"
echo ""

# Drop and recreate database
echo -e "${YELLOW}🔄 Dropping and recreating database...${NC}"
docker exec "$CONTAINER_NAME" psql -U "$DB_USER" -c "DROP DATABASE IF EXISTS $DB_NAME;"
docker exec "$CONTAINER_NAME" psql -U "$DB_USER" -c "CREATE DATABASE $DB_NAME;"
echo -e "${GREEN}✅ Database recreated${NC}"
echo ""

# Restore backup
echo -e "${YELLOW}📥 Restoring backup...${NC}"
if zcat "$BACKUP_FILE" | docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" "$DB_NAME"; then
    echo -e "${GREEN}✅ Restore successful!${NC}"
    echo ""
    
    # Verify restore
    echo -e "${YELLOW}🔍 Verifying restore...${NC}"
    TABLES=$(docker exec "$CONTAINER_NAME" psql -U "$DB_USER" "$DB_NAME" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")
    ALERTS=$(docker exec "$CONTAINER_NAME" psql -U "$DB_USER" "$DB_NAME" -t -c "SELECT COUNT(*) FROM alerts;" 2>/dev/null || echo "0")
    
    echo -e "${GREEN}   Tables: $TABLES${NC}"
    echo -e "${GREEN}   Alerts: $ALERTS${NC}"
    echo ""
    echo -e "${GREEN}✅ Database restored successfully!${NC}"
else
    echo -e "${RED}❌ Restore failed!${NC}"
    echo -e "${YELLOW}🔄 Attempting to restore safety backup...${NC}"
    
    zcat "$SAFETY_BACKUP" | docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" "$DB_NAME"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Safety backup restored. Database is back to pre-restore state.${NC}"
    else
        echo -e "${RED}❌ CRITICAL: Safety backup restore also failed!${NC}"
        echo -e "${RED}   Manual intervention required.${NC}"
    fi
    exit 1
fi

exit 0


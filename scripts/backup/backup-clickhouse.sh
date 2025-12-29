#!/bin/bash
# Comprehensive ClickHouse Backup Script
# Creates multiple backup types: schema, cloned database, ClickHouse BACKUP, and CSV exports
# Usage: ./scripts/backup/backup-clickhouse.sh

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_DIR="${PROJECT_ROOT}/data/backup/clickhouse"

# Create backup directory
mkdir -p "$BACKUP_DIR"

BACKUP_DATE=$(date +%Y%m%d)
BACKUP_DB="quantbot_backup_${BACKUP_DATE}"

echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     ClickHouse Comprehensive Backup          ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${YELLOW}Backup Date: ${BACKUP_DATE}${NC}"
echo -e "${YELLOW}Backup Directory: ${BACKUP_DIR}${NC}"
echo ""

# Check if ClickHouse is accessible
if ! docker-compose exec -T clickhouse clickhouse-client --query "SELECT 1" > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: Cannot connect to ClickHouse${NC}"
    echo "Make sure ClickHouse container is running: docker-compose ps clickhouse"
    exit 1
fi

# Get ClickHouse version
CH_VERSION=$(docker-compose exec -T clickhouse clickhouse-client --version 2>&1 | grep -oP 'version \K[0-9.]+' || echo "unknown")
echo -e "${YELLOW}ClickHouse Version: ${CH_VERSION}${NC}"
echo ""

# Step 1: Backup Schema
echo -e "${YELLOW}[1/4] Backing up database and table schemas...${NC}"
"${SCRIPT_DIR}/backup-clickhouse-schema.sh" "$BACKUP_DATE"
echo -e "${GREEN}✓ Schema backup complete${NC}"
echo ""

# Step 2: Backup to Cloned Database
echo -e "${YELLOW}[2/4] Creating cloned database backup...${NC}"
"${SCRIPT_DIR}/backup-clickhouse-clone.sh" "$BACKUP_DATE" "$BACKUP_DB"
echo -e "${GREEN}✓ Cloned database backup complete${NC}"
echo ""

# Step 3: ClickHouse BACKUP command
echo -e "${YELLOW}[3/4] Creating ClickHouse BACKUP...${NC}"
"${SCRIPT_DIR}/backup-clickhouse-native.sh" "$BACKUP_DATE"
echo -e "${GREEN}✓ ClickHouse BACKUP complete${NC}"
echo ""

# Step 4: Export Data to CSV
echo -e "${YELLOW}[4/4] Exporting data to CSV files...${NC}"
"${SCRIPT_DIR}/backup-clickhouse-csv.sh" "$BACKUP_DATE"
echo -e "${GREEN}✓ CSV export complete${NC}"
echo ""

# Document backup
echo -e "${YELLOW}Documenting backup...${NC}"
cat >> "${BACKUP_DIR}/README.md" << EOF

## Backup ${BACKUP_DATE}

**Date**: $(date)
**ClickHouse Version**: ${CH_VERSION}
**Backup Database**: ${BACKUP_DB}

### Backup Types Created:
1. Schema files: \`schema_database_${BACKUP_DATE}.sql\`, \`schema_*_${BACKUP_DATE}.sql\`
2. Cloned database: \`${BACKUP_DB}\` (in ClickHouse)
3. ClickHouse BACKUP: Internal backup (check ClickHouse logs for location)
4. CSV exports: \`data_*_${BACKUP_DATE}.csv\`

### Verification:
Run: \`./scripts/backup/verify-backup.sh\`

EOF

echo ""
echo -e "${GREEN}╔════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║     Backup Complete!                           ║${NC}"
echo -e "${GREEN}╚════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${GREEN}Backup location: ${BACKUP_DIR}${NC}"
echo -e "${GREEN}Backup database: ${BACKUP_DB}${NC}"
echo ""
echo "To verify backup, run:"
echo "  ./scripts/backup/verify-backup.sh"
echo ""


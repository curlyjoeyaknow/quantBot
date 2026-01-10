#!/bin/bash
# Convenient migration runner script
# Usage: ./scripts/migration/run-migration.sh [--dry-run] [--db <database-name>]

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}==================================================================${NC}"
echo -e "${BLUE}   QuantBot SQLite → PostgreSQL/ClickHouse Migration${NC}"
echo -e "${BLUE}==================================================================${NC}"
echo ""

# Check if PostgreSQL is accessible
echo -e "${YELLOW}Checking PostgreSQL connection...${NC}"
if psql -U "${POSTGRES_USER:-quantbot}" -d "${POSTGRES_DATABASE:-quantbot}" -c '\q' 2>/dev/null; then
  echo -e "${GREEN}✓ PostgreSQL is accessible${NC}"
else
  echo -e "${RED}✗ PostgreSQL is not accessible${NC}"
  echo -e "${YELLOW}  Make sure PostgreSQL is running and environment variables are set${NC}"
  exit 1
fi

# Check if ClickHouse is accessible (optional)
if [ "${USE_CLICKHOUSE}" = "true" ]; then
  echo -e "${YELLOW}Checking ClickHouse connection...${NC}"
  if wget --spider -q "http://${CLICKHOUSE_HOST:-localhost}:${CLICKHOUSE_PORT:-18123}/ping" 2>/dev/null; then
    echo -e "${GREEN}✓ ClickHouse is accessible${NC}"
  else
    echo -e "${RED}✗ ClickHouse is not accessible${NC}"
    echo -e "${YELLOW}  Make sure ClickHouse is running${NC}"
    exit 1
  fi
fi

echo ""

# Check if this is a dry run
DRY_RUN_FLAG=""
if [[ " $* " == *" --dry-run "* ]]; then
  DRY_RUN_FLAG="--dry-run"
  echo -e "${YELLOW}Running in DRY RUN mode - no data will be modified${NC}"
  echo ""
fi

# Ask for confirmation if not dry run
if [ -z "$DRY_RUN_FLAG" ]; then
  echo -e "${YELLOW}This will migrate SQLite data to PostgreSQL and ClickHouse.${NC}"
  echo -e "${YELLOW}Have you backed up your SQLite databases?${NC}"
  read -p "Continue? (y/N): " -n 1 -r
  echo ""
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}Migration cancelled${NC}"
    exit 0
  fi
  echo ""
fi

# Initialize PostgreSQL schema
if [ -z "$DRY_RUN_FLAG" ]; then
  echo -e "${YELLOW}Initializing PostgreSQL schema...${NC}"
  if [ -f "$SCRIPT_DIR/postgres/001_init.sql" ]; then
    psql -U "${POSTGRES_USER:-quantbot}" -d "${POSTGRES_DATABASE:-quantbot}" -f "$SCRIPT_DIR/postgres/001_init.sql" > /dev/null 2>&1
    echo -e "${GREEN}✓ PostgreSQL schema initialized${NC}"
  else
    echo -e "${YELLOW}  Schema file not found, assuming schema already exists${NC}"
  fi
  echo ""
fi

# Run migration
echo -e "${YELLOW}Starting migration...${NC}"
echo ""

tsx "$SCRIPT_DIR/migrate-sqlite-to-postgres-clickhouse.ts" "$@"

MIGRATION_EXIT_CODE=$?

echo ""

if [ $MIGRATION_EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}==================================================================${NC}"
  echo -e "${GREEN}   Migration completed successfully!${NC}"
  echo -e "${GREEN}==================================================================${NC}"
  
  if [ -z "$DRY_RUN_FLAG" ]; then
    echo ""
    echo -e "${YELLOW}Next steps:${NC}"
    echo -e "  1. Verify the migrated data in PostgreSQL/ClickHouse"
    echo -e "  2. Test your application with the new database backend"
    echo -e "  3. Archive or remove old SQLite files (keep backups!)"
    echo ""
    echo -e "${BLUE}To verify data:${NC}"
    echo -e "  psql -U quantbot -d quantbot"
    echo -e "  SELECT 'tokens' as table, COUNT(*) FROM tokens;"
    echo -e "  SELECT 'alerts' as table, COUNT(*) FROM alerts;"
    echo ""
  fi
else
  echo -e "${RED}==================================================================${NC}"
  echo -e "${RED}   Migration failed with errors${NC}"
  echo -e "${RED}==================================================================${NC}"
  echo ""
  echo -e "${YELLOW}Check the logs above for error details${NC}"
  exit 1
fi


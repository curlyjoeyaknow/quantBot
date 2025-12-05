#!/bin/bash
# Automated Database Setup and Migration Script
# This script will:
# 1. Check/update .env file
# 2. Start databases
# 3. Initialize schemas
# 4. Backup SQLite databases
# 5. Run migration
# 6. Verify migration

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

cd "$PROJECT_ROOT"

echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     QuantBot - Automated Database Setup & Migration             ║${NC}"
echo -e "${BLUE}╔══════════════════════════════════════════════════════════════════╗${NC}"
echo ""

# Step 1: Check and update .env file
echo -e "${YELLOW}[1/7] Checking environment configuration...${NC}"

if [ ! -f ".env" ]; then
    echo -e "${YELLOW}  .env file not found, creating from template...${NC}"
    cp env.example .env
    echo -e "${GREEN}  ✓ Created .env file${NC}"
fi

# Update .env with database defaults if not set
update_env_var() {
    local key=$1
    local value=$2
    local file=".env"
    
    if ! grep -q "^${key}=" "$file" 2>/dev/null; then
        echo "${key}=${value}" >> "$file"
        echo -e "${GREEN}  ✓ Added ${key}${NC}"
    elif grep -q "^${key}=$" "$file" || grep -q "^${key}=your_" "$file"; then
        # Update if empty or has placeholder
        sed -i.bak "s|^${key}=.*|${key}=${value}|" "$file"
        echo -e "${GREEN}  ✓ Updated ${key}${NC}"
    fi
}

# Ensure database configuration is set
update_env_var "POSTGRES_HOST" "localhost"
update_env_var "POSTGRES_PORT" "5432"
update_env_var "POSTGRES_USER" "quantbot"
update_env_var "POSTGRES_PASSWORD" "quantbot_secure_password"
update_env_var "POSTGRES_DATABASE" "quantbot"
update_env_var "POSTGRES_MAX_CONNECTIONS" "10"

update_env_var "USE_CLICKHOUSE" "true"
update_env_var "CLICKHOUSE_HOST" "localhost"
update_env_var "CLICKHOUSE_PORT" "18123"
update_env_var "CLICKHOUSE_USER" "default"
update_env_var "CLICKHOUSE_PASSWORD" ""
update_env_var "CLICKHOUSE_DATABASE" "quantbot"

# Load environment variables
export $(grep -v '^#' .env | xargs)

echo -e "${GREEN}  ✓ Environment configured${NC}"
echo ""

# Step 2: Start databases
echo -e "${YELLOW}[2/7] Starting databases...${NC}"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}  ✗ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Start databases
docker-compose up -d postgres clickhouse influxdb

echo -e "${GREEN}  ✓ Database containers started${NC}"
echo ""

# Step 3: Wait for databases to be healthy
echo -e "${YELLOW}[3/7] Waiting for databases to be ready...${NC}"

wait_for_postgres() {
    echo -n "  Waiting for PostgreSQL..."
    for i in {1..30}; do
        if docker-compose exec -T postgres pg_isready -U quantbot > /dev/null 2>&1; then
            echo -e " ${GREEN}✓${NC}"
            return 0
        fi
        echo -n "."
        sleep 1
    done
    echo -e " ${RED}✗${NC}"
    return 1
}

wait_for_clickhouse() {
    echo -n "  Waiting for ClickHouse..."
    for i in {1..30}; do
        if wget --spider -q "http://localhost:18123/ping" 2>/dev/null; then
            echo -e " ${GREEN}✓${NC}"
            return 0
        fi
        echo -n "."
        sleep 1
    done
    echo -e " ${RED}✗${NC}"
    return 1
}

if ! wait_for_postgres; then
    echo -e "${RED}  PostgreSQL failed to start${NC}"
    exit 1
fi

if ! wait_for_clickhouse; then
    echo -e "${RED}  ClickHouse failed to start${NC}"
    exit 1
fi

echo -e "${GREEN}  ✓ All databases are ready${NC}"
echo ""

# Step 4: Initialize PostgreSQL schema
echo -e "${YELLOW}[4/7] Initializing PostgreSQL schema...${NC}"

if [ -f "scripts/migration/postgres/001_init.sql" ]; then
    docker-compose exec -T postgres psql -U quantbot -d quantbot < scripts/migration/postgres/001_init.sql > /dev/null 2>&1
    echo -e "${GREEN}  ✓ PostgreSQL schema initialized${NC}"
else
    echo -e "${YELLOW}  Schema file not found, will be created during migration${NC}"
fi
echo ""

# Step 5: Backup SQLite databases
echo -e "${YELLOW}[5/7] Backing up SQLite databases...${NC}"

./scripts/migration/backup-sqlite-dbs.sh

echo -e "${GREEN}  ✓ Backup completed${NC}"
echo ""

# Step 6: Count SQLite records
echo -e "${YELLOW}[6/7] Running migration...${NC}"

count_sqlite_records() {
    local total=0
    
    for db in data/*.db data/databases/*.db; do
        if [ -f "$db" ]; then
            local count=$(sqlite3 "$db" "SELECT COUNT(*) FROM sqlite_master WHERE type='table';" 2>/dev/null || echo "0")
            if [ "$count" -gt 0 ]; then
                echo -e "  ${BLUE}Found database: $(basename $db)${NC}"
                total=$((total + 1))
            fi
        fi
    done
    
    echo -e "  ${GREEN}Total databases to migrate: $total${NC}"
}

count_sqlite_records
echo ""

# Run migration with monitoring
echo -e "${BLUE}  Starting migration process...${NC}"
echo ""

tsx scripts/migration/migrate-sqlite-to-postgres-clickhouse.ts 2>&1 | while IFS= read -r line; do
    if [[ $line == *"ERROR"* ]]; then
        echo -e "${RED}  $line${NC}"
    elif [[ $line == *"WARN"* ]]; then
        echo -e "${YELLOW}  $line${NC}"
    elif [[ $line == *"✓"* ]] || [[ $line == *"Migrated"* ]]; then
        echo -e "${GREEN}  $line${NC}"
    else
        echo -e "  $line"
    fi
done

MIGRATION_EXIT=$?

if [ $MIGRATION_EXIT -ne 0 ]; then
    echo ""
    echo -e "${RED}  ✗ Migration failed with errors${NC}"
    exit 1
fi

echo ""
echo -e "${GREEN}  ✓ Migration completed successfully${NC}"
echo ""

# Step 7: Verify migration
echo -e "${YELLOW}[7/7] Verifying migration...${NC}"
echo ""

tsx scripts/migration/verify-migration.ts

VERIFY_EXIT=$?

echo ""
if [ $VERIFY_EXIT -eq 0 ]; then
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${GREEN}║                  Migration Successful! ✓                         ║${NC}"
    echo -e "${GREEN}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo ""
    echo -e "${BLUE}Next steps:${NC}"
    echo -e "  1. Review the verification results above"
    echo -e "  2. Test your application: ${GREEN}npm run dev${NC}"
    echo -e "  3. Check database data:"
    echo -e "     ${YELLOW}docker-compose exec postgres psql -U quantbot -d quantbot${NC}"
    echo -e "  4. Archive old SQLite files (keep backups!):"
    echo -e "     ${YELLOW}mkdir -p data/archive/sqlite${NC}"
    echo -e "     ${YELLOW}mv data/*.db data/archive/sqlite/${NC}"
    echo ""
    echo -e "${BLUE}Database Status:${NC}"
    docker-compose ps postgres clickhouse influxdb
    echo ""
    echo -e "${GREEN}All done! Your data is now in PostgreSQL and ClickHouse.${NC}"
else
    echo -e "${RED}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${RED}║              Verification Failed - Review Above                  ║${NC}"
    echo -e "${RED}╔══════════════════════════════════════════════════════════════════╗${NC}"
    echo ""
    echo -e "${YELLOW}Some verifications failed. This may be normal if:${NC}"
    echo -e "  • Target counts are higher (data merged from multiple sources)"
    echo -e "  • Some databases didn't exist"
    echo ""
    echo -e "${YELLOW}Check the verification table above for details.${NC}"
fi


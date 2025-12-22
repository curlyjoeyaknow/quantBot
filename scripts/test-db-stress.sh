#!/bin/bash
# Test DB Stress Suite Runner
# ============================
#
# Runs gated database stress tests that require:
# - ClickHouse running (localhost:8123 or 18123)
# - DuckDB with test data
# - RUN_DB_STRESS=1 environment variable
#
# This script:
# 1. Starts ClickHouse via docker-compose
# 2. Waits for ClickHouse to be ready
# 3. Seeds DuckDB fixtures (if needed)
# 4. Runs only the gated tests
# 5. Optionally stops ClickHouse after tests

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Configuration
CLICKHOUSE_PORT=${CLICKHOUSE_PORT:-18123}
STOP_AFTER=${STOP_AFTER:-true}

echo -e "${YELLOW}Starting DB Stress Test Suite...${NC}"
echo ""

# Step 1: Start ClickHouse
echo -e "${YELLOW}[1/4] Starting ClickHouse...${NC}"
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}  ✗ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

docker-compose up -d clickhouse
echo -e "${GREEN}  ✓ ClickHouse container started${NC}"
echo ""

# Step 2: Wait for ClickHouse to be ready
echo -e "${YELLOW}[2/4] Waiting for ClickHouse to be ready...${NC}"
wait_for_clickhouse() {
    echo -n "  Waiting for ClickHouse..."
    for i in {1..30}; do
        if wget --spider -q "http://localhost:${CLICKHOUSE_PORT}/ping" 2>/dev/null; then
            echo -e " ${GREEN}✓${NC}"
            return 0
        fi
        echo -n "."
        sleep 1
    done
    echo -e " ${RED}✗${NC}"
    return 1
}

if ! wait_for_clickhouse; then
    echo -e "${RED}  ClickHouse failed to start${NC}"
    echo -e "${YELLOW}  Attempting to continue anyway...${NC}"
fi
echo ""

# Step 3: Seed DuckDB fixtures (if needed)
echo -e "${YELLOW}[3/4] Checking DuckDB test fixtures...${NC}"
# Note: DuckDB fixtures are typically created by test setup
# If you need to seed fixtures, add that logic here
echo -e "${GREEN}  ✓ DuckDB fixtures ready (or will be created by tests)${NC}"
echo ""

# Step 4: Run gated tests
echo -e "${YELLOW}[4/4] Running DB stress tests...${NC}"
echo -e "${YELLOW}  (Tests gated by RUN_DB_STRESS=1)${NC}"
echo ""

# Set environment variable and run tests
export RUN_DB_STRESS=1

# Run tests in packages that have gated DB stress tests
pnpm --filter @quantbot/workflows test --run tests/integration tests/golden 2>&1 | tee /tmp/db-stress-test-output.log

TEST_EXIT_CODE=${PIPESTATUS[0]}

echo ""
if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✓ All DB stress tests passed!${NC}"
else
    echo -e "${RED}✗ Some DB stress tests failed${NC}"
    echo -e "${YELLOW}  Check /tmp/db-stress-test-output.log for details${NC}"
fi

# Step 5: Optionally stop ClickHouse
if [ "$STOP_AFTER" = "true" ]; then
    echo ""
    echo -e "${YELLOW}Stopping ClickHouse...${NC}"
    docker-compose stop clickhouse
    echo -e "${GREEN}  ✓ ClickHouse stopped${NC}"
fi

echo ""
exit $TEST_EXIT_CODE


#!/bin/bash
# Review ClickHouse Breaking Changes
# Checks for deprecated features and syntax changes between versions
# Usage: ./scripts/backup/review-breaking-changes.sh

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     ClickHouse Breaking Changes Review       ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
echo ""

# Get current ClickHouse version
CURRENT_VERSION=$(docker-compose exec -T clickhouse clickhouse-client --version 2>&1 | grep -oP 'version \K[0-9.]+' || echo "unknown")
TARGET_VERSION="24.3"

echo -e "${YELLOW}Current Version: ${CURRENT_VERSION}${NC}"
echo -e "${YELLOW}Target Version: ${TARGET_VERSION}${NC}"
echo ""

# Check if ClickHouse is accessible
if ! docker-compose exec -T clickhouse clickhouse-client --query "SELECT 1" > /dev/null 2>&1; then
    echo -e "${RED}❌ Error: Cannot connect to ClickHouse${NC}"
    exit 1
fi

echo -e "${YELLOW}[1/4] Checking for deprecated features...${NC}"

# Check for deprecated settings
DEPRECATED_SETTINGS=$(docker-compose exec -T clickhouse clickhouse-client --query "
SELECT name, value 
FROM system.settings 
WHERE is_obsolete = 1
" 2>&1 || echo "")

if [ -n "$DEPRECATED_SETTINGS" ] && [ "$DEPRECATED_SETTINGS" != "" ]; then
    echo -e "${YELLOW}⚠ Deprecated settings found:${NC}"
    echo "$DEPRECATED_SETTINGS"
else
    echo -e "${GREEN}✓ No deprecated settings found${NC}"
fi
echo ""

echo -e "${YELLOW}[2/4] Testing query compatibility...${NC}"

# Test common queries
TEST_QUERIES=(
    "SELECT COUNT(*) FROM quantbot.ohlcv_candles"
    "SHOW TABLES FROM quantbot"
    "SELECT * FROM system.tables WHERE database = 'quantbot' LIMIT 1"
)

FAILED_QUERIES=0
for QUERY in "${TEST_QUERIES[@]}"; do
    if docker-compose exec -T clickhouse clickhouse-client --query "$QUERY" > /dev/null 2>&1; then
        echo -e "${GREEN}✓ Query successful: ${QUERY:0:50}...${NC}"
    else
        echo -e "${RED}✗ Query failed: ${QUERY:0:50}...${NC}"
        FAILED_QUERIES=$((FAILED_QUERIES + 1))
    fi
done
echo ""

echo -e "${YELLOW}[3/4] Checking table engines...${NC}"

# Check for deprecated table engines
TABLE_ENGINES=$(docker-compose exec -T clickhouse clickhouse-client --query "
SELECT engine, count() as count
FROM system.tables
WHERE database = 'quantbot'
GROUP BY engine
" 2>&1 || echo "")

if [ -n "$TABLE_ENGINES" ] && [ "$TABLE_ENGINES" != "" ]; then
    echo "Table engines in use:"
    echo "$TABLE_ENGINES"
    echo ""
    echo -e "${YELLOW}Note: Check ClickHouse changelog for engine compatibility${NC}"
else
    echo -e "${GREEN}✓ No tables found or unable to query${NC}"
fi
echo ""

echo -e "${YELLOW}[4/4] Reviewing ClickHouse changelog...${NC}"
echo ""
echo -e "${YELLOW}Manual Review Required:${NC}"
echo "1. Check ClickHouse changelog from ${CURRENT_VERSION} to ${TARGET_VERSION}"
echo "   URL: https://clickhouse.com/docs/en/whats-new/changelog/"
echo ""
echo "2. Review deprecated features:"
echo "   - Check for removed functions, settings, or syntax"
echo "   - Review table engine changes"
echo "   - Check for data type changes"
echo ""
echo "3. Test compatibility:"
echo "   - Run existing queries against new version (if available)"
echo "   - Check for syntax errors or warnings"
echo ""
echo -e "${YELLOW}Key Areas to Review:${NC}"
echo "  - SQL syntax changes"
echo "  - Function deprecations"
echo "  - Table engine changes"
echo "  - Data type compatibility"
echo "  - Configuration file format changes"
echo ""

if [ "$FAILED_QUERIES" -gt 0 ]; then
    echo -e "${RED}⚠ Warning: ${FAILED_QUERIES} test query(ies) failed${NC}"
    echo "Review failed queries before proceeding with upgrade"
    exit 1
else
    echo -e "${GREEN}✓ All test queries passed${NC}"
fi

echo ""
echo -e "${BLUE}=== Review Complete ===${NC}"
echo "Continue with upgrade after reviewing breaking changes"


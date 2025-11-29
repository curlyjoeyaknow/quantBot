#!/bin/bash
#
# Depth Analyzer Wrapper Script
# Automatically detects available timestamps and runs depth-analyzer
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPTH_ANALYZER="${DEPTH_ANALYZER_PATH:-./target/release/depth-analyzer}"
INPUT_DIR="${1:-analytics/transaction-history}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}🔍 Depth Analyzer Wrapper${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Check if depth-analyzer exists
if [ ! -f "$DEPTH_ANALYZER" ]; then
    echo -e "${RED}❌ Error: depth-analyzer not found at: $DEPTH_ANALYZER${NC}"
    echo "   Set DEPTH_ANALYZER_PATH environment variable to specify the path"
    exit 1
fi

# Check if input directory exists
if [ ! -d "$INPUT_DIR" ]; then
    echo -e "${RED}❌ Error: Input directory not found: $INPUT_DIR${NC}"
    exit 1
fi

# Find all transaction files and extract timestamps
echo -e "${YELLOW}📂 Scanning for transaction files in: $INPUT_DIR${NC}"
TIMESTAMPS=$(find "$INPUT_DIR" -name "transactions-*.csv" -o -name "transactions-*.json" | \
    sed -n 's/.*transactions-\([0-9]\{8\}-[0-9]\{6\}\).*/\1/p' | \
    sort -u)

if [ -z "$TIMESTAMPS" ]; then
    echo -e "${RED}❌ No transaction files found in $INPUT_DIR${NC}"
    echo "   Expected format: transactions-YYYYMMDD-HHMMSS.csv or .json"
    exit 1
fi

# Convert to array
TIMESTAMP_ARRAY=($TIMESTAMPS)
COUNT=${#TIMESTAMP_ARRAY[@]}

echo -e "${GREEN}✅ Found $COUNT unique timestamp(s):${NC}"
echo ""

# List all timestamps
for i in "${!TIMESTAMP_ARRAY[@]}"; do
    TS="${TIMESTAMP_ARRAY[$i]}"
    # Format timestamp for display (YYYY-MM-DD HH:MM:SS)
    DATE_PART="${TS:0:4}-${TS:4:2}-${TS:6:2}"
    TIME_PART="${TS:9:2}:${TS:11:2}:${TS:13:2}"
    echo -e "   $((i+1)). ${BLUE}$TS${NC} (${DATE_PART} ${TIME_PART})"
done

echo ""

# Auto-select latest timestamp (last in sorted list)
LATEST_TS="${TIMESTAMP_ARRAY[-1]}"
DATE_PART="${LATEST_TS:0:4}-${LATEST_TS:4:2}-${LATEST_TS:6:2}"
TIME_PART="${LATEST_TS:9:2}:${LATEST_TS:11:2}:${LATEST_TS:13:2}"

# If timestamp provided as second argument, use it
if [ -n "$2" ]; then
    SELECTED_TS="$2"
    # Validate format
    if [[ ! "$SELECTED_TS" =~ ^[0-9]{8}-[0-9]{6}$ ]]; then
        echo -e "${RED}❌ Invalid timestamp format: $SELECTED_TS${NC}"
        echo "   Expected format: YYYYMMDD-HHMMSS"
        exit 1
    fi
    # Check if timestamp exists
    if [[ ! " ${TIMESTAMP_ARRAY[@]} " =~ " ${SELECTED_TS} " ]]; then
        echo -e "${YELLOW}⚠️  Warning: Timestamp $SELECTED_TS not found in available files${NC}"
        echo "   Using it anyway..."
    fi
else
    SELECTED_TS="$LATEST_TS"
    echo -e "${GREEN}📅 Auto-selected latest timestamp: ${BLUE}$SELECTED_TS${NC} (${DATE_PART} ${TIME_PART})"
fi

echo ""
echo -e "${YELLOW}🚀 Running depth-analyzer...${NC}"
echo -e "   Input: ${BLUE}$INPUT_DIR${NC}"
echo -e "   Timestamp: ${BLUE}$SELECTED_TS${NC}"
echo ""

# Run depth-analyzer
"$DEPTH_ANALYZER" --input "$INPUT_DIR" --timestamp "$SELECTED_TS"

EXIT_CODE=$?

if [ $EXIT_CODE -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✅ Analysis complete!${NC}"
else
    echo ""
    echo -e "${RED}❌ Analysis failed with exit code: $EXIT_CODE${NC}"
fi

exit $EXIT_CODE



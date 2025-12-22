#!/bin/bash
# Simple OHLCV ingestion runner using Python directly
# This bypasses all the TypeScript module issues

set -e

DUCKDB_PATH=${DUCKDB_PATH:-data/result.duckdb}
FROM=${1:-2025-07-01}
TO=${2:-2025-07-02}

echo "🚀 Starting OHLCV ingestion..."
echo "📁 DuckDB: $DUCKDB_PATH"
echo "📅 From: $FROM"
echo "📅 To: $TO"
echo ""

# Check if DuckDB exists
if [ ! -f "$DUCKDB_PATH" ]; then
    echo "❌ ERROR: DuckDB file not found: $DUCKDB_PATH"
    exit 1
fi

# Get worklist
echo "📋 Querying worklist..."
WORKLIST=$(python3 tools/ingestion/ohlcv_worklist.py --duckdb "$DUCKDB_PATH" --from "$FROM" --to "$TO" --side buy)

TOKEN_COUNT=$(echo "$WORKLIST" | python3 -c "import sys, json; data=json.load(sys.stdin); print(len(data.get('tokenGroups', [])))")
CALL_COUNT=$(echo "$WORKLIST" | python3 -c "import sys, json; data=json.load(sys.stdin); print(len(data.get('calls', [])))")

echo "✓ Found $TOKEN_COUNT token groups and $CALL_COUNT calls"
echo ""

if [ "$TOKEN_COUNT" -eq 0 ]; then
    echo "⚠️  No tokens to process in this date range"
    exit 0
fi

echo "✅ Worklist ready. To run full ingestion, use the CLI handler once module issues are resolved."
echo ""
echo "Worklist summary:"
echo "$WORKLIST" | python3 -m json.tool | head -50


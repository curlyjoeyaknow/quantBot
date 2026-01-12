#!/bin/bash
# Direct test of OHLCV fetch validation

set -e

cd "$(dirname "$0")/../.."

# Load environment
export $(grep -v '^#' .env | grep BIRDEYE_API_KEY | head -1 | xargs)

# Test parameters
MINT="So11111111111111111111111111111111111111112"
NOW=$(date +%s)
FROM_UNIX=$((NOW - 3600))  # 1 hour ago
TO_UNIX=$NOW
INTERVAL="1m"
CHAIN="solana"

echo "========================================="
echo "Testing OHLCV Fetch Validation"
echo "========================================="
echo "Mint: $MINT"
echo "From: $(date -d @$FROM_UNIX '+%Y-%m-%d %H:%M:%S')"
echo "To: $(date -d @$TO_UNIX '+%Y-%m-%d %H:%M:%S')"
echo "Interval: $INTERVAL"
echo ""

# Run Python script with timeout
timeout 30 python3 tools/validation/verify_ohlcv_fetch.py \
  --mint "$MINT" \
  --from-unix "$FROM_UNIX" \
  --to-unix "$TO_UNIX" \
  --interval "$INTERVAL" \
  --chain "$CHAIN"

echo ""
echo "✅ Test completed successfully"


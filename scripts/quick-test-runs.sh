#!/bin/bash
# Quick script to generate test simulation runs for the strategy comparison UI

set -e

echo "🚀 Generating quick test runs..."

# Get today's date and yesterday's date
TODAY=$(date -u +"%Y-%m-%d")
YESTERDAY=$(date -u -d "1 day ago" +"%Y-%m-%d" 2>/dev/null || date -u -v-1d +"%Y-%m-%d" 2>/dev/null || date -u -d "yesterday" +"%Y-%m-%d")

# Try to find a date range with calls
# Use a 7-day window to increase chances of finding calls
FROM_DATE=$(date -u -d "7 days ago" +"%Y-%m-%d" 2>/dev/null || date -u -v-7d +"%Y-%m-%d" 2>/dev/null || echo "$YESTERDAY")
TO_DATE="$TODAY"

echo "📅 Using date range: $FROM_DATE to $TO_DATE"

# Get the script directory and project root
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Run 3 quick path-only backtests with different intervals
echo ""
echo "Running path-only backtest (1m interval)..."
cd "$PROJECT_ROOT" && pnpm -C "$PROJECT_ROOT" exec -- quantbot backtest run \
  --strategy path-only \
  --interval 1m \
  --from "${FROM_DATE}T00:00:00Z" \
  --to "${TO_DATE}T23:59:59Z" \
  --taker-fee-bps 30 \
  --slippage-bps 10 \
  --position-usd 1000 || echo "⚠️  Run 1 failed (this is OK if no calls found)"

echo ""
echo "Running path-only backtest (5m interval)..."
cd "$PROJECT_ROOT" && pnpm -C "$PROJECT_ROOT" exec -- quantbot backtest run \
  --strategy path-only \
  --interval 5m \
  --from "${FROM_DATE}T00:00:00Z" \
  --to "${TO_DATE}T23:59:59Z" \
  --taker-fee-bps 30 \
  --slippage-bps 10 \
  --position-usd 1000 || echo "⚠️  Run 2 failed (this is OK if no calls found)"

echo ""
echo "Running path-only backtest (15m interval)..."
cd "$PROJECT_ROOT" && pnpm -C "$PROJECT_ROOT" exec -- quantbot backtest run \
  --strategy path-only \
  --interval 15m \
  --from "${FROM_DATE}T00:00:00Z" \
  --to "${TO_DATE}T23:59:59Z" \
  --taker-fee-bps 30 \
  --slippage-bps 10 \
  --position-usd 1000 || echo "⚠️  Run 3 failed (this is OK if no calls found)"

echo ""
echo "✅ Quick test runs complete!"
echo ""
echo "Check your runs with: pnpm -C $PROJECT_ROOT exec -- quantbot backtest list"


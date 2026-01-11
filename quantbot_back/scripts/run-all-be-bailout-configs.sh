#!/bin/bash
# Run all Break-Even Bailout configurations
#
# Usage:
#   ./scripts/run-all-be-bailout-configs.sh [FROM_DATE] [TO_DATE] [INTERVAL] [PARALLEL_JOBS]
#
# Example:
#   ./scripts/run-all-be-bailout-configs.sh 2024-01-01 2024-12-31 5m 5

set -e

FROM_DATE="${1:-2024-01-01}"
TO_DATE="${2:-2024-12-31}"
INTERVAL="${3:-5m}"
PARALLEL="${4:-1}"

TAKER_FEE_BPS=30
SLIPPAGE_BPS=10
POSITION_USD=1000

CONFIG_FILE="optimize-be-bailout-configs.json"

if [ ! -f "$CONFIG_FILE" ]; then
  echo "Error: $CONFIG_FILE not found. Run: pnpm exec tsx scripts/optimize-be-bailout.ts"
  exit 1
fi

if [ -z "$DUCKDB_PATH" ]; then
  echo "Error: DUCKDB_PATH environment variable not set"
  echo "Set it with: export DUCKDB_PATH=data/alerts.duckdb"
  exit 1
fi

echo "Running BE Bailout optimization"
echo "Date range: $FROM_DATE to $TO_DATE"
echo "Interval: $INTERVAL"
echo "Parallel jobs: $PARALLEL"
echo ""

# Extract config IDs
CONFIG_IDS=$(jq -r '.configs[].configId' "$CONFIG_FILE" 2>/dev/null || node -e "const fs=require('fs'); const d=JSON.parse(fs.readFileSync('$CONFIG_FILE')); d.configs.forEach(c=>console.log(c.configId))")

if [ -z "$CONFIG_IDS" ]; then
  echo "Error: Could not extract config IDs from $CONFIG_FILE"
  exit 1
fi

TOTAL=$(echo "$CONFIG_IDS" | wc -l)
echo "Total configurations: $TOTAL"
echo ""

# Function to run a single config
run_config() {
  local CONFIG_ID="$1"
  local STRATEGY_ID="be_bailout_${CONFIG_ID}"
  local RUN_ID="be_bailout_${CONFIG_ID}_$(date +%Y%m%d_%H%M%S)"
  
  echo "[$(date +%H:%M:%S)] Running: $STRATEGY_ID"
  
  if quantbot backtest run \
    --strategy exit-stack \
    --strategy-id "$STRATEGY_ID" \
    --interval "$INTERVAL" \
    --from "$FROM_DATE" \
    --to "$TO_DATE" \
    --taker-fee-bps "$TAKER_FEE_BPS" \
    --slippage-bps "$SLIPPAGE_BPS" \
    --position-usd "$POSITION_USD" \
    --run-id "$RUN_ID" 2>&1; then
    echo "[$(date +%H:%M:%S)] ✓ Completed: $RUN_ID"
  else
    echo "[$(date +%H:%M:%S)] ✗ Failed: $STRATEGY_ID"
    return 1
  fi
}

export -f run_config
export FROM_DATE TO_DATE INTERVAL TAKER_FEE_BPS SLIPPAGE_BPS POSITION_USD

# Run in parallel or sequential
if [ "$PARALLEL" -gt 1 ]; then
  echo "Running with $PARALLEL parallel jobs..."
  echo "$CONFIG_IDS" | xargs -P "$PARALLEL" -I {} bash -c 'run_config "$@"' _ {}
else
  echo "Running sequentially..."
  while IFS= read -r CONFIG_ID; do
    run_config "$CONFIG_ID"
    echo "---"
  done <<< "$CONFIG_IDS"
fi

echo ""
echo "✅ All configurations completed!"
echo ""
echo "Query results with:"
echo "  quantbot backtest list --format table"
echo ""
echo "Or query DuckDB directly:"
echo "  duckdb $DUCKDB_PATH"
echo "  SELECT strategy_id, COUNT(*) as trades, SUM(pnl_usd) as total_pnl"
echo "  FROM backtest_strategies s"
echo "  JOIN backtest_runs r ON r.strategy_id = s.strategy_id"
echo "  JOIN backtest_call_results cr ON cr.run_id = r.run_id"
echo "  WHERE s.strategy_id LIKE 'be_bailout_%'"
echo "  GROUP BY strategy_id"
echo "  ORDER BY total_pnl DESC;"


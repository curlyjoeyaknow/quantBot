#!/bin/bash
# Example Usage of Research Commands
# ===================================
#
# This script demonstrates how to use the research commands
# to create snapshots, execution models, cost models, and risk models.

set -e

echo "=========================================="
echo "Research Commands - Example Usage"
echo "=========================================="
echo ""

# Example 1: Create a Data Snapshot
echo "Example 1: Creating a Data Snapshot"
echo "-----------------------------------"
echo ""
echo "Command:"
echo '  quantbot research create-snapshot \\'
echo '    --from "2024-01-01T00:00:00Z" \\'
echo '    --to "2024-01-02T00:00:00Z" \\'
echo '    --venue "pump.fun" \\'
echo '    --chain "solana" \\'
echo '    --format json'
echo ""
echo "Output example:"
cat << 'EOF'
{
  "snapshotId": "snapshot-1704067200000-a1b2c3d4",
  "contentHash": "a1b2c3d4e5f6...",
  "timeRange": {
    "fromISO": "2024-01-01T00:00:00.000Z",
    "toISO": "2024-01-02T00:00:00.000Z"
  },
  "sources": [
    {
      "venue": "pump.fun",
      "chain": "solana"
    }
  ],
  "filters": {},
  "schemaVersion": "1.0.0",
  "createdAtISO": "2024-01-01T12:00:00.000Z"
}
EOF
echo ""
echo ""

# Example 2: Create an Execution Model
echo "Example 2: Creating an Execution Model"
echo "--------------------------------------"
echo ""
echo "Command:"
echo '  quantbot research create-execution-model \\'
echo '    --latency-samples "100,150,200,250,300,350,400" \\'
echo '    --slippage-samples "0.001,0.002,0.003,0.004,0.005" \\'
echo '    --failure-rate "0.02" \\'
echo '    --partial-fill-rate "0.1" \\'
echo '    --venue "pumpfun" \\'
echo '    --format json'
echo ""
echo "Output example:"
cat << 'EOF'
{
  "latency": {
    "p50": 200,
    "p95": 350,
    "p99": 400,
    "mean": 235.7,
    "stdDev": 98.2
  },
  "slippage": {
    "p50": 0.003,
    "p95": 0.005,
    "p99": 0.006,
    "mean": 0.003,
    "stdDev": 0.0014
  },
  "failures": {
    "rate": 0.02,
    "retryable": 0.015,
    "permanent": 0.005
  },
  "partialFills": {
    "rate": 0.1,
    "avgFillRatio": 0.85
  },
  "venue": "pumpfun",
  "calibratedAt": "2024-01-01T12:00:00.000Z"
}
EOF
echo ""
echo ""

# Example 3: Create a Cost Model
echo "Example 3: Creating a Cost Model"
echo "--------------------------------"
echo ""
echo "Command:"
echo '  quantbot research create-cost-model \\'
echo '    --base-fee "5000" \\'
echo '    --priority-fee-min "1000" \\'
echo '    --priority-fee-max "10000" \\'
echo '    --trading-fee-percent "0.01" \\'
echo '    --format json'
echo ""
echo "Output example:"
cat << 'EOF'
{
  "baseFee": 5000,
  "priorityFee": {
    "base": 1000,
    "max": 10000
  },
  "tradingFee": 0.01,
  "effectiveCostPerTrade": 15000
}
EOF
echo ""
echo ""

# Example 4: Create a Risk Model
echo "Example 4: Creating a Risk Model"
echo "---------------------------------"
echo ""
echo "Command:"
echo '  quantbot research create-risk-model \\'
echo '    --max-drawdown-percent "20" \\'
echo '    --max-loss-per-day "1000" \\'
echo '    --max-consecutive-losses "5" \\'
echo '    --max-position-size "500" \\'
echo '    --format json'
echo ""
echo "Output example:"
cat << 'EOF'
{
  "maxDrawdown": 0.2,
  "maxLossPerDay": 1000,
  "maxConsecutiveLosses": 5,
  "maxPositionSize": 500,
  "tradeThrottle": {
    "maxTradesPerMinute": 10,
    "maxTradesPerHour": 100
  }
}
EOF
echo ""
echo ""

# Example 5: Complete Workflow
echo "Example 5: Complete Research Workflow"
echo "--------------------------------------"
echo ""
echo "A typical research workflow might look like this:"
echo ""
cat << 'EOF'
# Step 1: Create a snapshot of historical data
SNAPSHOT=$(quantbot research create-snapshot \
  --from "2024-01-01T00:00:00Z" \
  --to "2024-01-07T00:00:00Z" \
  --venue "pump.fun" \
  --format json | jq -r '.snapshotId')

echo "Created snapshot: $SNAPSHOT"

# Step 2: Create execution model from calibration data
EXEC_MODEL=$(quantbot research create-execution-model \
  --latency-samples "100,150,200,250,300" \
  --failure-rate "0.02" \
  --format json)

echo "Created execution model"

# Step 3: Create cost model
COST_MODEL=$(quantbot research create-cost-model \
  --base-fee "5000" \
  --trading-fee-percent "0.01" \
  --format json)

echo "Created cost model"

# Step 4: Create risk model
RISK_MODEL=$(quantbot research create-risk-model \
  --max-drawdown-percent "20" \
  --max-loss-per-day "1000" \
  --format json)

echo "Created risk model"

# Step 5: Use these in a simulation
# (The simulation would use these models via the workflow API)
EOF
echo ""
echo ""

# Example 6: Table Format
echo "Example 6: Using Table Format (Human-Readable)"
echo "-----------------------------------------------"
echo ""
echo "Command:"
echo '  quantbot research create-snapshot \\'
echo '    --from "2024-01-01T00:00:00Z" \\'
echo '    --to "2024-01-02T00:00:00Z" \\'
echo '    --format table'
echo ""
echo "Output example:"
cat << 'EOF'
┌─────────────────────────────────────────────────────────────┐
│                    Data Snapshot                             │
├─────────────────────────────────────────────────────────────┤
│ Snapshot ID:     snapshot-1704067200000-a1b2c3d4          │
│ Content Hash:    a1b2c3d4e5f6...                            │
│ Time Range:      2024-01-01T00:00:00Z → 2024-01-02T00:00:00Z│
│ Sources:         pump.fun (solana)                          │
│ Created:         2024-01-01T12:00:00.000Z                    │
└─────────────────────────────────────────────────────────────┘
EOF
echo ""
echo ""

echo "=========================================="
echo "For more information, run:"
echo "  quantbot research --help"
echo "  quantbot research <command> --help"
echo "=========================================="


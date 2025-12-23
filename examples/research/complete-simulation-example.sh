#!/bin/bash
# Example: Complete simulation workflow using research services
#
# This script demonstrates a complete workflow:
# 1. Create data snapshot
# 2. Create execution/cost/risk models
# 3. Run simulation

set -e

echo "=== Step 1: Create Data Snapshot ==="
quantbot research create-snapshot \
  --from "2024-01-01T00:00:00Z" \
  --to "2024-01-02T00:00:00Z" \
  --venue "pump.fun" \
  --format "json" \
  > snapshot.json

echo "Snapshot created: snapshot.json"

echo ""
echo "=== Step 2: Create Execution Model ==="
quantbot research create-execution-model \
  --latency-samples "100,200,300,400,500" \
  --failure-rate "0.01" \
  --format "json" \
  > execution-model.json

echo "Execution model created: execution-model.json"

echo ""
echo "=== Step 3: Create Cost Model ==="
quantbot research create-cost-model \
  --base-fee "5000" \
  --trading-fee-percent "0.01" \
  --format "json" \
  > cost-model.json

echo "Cost model created: cost-model.json"

echo ""
echo "=== Step 4: Create Risk Model ==="
quantbot research create-risk-model \
  --max-drawdown-percent "20" \
  --max-loss-per-day "1000" \
  --format "json" \
  > risk-model.json

echo "Risk model created: risk-model.json"

echo ""
echo "=== Step 5: Create Simulation Request ==="
# Create a complete simulation request JSON
cat > simulation-request.json <<EOF
{
  "dataSnapshot": $(cat snapshot.json),
  "strategy": {
    "strategyId": "strategy-001",
    "name": "momentum-breakout",
    "config": {
      "targets": [{"target": 2, "percent": 0.5}]
    },
    "configHash": "a".repeat(64)
  },
  "executionModel": $(cat execution-model.json),
  "costModel": $(cat cost-model.json),
  "riskModel": $(cat risk-model.json),
  "runConfig": {
    "seed": 12345,
    "timeResolutionMs": 1000,
    "errorMode": "collect"
  }
}
EOF

echo "Simulation request created: simulation-request.json"

echo ""
echo "=== Step 6: Run Simulation ==="
echo "To run the simulation, use:"
echo "  quantbot research run --request-file simulation-request.json"

echo ""
echo "=== All files created ==="
ls -lh *.json


#!/bin/bash
# Example: Create a risk model from constraints
#
# This script demonstrates how to create a risk model using the CLI.

set -e

echo "Creating risk model..."

# Create risk model with constraints
quantbot research create-risk-model \
  --max-drawdown-percent "20" \
  --max-loss-per-day "1000" \
  --max-consecutive-losses "5" \
  --max-position-size "500" \
  --format "json" \
  > risk-model.json

echo "Risk model created: risk-model.json"
echo ""
echo "Model contents:"
cat risk-model.json | jq '.'


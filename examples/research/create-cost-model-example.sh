#!/bin/bash
# Example: Create a cost model from fee data
#
# This script demonstrates how to create a cost model using the CLI.

set -e

echo "Creating cost model..."

# Create cost model with fee structure
quantbot research create-cost-model \
  --base-fee "5000" \
  --priority-fee-min "1000" \
  --priority-fee-max "10000" \
  --trading-fee-percent "0.01" \
  --format "json" \
  > cost-model.json

echo "Cost model created: cost-model.json"
echo ""
echo "Model contents:"
cat cost-model.json | jq '.'


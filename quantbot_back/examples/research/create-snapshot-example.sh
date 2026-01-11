#!/bin/bash
# Example: Create a data snapshot for simulations
#
# This script demonstrates how to create a data snapshot using the CLI.

set -e

echo "Creating data snapshot..."

# Create snapshot for a specific time range
quantbot research create-snapshot \
  --from "2024-01-01T00:00:00Z" \
  --to "2024-01-02T00:00:00Z" \
  --venue "pump.fun" \
  --chain "solana" \
  --format "json" \
  > snapshot.json

echo "Snapshot created: snapshot.json"
echo ""
echo "Snapshot contents:"
cat snapshot.json | jq '.'


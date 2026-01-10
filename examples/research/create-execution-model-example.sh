#!/bin/bash
# Example: Create an execution model from calibration data
#
# This script demonstrates how to create an execution model using the CLI.

set -e

echo "Creating execution model..."

# Create execution model with latency samples
quantbot research create-execution-model \
  --latency-samples "50,100,150,200,250,300,350,400,450,500" \
  --failure-rate "0.01" \
  --partial-fill-rate "0.1" \
  --venue "pumpfun" \
  --format "json" \
  > execution-model.json

echo "Execution model created: execution-model.json"
echo ""
echo "Model contents:"
cat execution-model.json | jq '.'


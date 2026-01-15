#!/bin/bash
# Script to run telegram ingestion and generate caller summary report

cd "$(dirname "$0")"

# Set DuckDB path if not already set
export DUCKDB_PATH="${DUCKDB_PATH:-$(pwd)/../data/tele.duckdb}"

echo "Running telegram ingestion and report generation..."
echo "DuckDB Path: $DUCKDB_PATH"
echo "Telegram File: $(pwd)/result.json"

# Run the TypeScript script (assuming it's been compiled or using ts-node)
# You may need to adjust this based on your setup
npx tsx ingest-and-report.ts

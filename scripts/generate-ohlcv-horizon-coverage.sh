#!/usr/bin/env bash
set -euo pipefail

# Generate OHLCV Horizon Coverage Matrix
#
# This script generates coverage matrices for both 1m and 5m candles,
# showing data availability at different horizon times for alerts grouped by month.
#
# Usage:
#   ./scripts/generate-ohlcv-horizon-coverage.sh [--duckdb <path>] [--visualize]

DUCKDB_PATH="${DUCKDB_PATH:-data/tele.duckdb}"
VISUALIZE="${VISUALIZE:-false}"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --duckdb)
      DUCKDB_PATH="$2"
      shift 2
      ;;
    --visualize)
      VISUALIZE=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Usage: $0 [--duckdb <path>] [--visualize]" >&2
      exit 1
      ;;
  esac
done

if [[ ! -f "$DUCKDB_PATH" ]]; then
  echo "❌ DuckDB file not found: $DUCKDB_PATH" >&2
  exit 1
fi

echo "Generating OHLCV horizon coverage matrices..."
echo "DuckDB: $DUCKDB_PATH"
echo ""

# Generate 1m coverage matrix
echo "📊 Generating 1m candle coverage matrix..."
VISUALIZE_FLAG=""
if [[ "$VISUALIZE" == "true" ]]; then
  VISUALIZE_FLAG="--visualize"
fi

python3 tools/storage/ohlcv_horizon_coverage_matrix.py \
  --duckdb "$DUCKDB_PATH" \
  --interval 1m \
  $VISUALIZE_FLAG

echo ""
echo "📊 Generating 5m candle coverage matrix..."

python3 tools/storage/ohlcv_horizon_coverage_matrix.py \
  --duckdb "$DUCKDB_PATH" \
  --interval 5m \
  $VISUALIZE_FLAG

echo ""
echo "✅ Coverage matrices generated and stored in DuckDB"
echo ""
echo "Tables created:"
echo "  - ohlcv_horizon_coverage_1m"
echo "  - ohlcv_horizon_coverage_5m"
echo ""
echo "Query examples:"
echo "  SELECT * FROM ohlcv_horizon_coverage_1m WHERE month_key = '2025-05';"
echo "  SELECT * FROM ohlcv_horizon_coverage_5m ORDER BY month_key, horizon_hours;"


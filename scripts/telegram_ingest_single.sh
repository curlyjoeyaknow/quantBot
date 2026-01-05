#!/usr/bin/env bash
set -euo pipefail

DUCKDB_PATH="${DUCKDB_PATH:-data/alerts.duckdb}"
RESULT_JSON="${1:-}"
CHAIN="${CHAIN:-solana}"

if [[ -z "${RESULT_JSON}" ]]; then
  echo "usage: $0 /path/to/result.json"
  exit 1
fi

python3 ./scripts/ingest_telegram_result_json.py \
  --duckdb "${DUCKDB_PATH}" \
  --result-json "${RESULT_JSON}" \
  --chain "${CHAIN}" \
  --extract-alerts

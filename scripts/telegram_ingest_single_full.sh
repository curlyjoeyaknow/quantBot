#!/usr/bin/env bash
set -euo pipefail

DUCKDB_PATH="${DUCKDB_PATH:-data/alerts.duckdb}"
CHAIN="${CHAIN:-solana}"
SOURCE_SYSTEM="${SOURCE_SYSTEM:-telegram}"

RESULT_JSON="${1:-}"
if [[ -z "${RESULT_JSON}" ]]; then
  echo "usage: $0 /path/to/result.json"
  exit 1
fi

python3 ./scripts/ingest_telegram_result_json_full.py \
  --duckdb "${DUCKDB_PATH}" \
  --result-json "${RESULT_JSON}" \
  --chain "${CHAIN}" \
  --source-system "${SOURCE_SYSTEM}" \
  --extract-alerts

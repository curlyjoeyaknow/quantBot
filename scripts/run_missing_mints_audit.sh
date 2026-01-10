#!/usr/bin/env bash
set -euo pipefail

DB_PATH="${1:-tele.duckdb}"

if [[ ! -f "$DB_PATH" ]]; then
  echo "DuckDB not found: $DB_PATH" >&2
  exit 1
fi

echo "Running missing mints audit on: $DB_PATH"
echo ""

duckdb "$DB_PATH" < scripts/duckdb_missing_mints_audit.sql


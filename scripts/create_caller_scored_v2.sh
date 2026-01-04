#!/usr/bin/env bash
# Create the caller_scored_v2 view in a DuckDB database.
# This scoring system rewards "fast 2x with controlled pre-2x pain"
# rather than "who got lucky tails".
#
# Usage:
#   ./scripts/create_caller_scored_v2.sh [db_path]
#
# Examples:
#   ./scripts/create_caller_scored_v2.sh                     # uses data/alerts.duckdb
#   ./scripts/create_caller_scored_v2.sh data/test.duckdb   # uses custom path

set -euo pipefail

DB="${1:-data/alerts.duckdb}"

if [[ ! -f "$DB" ]]; then
  echo "[error] Database not found: $DB" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_FILE="$SCRIPT_DIR/create_caller_scored_v2.sql"

if [[ ! -f "$SQL_FILE" ]]; then
  echo "[error] SQL file not found: $SQL_FILE" >&2
  exit 1
fi

duckdb "$DB" < "$SQL_FILE"

echo "[ok] created baseline.caller_scored_v2 and baseline.caller_leaderboard_v2 in $DB"


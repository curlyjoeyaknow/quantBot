#!/usr/bin/env bash
set -euo pipefail

# Fetch stored coverage snapshots.
#
# Usage:
#   ./scripts/coverage-fetch.sh latest
#   ./scripts/coverage-fetch.sh branch <branchName>
#   ./scripts/coverage-fetch.sh history [n]
#
# Output is JSON (except history prints NDJSON lines).

CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}"
STORE_DIR="$CACHE_ROOT/quantbot/coverage"
BY_BRANCH_DIR="$STORE_DIR/by-branch"

MODE="${1:-latest}"

case "$MODE" in
  latest)
    cat "$STORE_DIR/latest.json"
    ;;
  branch)
    BR="${2:-}"
    if [[ -z "$BR" ]]; then
      echo "❌ branch name required" >&2
      exit 1
    fi
    SAFE="${BR//[^a-zA-Z0-9._-]/_}"
    cat "$BY_BRANCH_DIR/$SAFE.json"
    ;;
  history)
    N="${2:-20}"
    if [[ ! -f "$STORE_DIR/history.ndjson" ]]; then
      echo "❌ No history yet at $STORE_DIR/history.ndjson" >&2
      exit 1
    fi
    tail -n "$N" "$STORE_DIR/history.ndjson"
    ;;
  *)
    echo "❌ Unknown mode: $MODE" >&2
    echo "Modes: latest | branch <name> | history [n]" >&2
    exit 1
    ;;
esac

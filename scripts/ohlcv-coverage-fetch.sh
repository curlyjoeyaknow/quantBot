#!/usr/bin/env bash
set -euo pipefail

# Fetch stored OHLCV coverage snapshots.
#
# Usage:
#   ./scripts/ohlcv-coverage-fetch.sh latest
#   ./scripts/ohlcv-coverage-fetch.sh tf <tf>
#   ./scripts/ohlcv-coverage-fetch.sh history [n]

CACHE_ROOT="${XDG_CACHE_HOME:-$HOME/.cache}"
STORE_DIR="$CACHE_ROOT/quantbot/ohlcv-coverage"
BY_TF_DIR="$STORE_DIR/by-tf"

MODE="${1:-latest}"

case "$MODE" in
  latest)
    cat "$STORE_DIR/latest.json"
    ;;
  tf)
    TF="${2:-}"
    if [[ -z "$TF" ]]; then
      echo "❌ tf required (e.g. 15s, 1m, 5m)" >&2
      exit 1
    fi
    SAFE="${TF//[^a-zA-Z0-9._-]/_}"
    cat "$BY_TF_DIR/$SAFE.json"
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
    echo "Modes: latest | tf <tf> | history [n]" >&2
    exit 1
    ;;
esac


#!/usr/bin/env bash
#
# Process re-ingestion worklist
#
# This script processes tokens from the candle quality worklist and
# re-ingests their OHLCV data with fresh API calls.
#
# Usage:
#   ./tools/storage/process_reingest_worklist.sh [worklist.json] [--priority critical|high|medium|low] [--dry-run]

set -euo pipefail

WORKLIST_FILE="${1:-candle_quality_worklist.json}"
PRIORITY="${2:-all}"
DRY_RUN=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --priority)
      PRIORITY="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    *)
      WORKLIST_FILE="$1"
      shift
      ;;
  esac
done

if [ ! -f "$WORKLIST_FILE" ]; then
  echo "Error: Worklist file not found: $WORKLIST_FILE"
  echo "Usage: $0 [worklist.json] [--priority critical|high|medium|low] [--dry-run]"
  exit 1
fi

echo "Processing re-ingestion worklist: $WORKLIST_FILE"
echo "Priority filter: $PRIORITY"
echo "Dry run: $DRY_RUN"
echo ""

# Extract tokens from worklist based on priority
if [ "$PRIORITY" = "all" ]; then
  TOKENS=$(jq -r '.worklist[] | "\(.mint) \(.chain) \(.priority) \(.quality_score)"' "$WORKLIST_FILE")
else
  TOKENS=$(jq -r ".worklist[] | select(.priority == \"$PRIORITY\") | \"\(.mint) \(.chain) \(.priority) \(.quality_score)\"" "$WORKLIST_FILE")
fi

# Count tokens
TOKEN_COUNT=$(echo "$TOKENS" | wc -l)
echo "Found $TOKEN_COUNT tokens to process"
echo ""

if [ "$TOKEN_COUNT" -eq 0 ]; then
  echo "No tokens to process"
  exit 0
fi

# Process each token
PROCESSED=0
FAILED=0

while IFS= read -r line; do
  if [ -z "$line" ]; then
    continue
  fi
  
  MINT=$(echo "$line" | awk '{print $1}')
  CHAIN=$(echo "$line" | awk '{print $2}')
  TOKEN_PRIORITY=$(echo "$line" | awk '{print $3}')
  QUALITY_SCORE=$(echo "$line" | awk '{print $4}')
  
  PROCESSED=$((PROCESSED + 1))
  
  echo "[$PROCESSED/$TOKEN_COUNT] Processing: $MINT"
  echo "  Chain: $CHAIN"
  echo "  Priority: $TOKEN_PRIORITY"
  echo "  Quality Score: $QUALITY_SCORE"
  
  if [ "$DRY_RUN" = true ]; then
    echo "  [DRY RUN] Would re-ingest OHLCV data"
  else
    # First, deduplicate existing candles for this token
    echo "  Deduplicating existing candles..."
    if quantbot storage deduplicate --token "$MINT" --chain "$CHAIN" --no-dry-run 2>&1 | tee /tmp/deduplicate.log; then
      echo "  ✓ Deduplication complete"
    else
      echo "  ⚠ Deduplication failed (continuing anyway)"
    fi
    
    # Re-ingest OHLCV data
    echo "  Re-ingesting OHLCV data..."
    if quantbot ingestion ensure-ohlcv-coverage \
      --token "$MINT" \
      --chain "$CHAIN" \
      --pre-window 260 \
      --post-window 1440 \
      --force-refresh 2>&1 | tee /tmp/reingest.log; then
      echo "  ✓ Re-ingestion complete"
    else
      echo "  ✗ Re-ingestion failed"
      FAILED=$((FAILED + 1))
    fi
  fi
  
  echo ""
  
  # Rate limiting (avoid overwhelming API)
  if [ "$DRY_RUN" = false ]; then
    sleep 2
  fi
done <<< "$TOKENS"

echo "================================"
echo "Re-ingestion Summary"
echo "================================"
echo "Total tokens: $TOKEN_COUNT"
echo "Processed: $PROCESSED"
echo "Failed: $FAILED"
echo "Success rate: $(( (PROCESSED - FAILED) * 100 / PROCESSED ))%"

if [ "$DRY_RUN" = true ]; then
  echo ""
  echo "This was a dry run. No changes were made."
  echo "Run without --dry-run to actually re-ingest data."
fi


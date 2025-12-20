#!/bin/bash

# Batch ingest Telegram JSON files from July to December 18, 2024
# Uses the idempotent telegram-python CLI command
#
# Usage:
#   ./scripts/batch-telegram-jul-dec18.sh <directory> <output-db> <chat-id>
#
# Example:
#   ./scripts/batch-telegram-jul-dec18.sh data/telegram-exports data/quantbot.db my_chat_id

set -e

if [ $# -lt 3 ]; then
  echo "Usage: $0 <directory> <output-db> <chat-id>"
  echo "Example: $0 data/telegram-exports data/quantbot.db my_chat_id"
  exit 1
fi

DIR="$1"
OUTPUT_DB="$2"
CHAT_ID="$3"

if [ ! -d "$DIR" ]; then
  echo "❌ Directory not found: $DIR"
  exit 1
fi

# Find all JSON files and filter by date (July 1 - Dec 18, 2024)
# Files are included if their modification date or filename date is in range
FILES=$(find "$DIR" -name "*.json" -type f | sort)

TOTAL=0
PROCESSED=0
FAILED=0
FAILED_FILES=()

echo ""
echo "📂 Processing Telegram JSON files from July - Dec 18, 2024"
echo "   Directory: $DIR"
echo "   Output DB: $OUTPUT_DB"
echo "   Chat ID: $CHAT_ID"
echo ""

for file in $FILES; do
  # Check if file date is in range (July 1 - Dec 18, 2024)
  # Try to extract date from filename first
  FILENAME=$(basename "$file" .json)
  
  # Pattern: YYYY-MM-DD or YYYYMMDD
  if [[ $FILENAME =~ ([0-9]{4})[-_]?([0-9]{2})[-_]?([0-9]{2}) ]]; then
    YEAR="${BASH_REMATCH[1]}"
    MONTH="${BASH_REMATCH[2]}"
    DAY="${BASH_REMATCH[3]}"
    
    # Check if date is in range (2024-07-01 to 2024-12-18)
    if [ "$YEAR" -lt 2024 ] || [ "$YEAR" -gt 2024 ]; then
      continue
    fi
    if [ "$MONTH" -lt 7 ] || ([ "$MONTH" -eq 12 ] && [ "$DAY" -gt 18 ]); then
      continue
    fi
    if [ "$MONTH" -gt 12 ]; then
      continue
    fi
  else
    # Fallback: check file modification time
    # Get file date (YYYY-MM-DD format)
    FILE_DATE=$(stat -c %y "$file" | cut -d' ' -f1)
    FILE_YEAR=$(echo "$FILE_DATE" | cut -d'-' -f1)
    FILE_MONTH=$(echo "$FILE_DATE" | cut -d'-' -f2)
    FILE_DAY=$(echo "$FILE_DATE" | cut -d'-' -f3)
    
    # Check if date is in range
    if [ "$FILE_YEAR" -ne 2024 ]; then
      continue
    fi
    if [ "$FILE_MONTH" -lt 7 ] || ([ "$FILE_MONTH" -eq 12 ] && [ "$FILE_DAY" -gt 18 ]); then
      continue
    fi
    if [ "$FILE_MONTH" -gt 12 ]; then
      continue
    fi
  fi
  
  TOTAL=$((TOTAL + 1))
  echo "[$TOTAL] Processing: $(basename "$file")"
  
  # Use rebuild=false for idempotent ingestion (preserves existing data)
  if pnpm quantbot ingestion telegram-python \
    --file "$file" \
    --output-db "$OUTPUT_DB" \
    --chat-id "$CHAT_ID" \
    --format json > /dev/null 2>&1; then
    echo "   ✅ Success"
    PROCESSED=$((PROCESSED + 1))
  else
    echo "   ❌ Failed"
    FAILED=$((FAILED + 1))
    FAILED_FILES+=("$file")
  fi
  
  # Small delay between files
  sleep 0.5
done

echo ""
echo "=================================================================================="
echo "📊 BATCH INGESTION SUMMARY"
echo "=================================================================================="
echo "Files processed: $PROCESSED/$TOTAL"
echo "Files failed: $FAILED"
echo ""

if [ $FAILED -gt 0 ]; then
  echo "⚠️  Failed files:"
  for failed_file in "${FAILED_FILES[@]}"; do
    echo "   - $(basename "$failed_file")"
  done
fi

echo "=================================================================================="
echo ""

if [ $FAILED -eq 0 ]; then
  echo "✅ Batch ingestion complete!"
  exit 0
else
  echo "⚠️  Batch ingestion completed with $FAILED failures"
  exit 1
fi


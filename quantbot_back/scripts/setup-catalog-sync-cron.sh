#!/usr/bin/env bash
#
# Setup Catalog Sync Cron Job
#
# This script sets up a cron job to automatically sync completed backtest runs
# to the catalog every 5 minutes.
#
# Usage:
#   ./scripts/setup-catalog-sync-cron.sh [options]
#
# Options:
#   --interval <minutes>    Sync interval in minutes (default: 5)
#   --base-dir <path>       Base directory for runs (default: runs)
#   --duckdb <path>         DuckDB catalog path (default: data/backtest_catalog.duckdb)
#   --log-dir <path>        Log directory (default: logs/catalog-sync)
#   --dry-run               Show cron entry without installing
#   --uninstall             Remove the cron job
#   --help                  Show this help message

set -euo pipefail

# Default values
INTERVAL=5
BASE_DIR="runs"
DUCKDB_PATH="data/backtest_catalog.duckdb"
LOG_DIR="logs/catalog-sync"
DRY_RUN=false
UNINSTALL=false

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --interval)
      INTERVAL="$2"
      shift 2
      ;;
    --base-dir)
      BASE_DIR="$2"
      shift 2
      ;;
    --duckdb)
      DUCKDB_PATH="$2"
      shift 2
      ;;
    --log-dir)
      LOG_DIR="$2"
      shift 2
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --uninstall)
      UNINSTALL=true
      shift
      ;;
    --help)
      grep '^#' "$0" | grep -v '#!/' | sed 's/^# //' | sed 's/^#//'
      exit 0
      ;;
    *)
      echo "Unknown option: $1"
      echo "Use --help for usage information"
      exit 1
      ;;
  esac
done

# Validate interval
if ! [[ "$INTERVAL" =~ ^[0-9]+$ ]] || [ "$INTERVAL" -lt 1 ]; then
  echo "Error: Interval must be a positive integer"
  exit 1
fi

# Create log directory
mkdir -p "$PROJECT_ROOT/$LOG_DIR"

# Cron job marker
CRON_MARKER="# quantbot-catalog-sync"

# Build cron schedule
if [ "$INTERVAL" -eq 1 ]; then
  CRON_SCHEDULE="* * * * *"
elif [ "$INTERVAL" -lt 60 ]; then
  CRON_SCHEDULE="*/$INTERVAL * * * *"
else
  HOURS=$((INTERVAL / 60))
  CRON_SCHEDULE="0 */$HOURS * * *"
fi

# Build cron command
CRON_COMMAND="cd $PROJECT_ROOT && pnpm exec -- quantbot backtest catalog-sync --base-dir $BASE_DIR --duckdb $DUCKDB_PATH --stats >> $PROJECT_ROOT/$LOG_DIR/catalog-sync.log 2>&1"

# Full cron entry
CRON_ENTRY="$CRON_SCHEDULE $CRON_COMMAND $CRON_MARKER"

# Uninstall mode
if [ "$UNINSTALL" = true ]; then
  echo "Uninstalling catalog sync cron job..."
  
  # Remove existing cron job
  (crontab -l 2>/dev/null | grep -v "$CRON_MARKER") | crontab -
  
  echo "✓ Cron job removed"
  echo ""
  echo "To verify:"
  echo "  crontab -l"
  exit 0
fi

# Dry run mode
if [ "$DRY_RUN" = true ]; then
  echo "Dry run mode - cron entry that would be installed:"
  echo ""
  echo "$CRON_ENTRY"
  echo ""
  echo "To install, run without --dry-run"
  exit 0
fi

# Install cron job
echo "Installing catalog sync cron job..."
echo ""
echo "Configuration:"
echo "  Interval:    Every $INTERVAL minute(s)"
echo "  Base dir:    $BASE_DIR"
echo "  DuckDB:      $DUCKDB_PATH"
echo "  Log dir:     $LOG_DIR"
echo "  Project:     $PROJECT_ROOT"
echo ""

# Remove existing cron job if present
(crontab -l 2>/dev/null | grep -v "$CRON_MARKER") | crontab - 2>/dev/null || true

# Add new cron job
(crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -

echo "✓ Cron job installed"
echo ""
echo "To verify:"
echo "  crontab -l"
echo ""
echo "To view logs:"
echo "  tail -f $PROJECT_ROOT/$LOG_DIR/catalog-sync.log"
echo ""
echo "To uninstall:"
echo "  $0 --uninstall"


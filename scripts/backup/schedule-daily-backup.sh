#!/bin/bash
# Setup daily ClickHouse backup cron job
# Usage: ./scripts/backup/schedule-daily-backup.sh

set -e

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
BACKUP_SCRIPT="${PROJECT_ROOT}/scripts/backup/backup-clickhouse.sh"
CRON_LOG="${PROJECT_ROOT}/data/backup/clickhouse/cron.log"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}╔════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║     Setup Daily ClickHouse Backup            ║${NC}"
echo -e "${BLUE}╚════════════════════════════════════════════════╝${NC}"
echo ""

# Check if backup script exists
if [ ! -f "$BACKUP_SCRIPT" ]; then
    echo -e "${RED}❌ Error: Backup script not found: $BACKUP_SCRIPT${NC}"
    exit 1
fi

# Make sure backup script is executable
chmod +x "$BACKUP_SCRIPT"

# Create cron log directory
mkdir -p "$(dirname "$CRON_LOG")"

# Default backup time: 2:00 AM daily
BACKUP_TIME=${1:-"2:00"}

# Parse time (format: HH:MM or HHMM)
if [[ "$BACKUP_TIME" =~ ^([0-9]{1,2}):([0-9]{2})$ ]]; then
    HOUR=${BASH_REMATCH[1]}
    MINUTE=${BASH_REMATCH[2]}
elif [[ "$BACKUP_TIME" =~ ^([0-9]{1,2})([0-9]{2})$ ]]; then
    HOUR=${BASH_REMATCH[1]}
    MINUTE=${BASH_REMATCH[2]}
else
    echo -e "${RED}❌ Error: Invalid time format. Use HH:MM or HHMM${NC}"
    exit 1
fi

# Validate hour and minute
if [ "$HOUR" -gt 23 ] || [ "$MINUTE" -gt 59 ]; then
    echo -e "${RED}❌ Error: Invalid time. Hour must be 0-23, minute must be 0-59${NC}"
    exit 1
fi

echo -e "${YELLOW}Backup Script: ${BACKUP_SCRIPT}${NC}"
echo -e "${YELLOW}Backup Time: ${HOUR}:${MINUTE} (daily)${NC}"
echo -e "${YELLOW}Cron Log: ${CRON_LOG}${NC}"
echo ""

# Create cron job entry
CRON_ENTRY="${MINUTE} ${HOUR} * * * cd ${PROJECT_ROOT} && ${BACKUP_SCRIPT} >> ${CRON_LOG} 2>&1"

# Check if cron job already exists
if crontab -l 2>/dev/null | grep -q "$BACKUP_SCRIPT"; then
    echo -e "${YELLOW}⚠ Cron job already exists for this backup script${NC}"
    echo ""
    echo "Current cron jobs for ClickHouse backup:"
    crontab -l 2>/dev/null | grep "$BACKUP_SCRIPT" || true
    echo ""
    read -p "Do you want to replace it? (y/N): " -n 1 -r
    echo ""
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo -e "${YELLOW}Cancelled. Existing cron job not modified.${NC}"
        exit 0
    fi
    
    # Remove existing cron job
    crontab -l 2>/dev/null | grep -v "$BACKUP_SCRIPT" | crontab -
    echo -e "${GREEN}✓ Removed existing cron job${NC}"
fi

# Add new cron job
(crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -

echo -e "${GREEN}✓ Daily backup cron job added${NC}"
echo ""
echo -e "${YELLOW}Cron job details:${NC}"
echo "  Schedule: ${HOUR}:${MINUTE} daily"
echo "  Command: ${BACKUP_SCRIPT}"
echo "  Log: ${CRON_LOG}"
echo ""
echo -e "${YELLOW}To view cron jobs:${NC}"
echo "  crontab -l"
echo ""
echo -e "${YELLOW}To remove cron job:${NC}"
echo "  crontab -e  # Then delete the line with backup-clickhouse.sh"
echo ""
echo -e "${YELLOW}To view backup logs:${NC}"
echo "  tail -f ${CRON_LOG}"
echo ""


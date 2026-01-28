#!/usr/bin/env bash
# Demo script to show log output format

# ANSI color codes
COLOR_RESET='\033[0m'
COLOR_GREEN='\033[0;32m'
COLOR_BLUE='\033[0;34m'
COLOR_YELLOW='\033[0;33m'
COLOR_RED='\033[0;31m'
COLOR_CYAN='\033[0;36m'

# Function to log messages with color
log() {
  local level="$1"
  shift
  local timestamp
  timestamp=$(date +'%H:%M:%S')
  local message="$*"
  
  case "$level" in
    INFO)
      echo -e "${COLOR_BLUE}${timestamp}${COLOR_RESET} - ${message}"
      ;;
    SUCCESS)
      echo -e "${COLOR_GREEN}${timestamp}${COLOR_RESET} - ${COLOR_GREEN}✓${COLOR_RESET} ${message}"
      ;;
    WARN)
      echo -e "${COLOR_YELLOW}${timestamp}${COLOR_RESET} - ${COLOR_YELLOW}⚠${COLOR_RESET} ${message}"
      ;;
    ERROR)
      echo -e "${COLOR_RED}${timestamp}${COLOR_RESET} - ${COLOR_RED}✗${COLOR_RESET} ${message}"
      ;;
    STAT)
      echo -e "${COLOR_CYAN}${timestamp}${COLOR_RESET} - ${COLOR_CYAN}→${COLOR_RESET} ${message}"
      ;;
  esac
}

echo "=== B2 Backup Log Format Demo ==="
echo ""
echo "Example 1: Successful sync with changes"
log INFO "Began sync [b2 sync] - Run 31"
sleep 0.5
log STAT "Uploaded: 42 files"
log STAT "Deleted: 3 files"
log STAT "Compared: 1523 files"
sleep 0.5
log SUCCESS "Sync completed - Run 31"
log STAT "Total files in bucket: 9619"

echo ""
echo "Example 2: Sync with no changes"
log INFO "Began sync [b2 sync] - Run 32"
sleep 0.5
log SUCCESS "Sync completed - Run 32 (no changes)"
log STAT "Total files in bucket: 9619"

echo ""
echo "Example 3: Failed sync"
log INFO "Began sync [b2 sync] - Run 33"
sleep 0.5
log ERROR "Sync failed - Run 33 (exit code: 1)"
log ERROR "Connection timeout to B2 server"

echo ""
echo "Example 4: Warning"
log WARN "Slow connection detected (< 10 KB/s)"

echo ""
echo "=== How to tail logs ==="
echo "journalctl -u b2-sync-opn.service -f"
echo "tail -f logs/b2-sync-opn-\$(date +%Y%m%d).log"

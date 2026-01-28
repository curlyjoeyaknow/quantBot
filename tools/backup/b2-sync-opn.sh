#!/usr/bin/env bash
set -euo pipefail

# B2 Backup Script for /home/memez/opn/
# Syncs to b2://memez-quant/opn/ every 6 hours
# Excludes node_modules and common build artifacts

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="${SCRIPT_DIR}/logs"
LOG_FILE="${LOG_DIR}/b2-sync-opn-$(date +%Y%m%d).log"
RUN_COUNTER_FILE="${SCRIPT_DIR}/.run_counter"

# B2 CLI path (use full path to avoid PATH issues in systemd)
B2_CLI="/home/memez/.local/bin/b2"

# Source directory and B2 destination
SOURCE_DIR="/home/memez/opn/"
B2_BUCKET="b2://memez-quant/opn/"

# ANSI color codes
COLOR_RESET='\033[0m'
COLOR_GREEN='\033[0;32m'
COLOR_BLUE='\033[0;34m'
COLOR_YELLOW='\033[0;33m'
COLOR_RED='\033[0;31m'
COLOR_CYAN='\033[0;36m'
COLOR_GRAY='\033[0;90m'

# Exclusion patterns (proper regex)
EXCLUDE_PATTERNS=(
  ".*/node_modules/.*"
  ".*/dist/.*"
  ".*/build/.*"
  ".*/.next/.*"
  ".*/.turbo/.*"
  ".*/coverage/.*"
  ".*/.cache/.*"
  ".*/.temp/.*"
  ".*/.tmp/.*"
  ".*\.log$"
  ".*\.DS_Store$"
  ".*Thumbs\.db$"
  ".*/.git/.*"
  ".*/.pnpm-store/.*"
  ".*/.npm/.*"
  ".*/.yarn/.*"
  ".*/target/.*"
  ".*/__pycache__/.*"
  ".*\.pyc$"
  ".*/.pytest_cache/.*"
  ".*/.venv/.*"
  ".*/venv/.*"
  ".*\.env\.local$"
  ".*\.env\..*\.local$"
)

# Create log directory if it doesn't exist
mkdir -p "${LOG_DIR}"

# Function to get/increment run counter
get_run_number() {
  if [[ -f "${RUN_COUNTER_FILE}" ]]; then
    cat "${RUN_COUNTER_FILE}"
  else
    echo "1"
  fi
}

increment_run_counter() {
  local current
  current=$(get_run_number)
  echo $((current + 1)) > "${RUN_COUNTER_FILE}"
}

# Function to log messages with color
log() {
  local level="$1"
  shift
  local timestamp
  timestamp=$(date +'%H:%M:%S')
  local message="$*"
  
  case "$level" in
    INFO)
      echo -e "${COLOR_BLUE}${timestamp}${COLOR_RESET} - ${message}" | tee -a "${LOG_FILE}"
      ;;
    SUCCESS)
      echo -e "${COLOR_GREEN}${timestamp}${COLOR_RESET} - ${COLOR_GREEN}✓${COLOR_RESET} ${message}" | tee -a "${LOG_FILE}"
      ;;
    WARN)
      echo -e "${COLOR_YELLOW}${timestamp}${COLOR_RESET} - ${COLOR_YELLOW}⚠${COLOR_RESET} ${message}" | tee -a "${LOG_FILE}"
      ;;
    ERROR)
      echo -e "${COLOR_RED}${timestamp}${COLOR_RESET} - ${COLOR_RED}✗${COLOR_RESET} ${message}" | tee -a "${LOG_FILE}"
      ;;
    STAT)
      echo -e "${COLOR_CYAN}${timestamp}${COLOR_RESET} - ${COLOR_CYAN}→${COLOR_RESET} ${message}" | tee -a "${LOG_FILE}"
      ;;
    *)
      echo -e "${COLOR_GRAY}${timestamp}${COLOR_RESET} - ${message}" | tee -a "${LOG_FILE}"
      ;;
  esac
}

# Function to check if b2 CLI is installed
check_b2_cli() {
  if [[ ! -x "${B2_CLI}" ]]; then
    log ERROR "b2 CLI not found at ${B2_CLI}"
    log ERROR "Install with: pipx install b2"
    exit 1
  fi
}

# Function to check if B2 is authorized
check_b2_auth() {
  if ! "${B2_CLI}" account get &> /dev/null; then
    log ERROR "B2 not authorized. Run: ${B2_CLI} account authorize"
    exit 1
  fi
}

# Function to build exclusion arguments
build_exclude_args() {
  local args=()
  for pattern in "${EXCLUDE_PATTERNS[@]}"; do
    args+=("--exclude-regex" "${pattern}")
  done
  echo "${args[@]}"
}

# Function to perform sync
perform_sync() {
  local run_num="$1"
  
  log INFO "Began sync [b2 sync] - Run ${run_num}"
  
  # Build exclusion arguments
  local exclude_args
  exclude_args=$(build_exclude_args)
  
  # Capture sync output and parse it
  local sync_output
  local temp_file
  temp_file=$(mktemp)
  
  # Perform sync with exclusions (suppress progress, capture summary)
  # shellcheck disable=SC2086
  if "${B2_CLI}" sync \
    --no-progress \
    --keep-days 30 \
    --replace-newer \
    --compare-versions size \
    ${exclude_args} \
    "${SOURCE_DIR}" \
    "${B2_BUCKET}" > "${temp_file}" 2>&1; then
    
    # Parse the output for statistics
    local uploaded=0
    local deleted=0
    local compared=0
    
    # Count operations from output
    uploaded=$(grep -c "^upload " "${temp_file}" 2>/dev/null || echo "0")
    deleted=$(grep -c "^delete " "${temp_file}" 2>/dev/null || echo "0")
    compared=$(grep -c "^compare " "${temp_file}" 2>/dev/null || echo "0")
    
    # Log summary
    if [[ $uploaded -gt 0 ]] || [[ $deleted -gt 0 ]]; then
      log SUCCESS "Sync completed - Run ${run_num}"
      [[ $uploaded -gt 0 ]] && log STAT "Uploaded: ${uploaded} files"
      [[ $deleted -gt 0 ]] && log STAT "Deleted: ${deleted} files"
      [[ $compared -gt 0 ]] && log STAT "Compared: ${compared} files"
    else
      log SUCCESS "Sync completed - Run ${run_num} (no changes)"
    fi
    
    rm -f "${temp_file}"
    return 0
  else
    local exit_code=$?
    log ERROR "Sync failed - Run ${run_num} (exit code: ${exit_code})"
    
    # Show last few lines of error
    tail -5 "${temp_file}" | while IFS= read -r line; do
      log ERROR "${line}"
    done
    
    rm -f "${temp_file}"
    return 1
  fi
}

# Function to get sync stats
get_sync_stats() {
  local file_count
  file_count=$("${B2_CLI}" ls --recursive "${B2_BUCKET}" 2>/dev/null | wc -l)
  log STAT "Total files in bucket: ${file_count}"
}

# Main execution
main() {
  # Get run number
  local run_num
  run_num=$(get_run_number)
  
  # Pre-flight checks (silent unless error)
  check_b2_cli
  check_b2_auth
  
  # Verify source directory exists
  if [[ ! -d "${SOURCE_DIR}" ]]; then
    log ERROR "Source directory does not exist: ${SOURCE_DIR}"
    exit 1
  fi
  
  # Perform sync
  if perform_sync "${run_num}"; then
    get_sync_stats
    increment_run_counter
    exit 0
  else
    log ERROR "Backup failed - Run ${run_num}"
    exit 1
  fi
}

# Run main function
main

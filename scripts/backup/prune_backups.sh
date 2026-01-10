#!/usr/bin/env bash
set -euo pipefail

# Keeps last N daily/weekly disaster backups, deletes the rest.

KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-12}"
BACKUP_ROOT="${BACKUP_ROOT:-backups}"
REPO_NAME="${REPO_NAME:-$(basename "$(pwd)")}"

log(){ echo "[prune] $*"; }

prune_glob() {
  local glob="$1"
  local keep="$2"
  local arr=()

  while IFS= read -r line; do arr+=("$line"); done < <(ls -1d $glob 2>/dev/null | sort || true)

  local n="${#arr[@]}"
  if (( n <= keep )); then
    log "Nothing to prune for $glob (have $n, keep $keep)"
    return 0
  fi

  local to_delete=$(( n - keep ))
  log "Pruning $to_delete from $glob (have $n, keep $keep)"

  for ((i=0; i<to_delete; i++)); do
    log "Deleting: ${arr[$i]}"
    rm -rf "${arr[$i]}"
  done
}

# Daily
prune_glob "${BACKUP_ROOT}/${REPO_NAME}__DISASTER_DAILY__*" "$KEEP_DAILY"
# Weekly
prune_glob "${BACKUP_ROOT}/${REPO_NAME}__DISASTER_WEEKLY__*" "$KEEP_WEEKLY"

log "Done."

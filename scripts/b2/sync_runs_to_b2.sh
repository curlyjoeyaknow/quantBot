#!/usr/bin/env bash
set -euo pipefail

# QuantBot — B2 Runs Sync (Parquet-first)
#
# Syncs completed run folders under $RUNS_DIR to Backblaze B2 using `b2 sync`.
# Recommended: runner creates <run_dir>/COMPLETED when the run succeeds.

RUNS_DIR="${RUNS_DIR:-runs}"

B2_BUCKET="${B2_BUCKET:-}"
B2_PREFIX="${B2_PREFIX:-quantbot-runs}"

DRY_RUN="${DRY_RUN:-0}"          # 1 = print actions only
VERBOSE="${VERBOSE:-0}"          # 1 = extra logs
SYNC_DELETE="${SYNC_DELETE:-0}"  # 1 = delete remote files not present locally (dangerous if you prune locally)
MAX_RUNS="${MAX_RUNS:-0}"        # 0 = no limit
ONLY_DATE="${ONLY_DATE:-}"       # e.g. 2026-01-06
ONLY_RUN_ID="${ONLY_RUN_ID:-}"   # basename match e.g. run_01J...

EXCLUDE_REGEX="${EXCLUDE_REGEX:-\\.tmp$|\\.partial$|/\\.DS_Store$|/\\.Trash/|/node_modules/|/dist/}"

log()  { echo "[b2-sync] $*"; }
vlog() { if [[ "$VERBOSE" == "1" ]]; then echo "[b2-sync][verbose] $*"; fi }
die()  { echo "[b2-sync][fatal] $*" >&2; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"; }
has_cmd()  { command -v "$1" >/dev/null 2>&1; }

usage() {
  cat <<USAGE
Usage:
  RUNS_DIR=runs B2_BUCKET=your-bucket-name bash ./scripts/b2/sync_runs_to_b2.sh

Env vars:
  RUNS_DIR        Local runs directory (default: runs)
  B2_BUCKET       Backblaze bucket name (required)
  B2_PREFIX       Remote prefix inside bucket (default: quantbot-runs)
  DRY_RUN         1 to print actions without uploading (default: 0)
  VERBOSE         1 for extra logs (default: 0)
  SYNC_DELETE     1 to delete remote files not present locally (default: 0)
  MAX_RUNS        Max number of completed runs to sync (default: 0 = all)
  ONLY_DATE       Only sync runs under runs/YYYY-MM-DD/ (default: empty)
  ONLY_RUN_ID     Only sync a single run folder name (basename match) (default: empty)
  EXCLUDE_REGEX   Regex for files to exclude (default excludes tmp/partial/etc.)

Completion detection:
  - <run_dir>/COMPLETED marker (recommended)
  - meta.json with {"status":"succeeded"} if jq is installed

Examples:
  DRY_RUN=1 B2_BUCKET=quantbot-artifacts bash ./scripts/b2/sync_runs_to_b2.sh
  ONLY_DATE=2026-01-06 B2_BUCKET=quantbot-artifacts bash ./scripts/b2/sync_runs_to_b2.sh
USAGE
}

is_completed_run_dir() {
  local run_dir="$1"

  if [[ -f "$run_dir/COMPLETED" ]]; then
    return 0
  fi

  if [[ -f "$run_dir/meta.json" ]] && has_cmd jq; then
    local status
    status="$(jq -r '.status // empty' "$run_dir/meta.json" 2>/dev/null || true)"
    [[ "$status" == "succeeded" ]] && return 0
  fi

  return 1
}

remote_url_for_run_dir() {
  local run_dir="$1"
  local rel
  rel="$(python3 - <<PY
import os, sys
runs_dir = os.path.abspath(sys.argv[1])
run_dir  = os.path.abspath(sys.argv[2])
print(os.path.relpath(run_dir, runs_dir))
PY
"$RUNS_DIR" "$run_dir")"
  echo "b2://${B2_BUCKET}/${B2_PREFIX}/${rel}"
}

sync_one_run() {
  local run_dir="$1"
  local remote
  remote="$(remote_url_for_run_dir "$run_dir")"

  vlog "local:  $run_dir"
  vlog "remote: $remote"
  vlog "exclude: $EXCLUDE_REGEX"

  if [[ "$DRY_RUN" == "1" ]]; then
    log "DRY_RUN: would sync '$run_dir' -> '$remote'"
    return 0
  fi

  local delete_arg=""
  if [[ "$SYNC_DELETE" == "1" ]]; then
    delete_arg="--delete"
  fi

  # Idempotent. compareVersions=size is fast and good enough for artifacts.
  b2 sync \
    $delete_arg \
    --compareVersions size \
    --excludeRegex "$EXCLUDE_REGEX" \
    --noProgress \
    "$run_dir" \
    "$remote"
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

need_cmd b2
need_cmd python3

[[ -d "$RUNS_DIR" ]] || die "RUNS_DIR does not exist: $RUNS_DIR"
[[ -n "$B2_BUCKET" ]] || die "B2_BUCKET is required."

# Discover candidate run dirs
candidates=()

if [[ -n "$ONLY_DATE" ]]; then
  [[ -d "$RUNS_DIR/$ONLY_DATE" ]] || die "ONLY_DATE dir not found: $RUNS_DIR/$ONLY_DATE"
  while IFS= read -r -d '' d; do candidates+=("$d"); done < <(find "$RUNS_DIR/$ONLY_DATE" -mindepth 1 -maxdepth 1 -type d -print0)
else
  while IFS= read -r -d '' d; do candidates+=("$d"); done < <(find "$RUNS_DIR" -mindepth 2 -maxdepth 2 -type d -print0)
fi

# Filter ONLY_RUN_ID
if [[ -n "$ONLY_RUN_ID" ]]; then
  filtered=()
  for d in "${candidates[@]}"; do
    [[ "$(basename "$d")" == "$ONLY_RUN_ID" ]] && filtered+=("$d")
  done
  candidates=("${filtered[@]}")
fi

# Sort for stable behavior
IFS=$'\n' candidates=($(printf "%s\n" "${candidates[@]}" | sort))
unset IFS

completed=()
for d in "${candidates[@]}"; do
  if is_completed_run_dir "$d"; then
    completed+=("$d")
  else
    vlog "Skipping incomplete: $d"
  fi
done

if [[ "${#completed[@]}" -eq 0 ]]; then
  log "No completed runs found under '$RUNS_DIR'."
  log "Tip: create a COMPLETED marker file in each run dir when it finishes successfully."
  exit 0
fi

if [[ "$MAX_RUNS" != "0" ]]; then
  [[ "$MAX_RUNS" =~ ^[0-9]+$ ]] || die "MAX_RUNS must be an integer (got: $MAX_RUNS)"
  if (( ${#completed[@]} > MAX_RUNS )); then
    completed=("${completed[@]: -$MAX_RUNS}")
  fi
fi

log "Found ${#completed[@]} completed run(s) to sync."
for d in "${completed[@]}"; do
  log "Syncing: $d"
  sync_one_run "$d"
done

log "Done."

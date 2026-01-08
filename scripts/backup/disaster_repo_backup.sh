#!/usr/bin/env bash
set -euo pipefail

# QuantBot — Repo-wide Disaster Snapshot
#
# Repo-wide snapshot excluding:
# - backups/
# - slices/results/logs/data/configs (covered by focused backups)
# - build artifacts/caches/deps (dist, node_modules, etc.)
#
# Output:
#   backups/<repo>__DISASTER_<FLAVOR>__YYYYmmdd_HHMMSS/
#     manifest.txt
#     excluded_patterns.txt
#     included_paths.txt
#     snapshot.repo.tar.{zst|gz|tar}
#     snapshot.repo.tar.{...}.sha256
#
# Env:
#   BACKUP_FLAVOR=daily|weekly|manual   (default: manual)
#   COMPRESS=zstd|gz|none              (default: zstd)
#   B2_BUCKET=...                      (optional)
#   B2_PREFIX=...                      (optional, default: quantbot-disaster)
#   DRY_RUN=0|1                        (default: 0)

BACKUP_ROOT="${BACKUP_ROOT:-backups}"
BACKUP_NAME="${BACKUP_NAME:-$(basename "$(pwd)")}"
BACKUP_FLAVOR="${BACKUP_FLAVOR:-manual}"
COMPRESS="${COMPRESS:-zstd}"

B2_BUCKET="${B2_BUCKET:-}"
B2_PREFIX="${B2_PREFIX:-quantbot-disaster}"
DRY_RUN="${DRY_RUN:-0}"

TS="$(date +%Y%m%d_%H%M%S)"
OUT_DIR="${BACKUP_ROOT}/${BACKUP_NAME}__DISASTER_${BACKUP_FLAVOR^^}__${TS}"
TAR_BASE="${OUT_DIR}/snapshot.repo.tar"
ARCHIVE_PATH=""
SHA_PATH=""

log() { echo "[disaster-backup] $*"; }
die() { echo "[disaster-backup][fatal] $*" >&2; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"; }
has_cmd()  { command -v "$1" >/dev/null 2>&1; }

need_cmd tar
need_cmd sha256sum
need_cmd date
need_cmd stat

mkdir -p "$OUT_DIR"
[[ -w "$OUT_DIR" ]] || die "Output dir not writable: $OUT_DIR (fix ownership/permissions on $BACKUP_ROOT)"

EXCLUDES=(
  "--exclude=./backups"
  "--exclude=./slices"
  "--exclude=./results"
  "--exclude=./logs"
  "--exclude=./data"
  "--exclude=./configs"

  "--exclude=**/node_modules"
  "--exclude=**/dist"
  "--exclude=**/build"
  "--exclude=**/.turbo"
  "--exclude=**/.cache"
  "--exclude=**/.next"
  "--exclude=**/.vite"
  "--exclude=**/.parcel-cache"
  "--exclude=**/.pytest_cache"
  "--exclude=**/__pycache__"
  "--exclude=**/*.pyc"

  "--exclude=**/.DS_Store"
  "--exclude=**/.Trash"

  "--exclude=**/*.tmp"
  "--exclude=**/*.partial"
  "--exclude=**/*.log"
)

printf "%s\n" "${EXCLUDES[@]}" > "${OUT_DIR}/excluded_patterns.txt"
echo "." > "${OUT_DIR}/included_paths.txt"

{
  echo "backup_name: ${BACKUP_NAME}"
  echo "backup_type: DISASTER_REPO"
  echo "backup_flavor: ${BACKUP_FLAVOR}"
  echo "created_at:  $(date -Iseconds)"
  echo "cwd:         $(pwd)"
  echo "compress:    ${COMPRESS}"
  echo "included:    ."
  echo "excluded_patterns_file: excluded_patterns.txt"
} > "${OUT_DIR}/manifest.txt"

log "Creating DISASTER (${BACKUP_FLAVOR}) repo snapshot in: $OUT_DIR"

case "$COMPRESS" in
  zstd)
    need_cmd zstd
    ARCHIVE_PATH="${TAR_BASE}.zst"
    log "Writing: $ARCHIVE_PATH"
    tar -cf - "${EXCLUDES[@]}" . | zstd -T0 -q -o "$ARCHIVE_PATH"
    ;;
  gz)
    ARCHIVE_PATH="${TAR_BASE}.gz"
    log "Writing: $ARCHIVE_PATH"
    tar -czf "$ARCHIVE_PATH" "${EXCLUDES[@]}" .
    ;;
  none)
    ARCHIVE_PATH="$TAR_BASE"
    log "Writing: $ARCHIVE_PATH"
    tar -cf "$ARCHIVE_PATH" "${EXCLUDES[@]}" .
    ;;
  *)
    die "Unknown COMPRESS value: $COMPRESS (use zstd|gz|none)"
    ;;
esac

[[ -f "$ARCHIVE_PATH" ]] || die "Archive was not created: $ARCHIVE_PATH"
[[ -r "$ARCHIVE_PATH" ]] || die "Archive not readable (permissions): $ARCHIVE_PATH"

SHA_PATH="${ARCHIVE_PATH}.sha256"
log "Hashing: $SHA_PATH"
( cd "$OUT_DIR" && sha256sum "$(basename "$ARCHIVE_PATH")" > "$(basename "$SHA_PATH")" )

BYTES="$(stat -c%s "$ARCHIVE_PATH")"
log "Archive size: ${BYTES} bytes"

b2_sync_portable() {
  local src="$1"
  local dst="$2"

  if b2 sync --help 2>&1 | grep -q -- '--compare-versions'; then
    b2 sync --compare-versions size --no-progress "$src" "$dst"
    return 0
  fi
  if b2 sync --help 2>&1 | grep -q -- '--compareVersions'; then
    b2 sync --compareVersions size --noProgress "$src" "$dst"
    return 0
  fi

  b2 sync "$src" "$dst"
}

if [[ -n "$B2_BUCKET" ]]; then
  if has_cmd b2; then
    REMOTE="b2://${B2_BUCKET}/${B2_PREFIX}/${BACKUP_NAME}/${BACKUP_FLAVOR}/${TS}/"
    log "B2 upload enabled -> $REMOTE"
    if [[ "$DRY_RUN" == "1" ]]; then
      log "DRY_RUN=1: would upload OUT_DIR to B2"
    else
      b2_sync_portable "$OUT_DIR" "$REMOTE"
      log "Uploaded to B2: $REMOTE"
    fi
  else
    log "B2_BUCKET set but 'b2' CLI not found; skipping upload."
  fi
else
  log "B2 upload not configured (B2_BUCKET empty). Local snapshot created only."
fi

log "Done."
log "Backup folder: $OUT_DIR"
log "Archive:       $ARCHIVE_PATH"
log "Checksum:      $SHA_PATH"

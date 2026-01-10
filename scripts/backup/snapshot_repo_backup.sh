#!/usr/bin/env bash
set -euo pipefail

BACKUP_ROOT="${BACKUP_ROOT:-backups}"
BACKUP_NAME="${BACKUP_NAME:-$(basename "$(pwd)")}"
COMPRESS="${COMPRESS:-gz}"     # gz | zstd | none

B2_BUCKET="${B2_BUCKET:-}"
B2_PREFIX="${B2_PREFIX:-quantbot-backups}"
DRY_RUN="${DRY_RUN:-0}"

TS="$(date +%Y%m%d_%H%M%S)"
OUT_DIR="${BACKUP_ROOT}/${BACKUP_NAME}__snapshot__${TS}"
TAR_BASE="${OUT_DIR}/snapshot.tar"
ARCHIVE_PATH=""
SHA_PATH=""

log() { echo "[backup] $*"; }
die() { echo "[backup][fatal] $*" >&2; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"; }
has_cmd()  { command -v "$1" >/dev/null 2>&1; }

need_cmd tar
need_cmd sha256sum
need_cmd date
need_cmd stat

mkdir -p "$OUT_DIR"
[[ -w "$OUT_DIR" ]] || die "Output dir not writable: $OUT_DIR (fix ownership/permissions on $BACKUP_ROOT)"

INCLUDE_DIRS=(slices results logs data configs)
INCLUDE_FILES=(package.json pnpm-lock.yaml turbo.json tsconfig.json)

INCLUDED=()

for d in "${INCLUDE_DIRS[@]}"; do
  if [[ -d "$d" ]]; then
    INCLUDED+=("$d")
  else
    log "Skipping missing dir: $d"
  fi
done

for f in "${INCLUDE_FILES[@]}"; do
  if [[ -f "$f" ]]; then
    INCLUDED+=("$f")
  else
    log "Skipping missing file: $f"
  fi
done

shopt -s nullglob
ENV_FILES=(.env .env.*)
shopt -u nullglob
for f in "${ENV_FILES[@]}"; do
  [[ -f "$f" ]] && INCLUDED+=("$f")
done

if [[ "${#INCLUDED[@]}" -eq 0 ]]; then
  die "Nothing to back up: none of the target dirs/files exist at repo root."
fi

printf "%s\n" "${INCLUDED[@]}" | sort > "${OUT_DIR}/included_paths.txt"

{
  echo "backup_name: ${BACKUP_NAME}"
  echo "created_at:  $(date -Iseconds)"
  echo "cwd:         $(pwd)"
  echo "compress:    ${COMPRESS}"
  echo "included:"
  sed 's/^/  - /' "${OUT_DIR}/included_paths.txt"
} > "${OUT_DIR}/manifest.txt"

log "Creating snapshot in: $OUT_DIR"

EXCLUDES=(
  "--exclude=**/node_modules"
  "--exclude=**/.turbo"
  "--exclude=**/dist"
  "--exclude=**/.cache"
  "--exclude=**/.DS_Store"
  "--exclude=**/*.tmp"
  "--exclude=**/*.partial"
)

case "$COMPRESS" in
  gz)
    ARCHIVE_PATH="${TAR_BASE}.gz"
    log "Writing: $ARCHIVE_PATH"
    tar -czf "$ARCHIVE_PATH" "${EXCLUDES[@]}" "${INCLUDED[@]}"
    ;;
  zstd)
    need_cmd zstd
    ARCHIVE_PATH="${TAR_BASE}.zst"
    log "Writing: $ARCHIVE_PATH"
    tar -cf - "${EXCLUDES[@]}" "${INCLUDED[@]}" | zstd -T0 -q -o "$ARCHIVE_PATH"
    ;;
  none)
    ARCHIVE_PATH="$TAR_BASE"
    log "Writing: $ARCHIVE_PATH"
    tar -cf "$ARCHIVE_PATH" "${EXCLUDES[@]}" "${INCLUDED[@]}"
    ;;
  *)
    die "Unknown COMPRESS value: $COMPRESS (use gz|zstd|none)"
    ;;
esac

[[ -f "$ARCHIVE_PATH" ]] || die "Archive was not created: $ARCHIVE_PATH"
[[ -r "$ARCHIVE_PATH" ]] || die "Archive not readable (permissions): $ARCHIVE_PATH"

SHA_PATH="${ARCHIVE_PATH}.sha256"
log "Hashing: $SHA_PATH"
sha256sum "$ARCHIVE_PATH" > "$SHA_PATH"

BYTES="$(stat -c%s "$ARCHIVE_PATH")"
log "Archive size: ${BYTES} bytes"

b2_sync_portable() {
  local src="$1"
  local dst="$2"

  # Newer b2 CLI uses kebab-case flags
  if b2 sync --help 2>&1 | grep -q -- '--compare-versions'; then
    b2 sync --compare-versions size --no-progress "$src" "$dst"
    return 0
  fi

  # Older b2 CLI used camelCase flags
  if b2 sync --help 2>&1 | grep -q -- '--compareVersions'; then
    b2 sync --compareVersions size --noProgress "$src" "$dst"
    return 0
  fi

  # Fallback: no fancy flags
  b2 sync "$src" "$dst"
}

if [[ -n "$B2_BUCKET" ]]; then
  if has_cmd b2; then
    REMOTE="b2://${B2_BUCKET}/${B2_PREFIX}/${BACKUP_NAME}/${TS}/"
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

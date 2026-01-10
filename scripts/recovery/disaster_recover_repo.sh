#!/usr/bin/env bash
set -euo pipefail

TARGET_DIR="${TARGET_DIR:-RECOVERED_REPO}"
FORCE="${FORCE:-0}"

log() { echo "[recover] $*"; }
die() { echo "[recover][fatal] $*" >&2; exit 1; }
need_cmd() { command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"; }
has_cmd()  { command -v "$1" >/dev/null 2>&1; }

usage() {
  cat <<USAGE
Usage:
  ./scripts/recovery/disaster_recover_repo.sh --from <snapshot_folder> [--to <target_dir>] [--force]

Options:
  --from <snapshot_folder>   Path to backups/<repo>__DISASTER__... folder
  --to <target_dir>          Directory to extract into (default: RECOVERED_REPO)
  --force                    Allow extracting into an existing directory (dangerous)

Optional B2 pull:
  --b2-remote <b2://.../>    Remote snapshot folder (downloads then restores). Requires 'b2' CLI authorized.

Env:
  TARGET_DIR=...
  FORCE=0|1
USAGE
}

FROM_DIR=""
B2_REMOTE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --from) FROM_DIR="${2:-}"; shift 2;;
    --to) TARGET_DIR="${2:-}"; shift 2;;
    --force) FORCE="1"; shift 1;;
    --b2-remote) B2_REMOTE="${2:-}"; shift 2;;
    -h|--help) usage; exit 0;;
    *) die "Unknown arg: $1 (use --help)";;
  esac
done

need_cmd tar
need_cmd sha256sum

tmp_dl=""
cleanup() { [[ -n "${tmp_dl:-}" && -d "${tmp_dl:-}" ]] && rm -rf "$tmp_dl"; }
trap cleanup EXIT

if [[ -n "$B2_REMOTE" ]]; then
  has_cmd b2 || die "b2 CLI not found, cannot download from B2"
  tmp_dl="$(mktemp -d)"
  log "Downloading snapshot folder from B2 -> $tmp_dl"
  if b2 sync --help 2>&1 | grep -q -- '--no-progress'; then
    b2 sync --compare-versions size --no-progress "$B2_REMOTE" "$tmp_dl"
  else
    b2 sync "$B2_REMOTE" "$tmp_dl"
  fi
  FROM_DIR="$tmp_dl"
fi

[[ -n "$FROM_DIR" ]] || die "You must provide --from <snapshot_folder> or --b2-remote <b2://.../>"
[[ -d "$FROM_DIR" ]] || die "Snapshot folder not found: $FROM_DIR"

ARCHIVE="$(ls -1 "$FROM_DIR"/snapshot.repo.tar.* 2>/dev/null | head -n 1 || true)"
SHA_FILE="$(ls -1 "$FROM_DIR"/snapshot.repo.tar.*.sha256 2>/dev/null | head -n 1 || true)"

[[ -n "$ARCHIVE" ]] || die "Could not find snapshot.repo.tar.* in: $FROM_DIR"
[[ -n "$SHA_FILE" ]] || die "Could not find sha256 file in: $FROM_DIR"

ARCHIVE_BASENAME="$(basename "$ARCHIVE")"
SHA_BASENAME="$(basename "$SHA_FILE")"

log "Verifying checksum..."

# Try normal verification first (expects sha file refers to basename)
set +e
( cd "$FROM_DIR" && sha256sum -c "$SHA_BASENAME" ) >/dev/null 2>&1
ok=$?
set -e

if [[ "$ok" -ne 0 ]]; then
  # If sha file contains a path (e.g. backups/.../archive), rewrite to basename and verify.
  tmp_sha="$(mktemp)"
  # sha256sum format: "<hash><space><space><filename>"
  # Keep hash, replace filename with actual archive basename.
  awk -v f="$ARCHIVE_BASENAME" 'NF>=2 { $NF=f; print }' "$SHA_FILE" > "$tmp_sha"
  ( cd "$FROM_DIR" && sha256sum -c "$tmp_sha" )
  rm -f "$tmp_sha"
else
  ( cd "$FROM_DIR" && sha256sum -c "$SHA_BASENAME" )
fi

if [[ -e "$TARGET_DIR" && "$FORCE" != "1" ]]; then
  die "Target dir exists: $TARGET_DIR (re-run with --force to extract anyway)"
fi

mkdir -p "$TARGET_DIR"

log "Extracting archive into: $TARGET_DIR"
case "$ARCHIVE" in
  *.zst)
    need_cmd zstd
    tar --use-compress-program=unzstd -xf "$ARCHIVE" -C "$TARGET_DIR"
    ;;
  *.gz)
    tar -xzf "$ARCHIVE" -C "$TARGET_DIR"
    ;;
  *.tar)
    tar -xf "$ARCHIVE" -C "$TARGET_DIR"
    ;;
  *)
    die "Unknown archive extension: $ARCHIVE"
    ;;
esac

log "Restore complete."
log "Next steps:"
log "  cd \"$TARGET_DIR\""
log "  pnpm install   # deps intentionally excluded"

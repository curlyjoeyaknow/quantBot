#!/usr/bin/env bash
set -euo pipefail

# Installs user-level cron entries for:
# - Daily disaster repo backup
# - Weekly disaster repo backup
# - Daily prune/retention (runs after daily backup)
#
# Defaults:
# - Daily backup: 03:11 every day
# - Weekly backup: 04:22 Sundays
# - Prune: 03:45 every day (after daily backup)

REPO_ROOT="${REPO_ROOT:-$(pwd)}"

DISASTER_SCRIPT="$REPO_ROOT/scripts/backup/disaster_repo_backup.sh"
PRUNE_SCRIPT="$REPO_ROOT/scripts/backup/prune_backups.sh"

B2_BUCKET="${B2_BUCKET:-}"                       # optional
B2_PREFIX="${B2_PREFIX:-quantbot-disaster}"      # optional
COMPRESS="${COMPRESS:-zstd}"

DAILY_SCHEDULE="${DAILY_SCHEDULE:-11 3 * * *}"
WEEKLY_SCHEDULE="${WEEKLY_SCHEDULE:-22 4 * * 0}"     # Sunday
PRUNE_SCHEDULE="${PRUNE_SCHEDULE:-45 3 * * *}"       # daily after backup

LOG_DIR="${LOG_DIR:-$REPO_ROOT/backups}"

DAILY_LOG="${DAILY_LOG:-$LOG_DIR/cron_disaster_backup_daily.log}"
WEEKLY_LOG="${WEEKLY_LOG:-$LOG_DIR/cron_disaster_backup_weekly.log}"
PRUNE_LOG="${PRUNE_LOG:-$LOG_DIR/cron_disaster_backup_prune.log}"

TAG_DAILY="# quantbot-disaster-backup-daily"
TAG_WEEKLY="# quantbot-disaster-backup-weekly"
TAG_PRUNE="# quantbot-disaster-backup-prune"

log() { echo "[cron] $*"; }
die() { echo "[cron][fatal] $*" >&2; exit 1; }

[[ -x "$DISASTER_SCRIPT" ]] || die "Backup script not found/executable: $DISASTER_SCRIPT"
[[ -x "$PRUNE_SCRIPT" ]] || die "Prune script not found/executable: $PRUNE_SCRIPT"

mkdir -p "$LOG_DIR"

# Optional B2 env injection for cron
B2_ENV=""
if [[ -n "$B2_BUCKET" ]]; then
  B2_ENV="B2_BUCKET=\"$B2_BUCKET\" B2_PREFIX=\"$B2_PREFIX\""
fi

# Cron lines (bash explicitly + cd to repo)
DAILY_LINE="${DAILY_SCHEDULE} cd \"$REPO_ROOT\" && ${B2_ENV} BACKUP_FLAVOR=daily COMPRESS=${COMPRESS} ./scripts/backup/disaster_repo_backup.sh >> \"$DAILY_LOG\" 2>&1 ${TAG_DAILY}"
WEEKLY_LINE="${WEEKLY_SCHEDULE} cd \"$REPO_ROOT\" && ${B2_ENV} BACKUP_FLAVOR=weekly COMPRESS=${COMPRESS} ./scripts/backup/disaster_repo_backup.sh >> \"$WEEKLY_LOG\" 2>&1 ${TAG_WEEKLY}"

# Prune keeps last N (override via env at install time if desired)
# Defaults are in prune_backups.sh, but you can set KEEP_DAILY / KEEP_WEEKLY here.
KEEP_DAILY="${KEEP_DAILY:-14}"
KEEP_WEEKLY="${KEEP_WEEKLY:-12}"
PRUNE_LINE="${PRUNE_SCHEDULE} cd \"$REPO_ROOT\" && KEEP_DAILY=${KEEP_DAILY} KEEP_WEEKLY=${KEEP_WEEKLY} ./scripts/backup/prune_backups.sh >> \"$PRUNE_LOG\" 2>&1 ${TAG_PRUNE}"

TMP="$(mktemp)"
( crontab -l 2>/dev/null || true ) > "$TMP"

# Remove existing tagged lines
grep -vF "$TAG_DAILY" "$TMP" | grep -vF "$TAG_WEEKLY" | grep -vF "$TAG_PRUNE" > "${TMP}.new" || true
mv "${TMP}.new" "$TMP"

# Append new lines
echo "$DAILY_LINE" >> "$TMP"
echo "$WEEKLY_LINE" >> "$TMP"
echo "$PRUNE_LINE" >> "$TMP"

crontab "$TMP"
rm -f "$TMP"

log "Installed/updated cron jobs:"
log "  Daily : $DAILY_LINE"
log "  Weekly: $WEEKLY_LINE"
log "  Prune : $PRUNE_LINE"
log "Logs:"
log "  $DAILY_LOG"
log "  $WEEKLY_LOG"
log "  $PRUNE_LOG"
log "View:"
log "  crontab -l | grep -F 'quantbot-disaster-backup'"

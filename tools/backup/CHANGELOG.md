# B2 Backup Scripts - Changelog

## v2.0 - Enhanced Logging (2026-01-27)

### ✨ New Features

- **Colored Log Output**: Beautiful, easy-to-read logs with ANSI colors
  - 🔵 Blue for info (sync started)
  - 🟢 Green for success (sync completed)
  - 🔴 Red for errors
  - 🟡 Yellow for warnings
  - 🔷 Cyan for statistics

- **Run Counter**: Each backup run is numbered (Run 1, Run 2, etc.)
  - Helps track backup history
  - Easy to correlate issues with specific runs
  - Stored in `.run_counter` file

- **Minimal Output**: Only shows what matters
  - No verbose B2 progress output
  - Clean summary of uploaded/deleted/compared files
  - "no changes" indicator when nothing to sync

- **Better Statistics**: Clear metrics after each sync
  - Number of files uploaded
  - Number of files deleted
  - Number of files compared
  - Total files in bucket

### 📝 Log Format

**Before**:
```
[2026-01-27 08:34:21] =========================================
[2026-01-27 08:34:21] B2 Backup Script Started
[2026-01-27 08:34:21] =========================================
[2026-01-27 08:34:21] Starting B2 sync: /home/memez/opn/ -> b2://memez-quant/opn/
... (verbose b2 output) ...
[2026-01-27 08:34:45] Sync completed successfully
[2026-01-27 08:34:46] Fetching sync statistics...
[2026-01-27 08:34:46] Total files in bucket: 9619
[2026-01-27 08:34:46] Backup completed successfully
```

**After**:
```
08:34:21 - Began sync [b2 sync] - Run 31
08:34:45 - ✓ Sync completed - Run 31
08:34:45 - → Uploaded: 42 files
08:34:45 - → Deleted: 3 files
08:34:45 - → Compared: 1523 files
08:34:46 - → Total files in bucket: 9619
```

### 🛠️ Technical Changes

- Added `--no-progress` flag to B2 sync command
- Parse B2 output to extract statistics
- Implemented colored logging function with multiple levels
- Added run counter persistence
- Improved error reporting with context

### 📚 Documentation

- Added `LOG_FORMAT.md` - Complete guide to log format
- Added `demo-logs.sh` - Interactive demo of log output
- Updated `README.md` with log monitoring examples
- Updated `SETUP_COMPLETE.md` with new features

## v1.0 - Initial Release (2026-01-27)

### Features

- Automated B2 sync every 6 hours
- Systemd service and timer
- Exclusion of build artifacts and node_modules
- 30-day file version retention
- Full path to B2 CLI (no virtual environment needed)
- Security hardened systemd service
- Comprehensive logging

### Files

- `b2-sync-opn.sh` - Main backup script
- `b2-sync-opn.service` - Systemd service
- `b2-sync-opn.timer` - Systemd timer
- `setup-b2-sync.sh` - Installation script
- `README.md` - Documentation

# B2 Backup Features

## Core Functionality

### Automated Backups
- **Schedule**: Every 6 hours (00:00, 06:00, 12:00, 18:00)
- **Source**: `/home/memez/opn/`
- **Destination**: `b2://memez-quant/opn/`
- **Method**: Incremental sync (only changed files)

### Smart Exclusions
Automatically excludes common build artifacts and dependencies:
- `node_modules/`, `.pnpm-store/`, `.npm/`, `.yarn/`
- `dist/`, `build/`, `.next/`, `.turbo/`
- `coverage/`, `.cache/`, `.temp/`, `.tmp/`
- `.git/`, `target/`, `__pycache__/`
- `*.log`, `.DS_Store`, `Thumbs.db`
- `.venv/`, `venv/`
- `.env.local`, `.env.*.local`

### File Retention
- Keeps 30 days of file versions in B2
- Allows recovery of accidentally deleted or modified files
- Automatic cleanup of old versions

## Logging & Monitoring

### Clean, Colored Output
```
08:34:21 - Began sync [b2 sync] - Run 31
08:34:45 - ✓ Sync completed - Run 31
08:34:45 - → Uploaded: 42 files
08:34:45 - → Deleted: 3 files
08:34:45 - → Compared: 1523 files
08:34:46 - → Total files in bucket: 9619
```

### Color Coding
- 🔵 **Blue**: Info (sync started)
- 🟢 **Green**: Success (sync completed)
- 🔴 **Red**: Errors (sync failed)
- 🟡 **Yellow**: Warnings
- 🔷 **Cyan**: Statistics (→)

### Run Counter
- Each backup run is numbered sequentially
- Easy to track backup history
- Helps correlate issues with specific runs
- Example: "Run 31", "Run 32", etc.

### Minimal Output
- No verbose progress bars
- Only shows meaningful changes
- "no changes" indicator when appropriate
- Clean, scannable format

### Dual Logging
1. **Systemd Journal**
   - Persistent across reboots
   - Integrated with system logs
   - Best for real-time monitoring: `journalctl -u b2-sync-opn.service -f`

2. **Local Log Files**
   - One file per day: `logs/b2-sync-opn-YYYYMMDD.log`
   - Easy to archive or analyze
   - Plain text with ANSI colors

## Reliability

### Systemd Integration
- Automatic start on boot
- Persistent timers (runs missed schedules)
- Service restart on failure
- System journal integration

### Error Handling
- Clear error messages with context
- Exit codes for monitoring
- Failed sync detection
- Connection timeout handling

### Authorization
- Uses existing B2 credentials
- No password storage in scripts
- Credentials in `~/.config/b2/account_info`

## Security

### Systemd Hardening
- Runs as user `memez` (not root)
- `PrivateTmp=yes` (isolated /tmp)
- `NoNewPrivileges=yes` (no privilege escalation)

### Credential Security
- B2 credentials stored in user home directory
- File permissions: user-only readable
- No credentials in scripts or logs

### Network Security
- HTTPS-only connection to B2
- No plaintext credential transmission
- B2 server-side encryption available

## Operational

### No Virtual Environment Required
- Uses full path to B2 CLI: `/home/memez/.local/bin/b2`
- Works correctly in systemd context
- No PATH manipulation needed
- No activation scripts

### Easy Monitoring
```bash
# Real-time logs
journalctl -u b2-sync-opn.service -f

# Run backup now
sudo systemctl start b2-sync-opn.service

# Check timer status
systemctl status b2-sync-opn.timer

# View next scheduled runs
systemctl list-timers b2-sync-opn.timer
```

### Easy Management
```bash
# Stop automatic backups
sudo systemctl stop b2-sync-opn.timer

# Disable automatic backups
sudo systemctl disable b2-sync-opn.timer

# Re-enable automatic backups
sudo systemctl enable b2-sync-opn.timer
sudo systemctl start b2-sync-opn.timer
```

## Performance

### Incremental Sync
- Only uploads changed files
- Compares file sizes before upload
- Skips identical files
- Efficient bandwidth usage

### Parallel Operations
- Multiple file uploads in parallel
- Configurable thread count
- Optimized for throughput

### First Sync
- Initial sync may take time (full upload)
- Subsequent syncs are much faster (incremental)
- Progress tracked in logs

## Recovery

### File Versions
- 30 days of file history
- Recover deleted files
- Restore previous versions
- Access via B2 web UI or CLI

### Backup Verification
```bash
# List files in bucket
~/.local/bin/b2 ls --recursive b2://memez-quant/opn/

# Download specific file
~/.local/bin/b2 download-file-by-name memez-quant opn/path/to/file.txt local-file.txt

# List file versions
~/.local/bin/b2 ls --versions b2://memez-quant/opn/path/to/file.txt
```

## Documentation

- **README.md**: Complete setup and usage guide
- **LOG_FORMAT.md**: Detailed log format documentation
- **FEATURES.md**: This file - feature overview
- **CHANGELOG.md**: Version history and changes
- **SETUP_COMPLETE.md**: Post-installation summary
- **demo-logs.sh**: Interactive log format demo

## Demo

Run the demo to see the log format in action:

```bash
./demo-logs.sh
```

This shows examples of:
- Successful sync with changes
- Sync with no changes
- Failed sync with errors
- Warning messages
- All color coding and symbols

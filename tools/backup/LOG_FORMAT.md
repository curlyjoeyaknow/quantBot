# B2 Backup Log Format Guide

## Overview

The backup script outputs clean, colored logs designed for easy monitoring with `tail` or `journalctl -f`.

## Log Levels

### 🔵 INFO (Blue)
Informational messages about sync operations starting.

```
08:34:21 - Began sync [b2 sync] - Run 31
```

### 🟢 SUCCESS (Green with ✓)
Successful completion of operations.

```
08:34:45 - ✓ Sync completed - Run 31
08:35:12 - ✓ Sync completed - Run 32 (no changes)
```

### 🔷 STAT (Cyan with →)
Statistics and metrics about the sync operation.

```
08:34:45 - → Uploaded: 42 files
08:34:45 - → Deleted: 3 files
08:34:45 - → Compared: 1523 files
08:34:46 - → Total files in bucket: 9619
```

### 🔴 ERROR (Red with ✗)
Errors and failures.

```
08:40:12 - ✗ Sync failed - Run 33 (exit code: 1)
08:40:12 - ✗ Connection timeout to B2 server
```

### 🟡 WARN (Yellow with ⚠)
Warnings (non-critical issues).

```
08:45:30 - ⚠ Slow connection detected (< 10 KB/s)
```

## Complete Example Outputs

### Successful Sync with Changes

```
08:34:21 - Began sync [b2 sync] - Run 31
08:34:45 - ✓ Sync completed - Run 31
08:34:45 - → Uploaded: 42 files
08:34:45 - → Deleted: 3 files
08:34:45 - → Compared: 1523 files
08:34:46 - → Total files in bucket: 9619
```

### Successful Sync with No Changes

```
14:00:03 - Began sync [b2 sync] - Run 32
14:00:15 - ✓ Sync completed - Run 32 (no changes)
14:00:15 - → Total files in bucket: 9619
```

### Failed Sync

```
20:00:02 - Began sync [b2 sync] - Run 33
20:00:45 - ✗ Sync failed - Run 33 (exit code: 1)
20:00:45 - ✗ ERROR: Connection timeout
```

## Monitoring Commands

### Real-time Monitoring (Recommended)

```bash
# Follow systemd journal (colored output)
journalctl -u b2-sync-opn.service -f

# Follow local log file
tail -f logs/b2-sync-opn-$(date +%Y%m%d).log
```

### Historical Logs

```bash
# Last 50 lines
journalctl -u b2-sync-opn.service -n 50

# Logs since 1 hour ago
journalctl -u b2-sync-opn.service --since "1 hour ago"

# Logs for today
journalctl -u b2-sync-opn.service --since today

# All logs for a specific run
journalctl -u b2-sync-opn.service | grep "Run 31"
```

### Filtering Logs

```bash
# Only show errors
journalctl -u b2-sync-opn.service | grep "✗"

# Only show successful syncs
journalctl -u b2-sync-opn.service | grep "✓"

# Show upload statistics
journalctl -u b2-sync-opn.service | grep "Uploaded:"

# Show run numbers
journalctl -u b2-sync-opn.service | grep "Run"
```

## Run Counter

Each backup run is numbered sequentially (Run 1, Run 2, Run 3, etc.). This helps you:

- Track how many times the backup has run
- Identify specific backup runs in logs
- Correlate issues with specific runs

The run counter is stored in `.run_counter` and increments after each successful sync.

## Demo

Run the demo script to see example output:

```bash
./demo-logs.sh
```

This shows all log levels and formats in action.

## Log Files

Logs are written to two locations:

1. **Systemd Journal**: `journalctl -u b2-sync-opn.service`
   - Persistent across reboots
   - Includes all systemd metadata
   - Best for real-time monitoring

2. **Local Files**: `logs/b2-sync-opn-YYYYMMDD.log`
   - One file per day
   - Plain text with ANSI color codes
   - Easy to archive or analyze

Both locations contain identical content with color formatting.

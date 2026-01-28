# B2 Backup Scripts

Automated backup scripts for syncing `/home/memez/opn/` to Backblaze B2 bucket `b2://memez-quant/opn/` every 6 hours.

## Quick Reference

```bash
# Watch logs in real-time (colored output)
journalctl -u b2-sync-opn.service -f

# Run backup now
sudo systemctl start b2-sync-opn.service

# Check timer status
systemctl status b2-sync-opn.timer

# View demo of log format
./demo-logs.sh
```

## Prerequisites

1. **Install B2 CLI** (if not already installed):
   ```bash
   # Using pipx (recommended - isolated environment)
   pipx install b2
   
   # Or using pip with --user flag
   pip install --user b2
   ```

2. **Authorize B2 account**:
   ```bash
   ~/.local/bin/b2 account authorize
   ```
   
   You'll need your:
   - Application Key ID
   - Application Key
   
   The script uses the full path `/home/memez/.local/bin/b2` so it works correctly in systemd without PATH issues.

## Installation

1. **Make setup script executable**:
   ```bash
   chmod +x setup-b2-sync.sh
   ```

2. **Run setup script** (requires sudo):
   ```bash
   sudo ./setup-b2-sync.sh
   ```

   This will:
   - Install systemd service and timer
   - Enable automatic backups every 6 hours (00:00, 06:00, 12:00, 18:00)
   - Start the timer immediately

**Note**: The first sync will take time depending on the size of your `/home/memez/opn/` directory. Subsequent syncs will be much faster as they only upload changed files.

3. **View log format demo** (optional):
   ```bash
   ./demo-logs.sh
   ```
   
   This shows what the logs will look like when running.

## Manual Usage

### Run backup immediately
```bash
sudo systemctl start b2-sync-opn.service
```

### Check timer status
```bash
systemctl status b2-sync-opn.timer
```

### View next scheduled runs
```bash
systemctl list-timers b2-sync-opn.timer
```

### View backup logs

**Real-time colored logs** (recommended):
```bash
# Follow systemd journal (colored output)
journalctl -u b2-sync-opn.service -f

# Or follow local log file
tail -f logs/b2-sync-opn-$(date +%Y%m%d).log
```

**Historical logs**:
```bash
# Last 50 lines
journalctl -u b2-sync-opn.service -n 50

# Logs for today
journalctl -u b2-sync-opn.service --since today

# View local log file
cat logs/b2-sync-opn-$(date +%Y%m%d).log
```

### Log Format

The logs use colored, minimal output for easy monitoring:

```
08:34:21 - Began sync [b2 sync] - Run 31
08:34:45 - → Uploaded: 42 files
08:34:45 - → Deleted: 3 files
08:34:45 - → Compared: 1523 files
08:34:45 - ✓ Sync completed - Run 31
08:34:46 - → Total files in bucket: 9619
```

**Colors**:
- 🔵 Blue: Info (sync started)
- 🟢 Green: Success (sync completed)
- 🔴 Red: Error (sync failed)
- 🟡 Yellow: Warning
- 🔷 Cyan: Statistics (→)

**Demo**: Run `./demo-logs.sh` to see example output

## Management

### Stop automatic backups
```bash
sudo systemctl stop b2-sync-opn.timer
```

### Disable automatic backups
```bash
sudo systemctl disable b2-sync-opn.timer
```

### Re-enable automatic backups
```bash
sudo systemctl enable b2-sync-opn.timer
sudo systemctl start b2-sync-opn.timer
```

### Uninstall
```bash
sudo systemctl stop b2-sync-opn.timer
sudo systemctl disable b2-sync-opn.timer
sudo rm /etc/systemd/system/b2-sync-opn.service
sudo rm /etc/systemd/system/b2-sync-opn.timer
sudo systemctl daemon-reload
```

## Excluded Patterns

The backup script automatically excludes (using regex patterns):

- `node_modules/` directories
- Build directories: `dist/`, `build/`, `.next/`, `.turbo/`
- Cache directories: `coverage/`, `.cache/`, `.temp/`, `.tmp/`
- Log files: `*.log`
- System files: `.DS_Store`, `Thumbs.db`
- Version control: `.git/`
- Package managers: `.pnpm-store/`, `.npm/`, `.yarn/`
- Rust build: `target/`
- Python: `__pycache__/`, `*.pyc`, `.pytest_cache/`
- Virtual environments: `.venv/`, `venv/`
- Local env files: `.env.local`, `.env.*.local`

## Backup Configuration

- **Schedule**: Every 6 hours (00:00, 06:00, 12:00, 18:00)
- **Source**: `/home/memez/opn/`
- **Destination**: `b2://memez-quant/opn/`
- **Retention**: Keeps versions for 30 days
- **Behavior**: Replaces newer files if size differs
- **Run Counter**: Tracks backup runs (stored in `.run_counter`)

## Troubleshooting

### Check if B2 is authorized
```bash
~/.local/bin/b2 account get
```

### Test backup script manually
```bash
./b2-sync-opn.sh
```

### Re-authorize B2 if needed
```bash
~/.local/bin/b2 account authorize
```

### Check systemd service logs
```bash
journalctl -u b2-sync-opn.service --since "1 hour ago"
```

### Verify B2 bucket contents
```bash
~/.local/bin/b2 ls --recursive b2://memez-quant/opn/
```

## Security Notes

- B2 credentials are stored in `~/.b2_account_info` (user-only readable)
- Service runs as user `memez` (not root)
- Uses systemd security features (`PrivateTmp`, `NoNewPrivileges`)

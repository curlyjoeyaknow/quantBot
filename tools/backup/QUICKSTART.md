# B2 Backup - Quick Start Guide

## 30-Second Setup

```bash
cd /home/memez/backups/quantBot/tools/backup

# 1. View demo (optional)
./demo-logs.sh

# 2. Install service
sudo ./setup-b2-sync.sh

# 3. Watch logs
journalctl -u b2-sync-opn.service -f
```

Done! Your `/home/memez/opn/` directory will now backup to B2 every 6 hours.

## What You'll See

```
08:34:21 - Began sync [b2 sync] - Run 1
08:34:45 - ✓ Sync completed - Run 1
08:34:45 - → Uploaded: 42 files
08:34:46 - → Total files in bucket: 9619
```

## Common Commands

```bash
# Watch logs in real-time
journalctl -u b2-sync-opn.service -f

# Run backup now (don't wait for schedule)
sudo systemctl start b2-sync-opn.service

# Check when next backup runs
systemctl list-timers b2-sync-opn.timer

# Stop automatic backups
sudo systemctl stop b2-sync-opn.timer

# Start automatic backups again
sudo systemctl start b2-sync-opn.timer
```

## Backup Schedule

Runs automatically at:
- 00:00 (midnight)
- 06:00 (6am)
- 12:00 (noon)
- 18:00 (6pm)

## What Gets Backed Up

Everything in `/home/memez/opn/` **except**:
- `node_modules/`
- Build directories (`dist/`, `build/`, `.next/`)
- Cache directories (`.cache/`, `.temp/`)
- Log files (`*.log`)
- Virtual environments (`.venv/`, `venv/`)
- Git directories (`.git/`)

## Where It Goes

- **Destination**: `b2://memez-quant/opn/`
- **Retention**: 30 days of file versions
- **Method**: Incremental (only changed files)

## Troubleshooting

### Check if service is running
```bash
systemctl status b2-sync-opn.timer
```

### View recent logs
```bash
journalctl -u b2-sync-opn.service -n 50
```

### Test backup manually
```bash
./b2-sync-opn.sh
```

### Check B2 authorization
```bash
~/.local/bin/b2 account get
```

## More Info

- **Full docs**: See `README.md`
- **Log format**: See `LOG_FORMAT.md`
- **Features**: See `FEATURES.md`
- **Demo**: Run `./demo-logs.sh`

## Need Help?

1. Check logs: `journalctl -u b2-sync-opn.service -n 50`
2. Test manually: `./b2-sync-opn.sh`
3. Check B2 auth: `~/.local/bin/b2 account get`
4. Read `README.md` for detailed troubleshooting

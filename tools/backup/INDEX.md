# B2 Backup Scripts - File Index

## 🚀 Start Here

1. **[QUICKSTART.md](QUICKSTART.md)** - 30-second setup guide
2. **[demo-logs.sh](demo-logs.sh)** - See what the logs look like
3. **[setup-b2-sync.sh](setup-b2-sync.sh)** - Run this to install

## 📚 Documentation

### Essential Reading
- **[README.md](README.md)** - Complete documentation
  - Prerequisites
  - Installation steps
  - Usage commands
  - Troubleshooting

- **[QUICKSTART.md](QUICKSTART.md)** - Fast setup guide
  - 30-second installation
  - Common commands
  - Quick troubleshooting

### Reference
- **[LOG_FORMAT.md](LOG_FORMAT.md)** - Log format guide
  - Color coding explained
  - Example outputs
  - Monitoring commands
  - Filtering tips

- **[FEATURES.md](FEATURES.md)** - Feature overview
  - Core functionality
  - Logging & monitoring
  - Security features
  - Performance details

- **[CHANGELOG.md](CHANGELOG.md)** - Version history
  - What's new
  - Breaking changes
  - Migration notes

- **[SETUP_COMPLETE.md](SETUP_COMPLETE.md)** - Post-installation summary
  - What was created
  - Current status
  - Next steps
  - Verification commands

## 🛠️ Scripts

### Main Scripts
- **[b2-sync-opn.sh](b2-sync-opn.sh)** - Main backup script
  - Syncs `/home/memez/opn/` to B2
  - Colored log output
  - Run counter
  - Smart exclusions

- **[setup-b2-sync.sh](setup-b2-sync.sh)** - Installation script
  - Installs systemd service/timer
  - Enables automatic backups
  - Verifies prerequisites

- **[demo-logs.sh](demo-logs.sh)** - Log format demo
  - Shows example output
  - Demonstrates colors
  - Interactive demo

## ⚙️ System Files

### Systemd
- **[b2-sync-opn.service](b2-sync-opn.service)** - Systemd service definition
  - Runs backup script
  - Security hardening
  - Logging configuration

- **[b2-sync-opn.timer](b2-sync-opn.timer)** - Systemd timer
  - 6-hour schedule
  - Persistent (runs missed schedules)
  - Boot delay

## 📊 Generated Files

These files are created when the scripts run:

- **`.run_counter`** - Tracks backup run numbers
- **`logs/b2-sync-opn-YYYYMMDD.log`** - Daily log files

## 📖 Reading Order

### For First-Time Setup
1. [QUICKSTART.md](QUICKSTART.md) - Get started fast
2. [demo-logs.sh](demo-logs.sh) - See what to expect
3. Run `setup-b2-sync.sh` - Install
4. [LOG_FORMAT.md](LOG_FORMAT.md) - Understand the logs

### For Detailed Understanding
1. [README.md](README.md) - Complete guide
2. [FEATURES.md](FEATURES.md) - Feature deep-dive
3. [LOG_FORMAT.md](LOG_FORMAT.md) - Log details
4. [CHANGELOG.md](CHANGELOG.md) - Version history

### For Troubleshooting
1. [README.md](README.md) - Troubleshooting section
2. [LOG_FORMAT.md](LOG_FORMAT.md) - Log filtering
3. [QUICKSTART.md](QUICKSTART.md) - Quick fixes

## 🎯 Quick Commands

```bash
# View demo
./demo-logs.sh

# Install
sudo ./setup-b2-sync.sh

# Watch logs
journalctl -u b2-sync-opn.service -f

# Run now
sudo systemctl start b2-sync-opn.service

# Check status
systemctl status b2-sync-opn.timer
```

## 📦 File Sizes

```
Total: ~30 KB

Scripts:
- b2-sync-opn.sh: 5.5 KB
- setup-b2-sync.sh: 2.4 KB
- demo-logs.sh: 1.9 KB

Documentation:
- README.md: 4.8 KB
- FEATURES.md: 4.8 KB
- LOG_FORMAT.md: 3.3 KB
- SETUP_COMPLETE.md: 3.3 KB
- CHANGELOG.md: 2.6 KB
- QUICKSTART.md: 2.1 KB
- INDEX.md: (this file)

System:
- b2-sync-opn.service: 473 bytes
- b2-sync-opn.timer: 292 bytes
```

## 🔗 External Links

- [Backblaze B2 Documentation](https://www.backblaze.com/b2/docs/)
- [B2 CLI Documentation](https://www.backblaze.com/b2/docs/quick_command_line.html)
- [Systemd Timer Documentation](https://www.freedesktop.org/software/systemd/man/systemd.timer.html)

## 💡 Tips

- Start with [QUICKSTART.md](QUICKSTART.md) if you're in a hurry
- Run [demo-logs.sh](demo-logs.sh) to see the log format before installing
- Read [README.md](README.md) for comprehensive documentation
- Check [LOG_FORMAT.md](LOG_FORMAT.md) to understand the colored output
- Refer to [FEATURES.md](FEATURES.md) for detailed feature explanations

# Recovery Instructions for alerts.duckdb

## Quick Recovery (Recommended)

Run this command:

```bash
sudo bash /tmp/recover_alerts.sh
```

## Manual Recovery Steps

### 1. Install recovery tools

```bash
sudo apt-get update
sudo apt-get install -y extundelete testdisk
```

### 2. Create recovery directory

```bash
RECOVERY_DIR="/tmp/alerts_recovery_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$RECOVERY_DIR"
```

### 3. List deleted files (to find the inode)

```bash
sudo extundelete /dev/nvme0n1p5 --list-deleted-files | grep -i alerts
```

### 4. Recover the specific file

```bash
sudo extundelete /dev/nvme0n1p5 \
  --restore-file "/home/memez/backups/quantBot-abstraction-backtest-only/data/alerts.duckdb" \
  --output-dir "$RECOVERY_DIR"
```

### 5. Check recovered file

```bash
find "$RECOVERY_DIR" -name "*alerts*" -exec ls -lh {} \;
```

### 6. If found, restore it

```bash
# Verify the file size is correct (should be multiple GB)
RECOVERED=$(find "$RECOVERY_DIR" -name "*alerts*.duckdb" -size +100M | head -1)
if [ -n "$RECOVERED" ]; then
  cp "$RECOVERED" data/alerts.duckdb.recovered
  echo "Recovered file saved to: data/alerts.duckdb.recovered"
  echo "Verify it, then: mv data/alerts.duckdb.recovered data/alerts.duckdb"
fi
```

## Alternative: Using photorec (if extundelete doesn't work)

```bash
# Create recovery directory
RECOVERY_DIR="/tmp/alerts_recovery_$(date +%Y%m%d_%H%M%S)"
mkdir -p "$RECOVERY_DIR"

# Run photorec (interactive)
sudo photorec /log "$RECOVERY_DIR/recovery.log" /dev/nvme0n1p5

# Then search for .duckdb files in the recovery directory
find "$RECOVERY_DIR" -name "*.duckdb" -size +100M
```

## Important Notes

- **Time is critical**: The longer you wait, the higher the chance the file blocks have been overwritten
- **Stop using the disk**: Avoid writing to `/home` partition to prevent overwriting deleted data
- **File was deleted ~10 minutes ago**: Good chance of recovery if disk hasn't been heavily used
- **Current file is only 12KB**: This is a new empty file, the original multi-GB file is still recoverable

## Verification

After recovery, verify the file:

```bash
# Check file type
file data/alerts.duckdb.recovered

# Check file size
du -h data/alerts.duckdb.recovered

# Try to open with DuckDB (if you have it)
duckdb data/alerts.duckdb.recovered "SELECT COUNT(*) FROM information_schema.tables;"
```

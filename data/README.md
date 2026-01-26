# Data Directory

This directory is the **canonical location** for all runtime state and databases in the QuantBot project.

## Critical Rules

⚠️ **NEVER MOVE OR DELETE THIS DIRECTORY**

- This directory MUST exist in the repo root at all times
- Only copy and backup - never relocate
- Excluded from git via `.gitignore`
- Contains critical runtime state

## Contents

This directory contains:

### Databases
- `*.duckdb` - DuckDB databases (primary data store)
- `*.duckdb.wal` - DuckDB write-ahead logs
- `*.duckdb-shm` - DuckDB shared memory files

### Subdirectories
- `alerts/` - Alert ingestion data
- `backups/` - Database backups
- `exports/` - Exported data files
- `clickhouse/` - ClickHouse data (if running locally)

## Backup Strategy

To backup this directory:

```bash
# Create timestamped backup
cp -r data/ "data.backup.$(date +%Y%m%d-%H%M%S)"

# Or use rsync for incremental backups
rsync -av --delete data/ /path/to/backup/location/
```

## Recovery

If you need to restore from backup:

```bash
# Copy backup to data/ (never move the original data/ directory)
rsync -av /path/to/backup/ data/
```

## Configuration

Database paths can be configured via:

1. **`config.yaml`** (highest priority):
   ```yaml
   duckdb:
     path: data/tele.duckdb
   ```

2. **Environment variables**:
   ```bash
   export DUCKDB_PATH=data/tele.duckdb
   ```

3. **CLI flags**: `--duckdb-path data/tele.duckdb`

## Default Location

This `data/` directory in the repo root is the default location. The project is configured to use this path by default when no explicit configuration is provided.

## Git Ignore

This directory is excluded from git tracking via `.gitignore`:

```gitignore
# Runtime state
data/
```

All files in this directory are ignored by git to prevent accidentally committing large database files or sensitive data.

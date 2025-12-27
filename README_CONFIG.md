# Configuration Guide

## Config.yaml

QuantBot now supports configuration via a `config.yaml` file in the project root. This provides a centralized way to configure database paths and other settings.

### Priority Order

Configuration values are resolved in this order:

1. **config.yaml** file (highest priority)
2. **Environment variables** (DUCKDB_PATH, etc.)
3. **Default values** (lowest priority)

### Example config.yaml

```yaml
# QuantBot Configuration
duckdb:
  # Path to DuckDB database file
  # Default: data/tele.duckdb
  path: data/tele.duckdb
```

### Database Path Configuration

All services now use `data/tele.duckdb` by default (which contains the `user_calls_d` table with calls data).

To override:

- **Option 1**: Create/edit `config.yaml`:

  ```yaml
  duckdb:
    path: /path/to/your/database.duckdb
  ```

- **Option 2**: Set environment variable:
  ```bash
  export DUCKDB_PATH=/path/to/your/database.duckdb
  ```

### Migration from result.duckdb

Previously, some services used `data/result.duckdb`. All services now default to `data/tele.duckdb` which contains:

- `user_calls_d` - Call data
- `caller_links_d` - Caller relationships
- Other analytics tables

If you need to use a different database, configure it in `config.yaml`.

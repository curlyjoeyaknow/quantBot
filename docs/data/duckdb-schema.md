# DuckDB Schema Documentation

## Overview

The QuantBot backtesting system uses DuckDB as its primary data store. This document describes the database schema, available views, and how to query data safely.

## Database Location

- **Path**: `data/alerts.duckdb`
- **Type**: File-based DuckDB database
- **Access**: Read-only for queries, write access for ingestion only

## Schema Overview

The database contains multiple schemas:

- **`canon`** - Canonical alert data (PRIMARY schema for queries)
- **`core`** - Core alert tables
- **`raw`** - Raw Telegram messages
- **`baseline`** - Backtest baseline results
- **`optimizer`** - Optimization results
- **`bt`** - Backtest metrics and runs
- **`main`** - Main schema (coverage, summaries, etc.)

## Canon Schema - Primary Query Interface

The `canon` schema is the **ONLY schema agents should query**. It provides a stable, documented interface for accessing alert data.

### Primary View: `canon.alerts_std`

**This is the PRIMARY view for all alert/call queries. Use this view exclusively.**

#### Purpose

`canon.alerts_std` is the canonical alert contract - one row per alert, stable columns forever. This view consolidates all alert data from various sources into a single, consistent format.

#### Columns

| Column | Type | Description |
|--------|------|-------------|
| `alert_id` | VARCHAR | Unique alert identifier (format: `chat_id:message_id`) |
| `alert_chat_id` | BIGINT | Telegram chat ID |
| `alert_message_id` | BIGINT | Telegram message ID |
| `alert_ts_ms` | BIGINT | Alert timestamp in milliseconds |
| `alert_kind` | VARCHAR | Alert kind: `'human'` or `'bot_only'` |
| `mint` | VARCHAR | Token mint address (32-44 characters) |
| `chain` | VARCHAR | Blockchain: `'solana'` or `'evm'` |
| `mint_source` | VARCHAR | Source of mint: `'alert_text'` or `'bot_card'` |
| `caller_raw_name` | VARCHAR | Raw caller name from Telegram |
| `caller_id` | VARCHAR | Normalized caller ID (may be NULL) |
| `caller_name_norm` | VARCHAR | Normalized caller name (may be NULL) |
| `caller_base` | VARCHAR | Caller base identifier (may be NULL) |
| `alert_text` | VARCHAR | Original alert message text |
| `run_id` | VARCHAR | Ingestion run ID |
| `ingested_at` | TIMESTAMP | When the alert was ingested |

#### Example Queries

**Query alerts by caller:**
```sql
SELECT * FROM canon.alerts_std
WHERE caller_name_norm = 'brook'
ORDER BY alert_ts_ms DESC
LIMIT 100;
```

**Query alerts by date range:**
```sql
SELECT * FROM canon.alerts_std
WHERE alert_ts_ms >= 1609459200000  -- 2021-01-01
  AND alert_ts_ms <= 1640995200000  -- 2022-01-01
ORDER BY alert_ts_ms DESC;
```

**Query alerts with mint addresses:**
```sql
SELECT * FROM canon.alerts_std
WHERE mint IS NOT NULL
  AND TRIM(mint) != ''
ORDER BY alert_ts_ms DESC;
```

**Query alerts by chain:**
```sql
SELECT * FROM canon.alerts_std
WHERE chain = 'solana'
ORDER BY alert_ts_ms DESC;
```

### Other Canon Views

#### `canon.callers_d`

Caller lookup table - maps caller names to caller IDs.

**Columns:**
- `caller_id` - Normalized caller ID
- `caller_raw_name` - Raw caller name from Telegram
- `caller_name_norm` - Normalized caller name
- `caller_base` - Caller base identifier

**Usage:**
```sql
SELECT * FROM canon.callers_d
WHERE caller_base = 'brook';
```

#### `canon.bot_cards`

Bot response cards - bot replies to alerts.

**Columns:**
- `chat_id` - Telegram chat ID
- `message_id` - Telegram message ID
- `ts_ms` - Timestamp in milliseconds
- `bot_name` - Bot name (e.g., 'phanes')
- `bot_text` - Bot reply text
- `reply_to_message_id` - ID of message being replied to

**Usage:**
```sql
SELECT * FROM canon.bot_cards
WHERE reply_to_message_id = 12345;
```

#### `canon.messages`

Raw messages view - original Telegram messages.

**Columns:**
- `chat_id` - Telegram chat ID
- `message_id` - Telegram message ID
- `ts_ms` - Timestamp in milliseconds
- `from_name` - Sender name
- `text` - Message text
- `reply_to_message_id` - ID of message being replied to

## Using the Data Helper

### Python

```python
from tools.shared.duckdb_data_helper import (
    query_alerts,
    query_callers,
    validate_view_name,
    get_view_schema,
    DEFAULT_DB_PATH,
    get_readonly_connection,
)

# Query alerts
with get_readonly_connection(DEFAULT_DB_PATH) as con:
    alerts = query_alerts(con, {
        'caller_name': 'brook',
        'from_ts_ms': 1609459200000,
        'to_ts_ms': 1640995200000,
        'limit': 100,
    })

# Query callers
with get_readonly_connection(DEFAULT_DB_PATH) as con:
    callers = query_callers(con, {
        'caller_base': 'brook',
    })

# Validate view name
is_valid, error_msg = validate_view_name('alerts_std', 'canon')
if not is_valid:
    print(f"Error: {error_msg}")
```

### TypeScript

```typescript
import { DuckDBDataHelperService, DEFAULT_DB_PATH } from '@quantbot/storage';

const helper = new DuckDBDataHelperService(DEFAULT_DB_PATH);

// Query alerts
const alerts = await helper.queryAlerts({
  caller_name: 'brook',
  from_ts_ms: 1609459200000,
  to_ts_ms: 1640995200000,
  limit: 100,
});

// Query callers
const callers = await helper.queryCallers({
  caller_base: 'brook',
});

// Validate view
const isValid = await helper.validateView('alerts_std', 'canon');

// Get view schema
const schema = await helper.getViewSchema('alerts_std', 'canon');
```

## Deprecated Views

The following views are **DEPRECATED** and should not be used. Use `canon.alerts_std` instead.

| Deprecated View | Replacement |
|----------------|-------------|
| `canon.alerts_canon` | `canon.alerts_std` |
| `canon.alerts_final` | `canon.alerts_std` |
| `canon.alerts_resolved` | `canon.alerts_std` |
| `canon.alerts_enriched` | `canon.alerts_std` |
| `canon.alerts_clean` | `canon.alerts_std` |
| `canon.alerts_ready` | `canon.alerts_std WHERE caller_id IS NOT NULL` |
| `canon.alerts_unknown` | `canon.alerts_std WHERE caller_id IS NULL` |
| `canon.alerts_v` | `canon.alerts_std` |
| `canon.alerts_analysis` | `canon.alerts_std` |
| `canon.alerts_canon_filled` | `canon.alerts_std` |
| `canon.alerts_final_pretty` | `canon.alerts_std` |
| `canon.alerts_health` | `SELECT COUNT(*) FROM canon.alerts_std` |
| `canon.alerts_health_origin` | `canon.alerts_std` with caller_id checks |
| `canon.alerts_promoted_from_raw` | `canon.alerts_std` |
| `canon.alerts_universe` | `canon.alerts_std` |
| `canon.alert_resolved` | `canon.alerts_std` |
| `canon.alert_resolved_light` | `canon.alerts_std` |
| `canon.alert_mints` | Data available in `canon.alerts_std` (mint, chain, mint_source columns) |
| `canon.alert_mints_1` | Data available in `canon.alerts_std` |
| `canon.alert_mint_best` | Data available in `canon.alerts_std` |
| `canon.alert_mint_resolved` | Data available in `canon.alerts_std` |
| `canon.alert_mint_counts` | `SELECT COUNT(*) FROM canon.alerts_std GROUP BY alert_id` |
| `canon.alert_bot_links` | Join `canon.alerts_std` with `canon.bot_cards` |
| `canon.alert_bot_links_1` | Join `canon.alerts_std` with `canon.bot_cards` |

## Migration Guide

If you're using deprecated views, migrate to `canon.alerts_std`:

### Old Query
```sql
SELECT * FROM canon.alerts_ready
WHERE caller_name = 'brook';
```

### New Query
```sql
SELECT * FROM canon.alerts_std
WHERE caller_id IS NOT NULL
  AND (caller_name_norm = 'brook' OR caller_raw_name = 'brook');
```

### Old Query
```sql
SELECT * FROM canon.alert_mints
WHERE mint = 'So11111111111111111111111111111111111111112';
```

### New Query
```sql
SELECT * FROM canon.alerts_std
WHERE mint = 'So11111111111111111111111111111111111111112';
```

## Common Patterns

### Get alerts for a specific caller
```sql
SELECT * FROM canon.alerts_std
WHERE caller_name_norm = 'brook'
ORDER BY alert_ts_ms DESC;
```

### Get alerts with mint addresses only
```sql
SELECT * FROM canon.alerts_std
WHERE mint IS NOT NULL
  AND TRIM(mint) != ''
ORDER BY alert_ts_ms DESC;
```

### Get alerts by date range
```sql
SELECT * FROM canon.alerts_std
WHERE alert_ts_ms >= ?  -- Start timestamp (ms)
  AND alert_ts_ms <= ?  -- End timestamp (ms)
ORDER BY alert_ts_ms DESC;
```

### Join alerts with bot cards
```sql
SELECT 
  a.*,
  b.bot_text,
  b.bot_name
FROM canon.alerts_std a
LEFT JOIN canon.bot_cards b
  ON b.chat_id = a.alert_chat_id
  AND b.reply_to_message_id = a.alert_message_id;
```

### Get caller statistics
```sql
SELECT 
  caller_name_norm,
  COUNT(*) as alert_count,
  COUNT(DISTINCT mint) as unique_tokens,
  MIN(alert_ts_ms) as first_alert,
  MAX(alert_ts_ms) as last_alert
FROM canon.alerts_std
WHERE caller_id IS NOT NULL
GROUP BY caller_name_norm
ORDER BY alert_count DESC;
```

## Best Practices

1. **Always use `canon.alerts_std`** for alert queries
2. **Use the data helper** (`DuckDBDataHelperService` or `duckdb_data_helper.py`) instead of raw SQL
3. **Validate view names** before querying
4. **Use read-only connections** for queries
5. **Filter by date range** when querying large datasets
6. **Use LIMIT** to prevent large result sets
7. **Check for NULL values** in optional columns (mint, caller_id, etc.)

## Error Messages

If you try to query a deprecated or invalid view, you'll get a helpful error message:

```
View 'canon.alerts_canon' is deprecated. Use: canon.alerts_std
See docs/data/duckdb-schema.md for migration guide.
```

Or:

```
View 'canon.invalid_view' does not exist or is not allowed.
Available views: alerts_std, callers_d, bot_cards, messages
Primary view: canon.alerts_std (use this for alerts/calls)
See docs/data/duckdb-schema.md for schema documentation.
```

## Data Quality Notes

- **Mint addresses**: May be NULL or empty. Always check `mint IS NOT NULL AND TRIM(mint) != ''` before using.
- **Caller IDs**: May be NULL for unknown callers. Use `caller_id IS NOT NULL` to filter for known callers.
- **Timestamps**: All timestamps are in milliseconds (not seconds).
- **Case sensitivity**: Mint addresses preserve case. Caller names are normalized.

## Support

For questions or issues:
1. Check this documentation first
2. Use the data helper functions (they provide better error messages)
3. See `tools/shared/duckdb_data_helper.py` for Python implementation
4. See `packages/storage/src/duckdb/duckdb-data-helper-service.ts` for TypeScript implementation


# Data Raw Query

**Command**: `quantbot data raw query`

**Package**: `data`

**Handler**: `packages/cli/src/handlers/data/query-raw-data.ts`

## Description

Query raw immutable data with filters for source type, source ID, content hash, and date range.

## Pattern

- **Handler**: Pure function pattern
- **Service**: Accesses `RawDataRepository` via `CommandContext`
- **Repository**: `RawDataDuckDBAdapter` implements `RawDataRepository` port

## Options

- `--from <date>` - Start date (ISO 8601)
- `--to <date>` - End date (ISO 8601)
- `--source-type <type>` - Source type (telegram_export, api_response, etc.)
- `--source-id <id>` - Source identifier
- `--hash <hash>` - Content hash
- `--format <format>` - Output format: json, table, csv (default: "table")

## Examples

```bash
# Query by date range
quantbot data raw query --from 2024-01-01 --to 2024-01-02

# Query by source type
quantbot data raw query --source-type telegram_export

# Query by hash
quantbot data raw query --hash abc123...
```

## Related

- [[raw-list]] - List raw data sources
- [[canonical-query]] - Query canonical events


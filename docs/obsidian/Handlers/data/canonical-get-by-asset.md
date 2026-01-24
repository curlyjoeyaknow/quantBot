# Data Canonical Get By Asset

**Command**: `quantbot data canonical get-by-asset`

**Package**: `data.canonical`

**Handler**: `packages/cli/src/handlers/data/get-canonical-by-asset.ts`

## Description

Get canonical events for a specific asset (chain-agnostic) with optional event type filtering.

## Pattern

- **Handler**: Pure function pattern
- **Service**: Accesses `CanonicalRepository` via `CommandContext`
- **Repository**: `CanonicalDuckDBAdapter` implements `CanonicalRepository` port

## Options

- `--asset-address <address>` - Asset address (required)
- `--from <date>` - Filter by timestamp (from, ISO 8601)
- `--to <date>` - Filter by timestamp (to, ISO 8601)
- `--event-types <types>` - Comma-separated event types to filter
- `--format <format>` - Output format: json, table, csv (default: "table")

## Examples

```bash
# Get all events for asset
quantbot data canonical get-by-asset --asset-address ABC123...

# Filter by event types
quantbot data canonical get-by-asset --asset-address ABC123... --event-types alert,candle

# With date range
quantbot data canonical get-by-asset --asset-address ABC123... --from 2024-01-01 --to 2024-12-31
```

## Related

- [[canonical-query]] - Query canonical events
- [[raw-query]] - Query raw data


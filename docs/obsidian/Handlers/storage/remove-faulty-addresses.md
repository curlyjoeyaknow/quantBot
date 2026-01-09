# remove-faulty-addresses Handler

## Overview

Removes faulty addresses from DuckDB database.

## Location

`packages/cli/src/handlers/storage/remove-faulty-addresses.ts`

## Handler Function

`removeFaultyAddressesHandler`

## Command

```bash
quantbot storage remove-faulty-addresses [options]
```

## Examples

```bash
# Dry run (preview what would be deleted)
quantbot storage remove-faulty-addresses --duckdb data/alerts.duckdb --dry-run

# Actually remove faulty addresses
quantbot storage remove-faulty-addresses --duckdb data/alerts.duckdb

# Using environment variable
DUCKDB_PATH=data/alerts.duckdb quantbot storage remove-faulty-addresses
```

## Parameters

- `--duckdb <path>`: Path to DuckDB database (or set DUCKDB_PATH env var)
- `--dry-run`: Dry run mode (don't actually delete)

## Implementation

- Uses `DuckDBStorageService.removeFaultyAddresses()`
- Validates addresses and removes invalid ones
- Can run in dry-run mode to preview changes

## Returns

```typescript
{
  success: boolean;
  duckdb: string;
  dry_run: boolean;
  total_rows_deleted: number;
  tables_affected: string[];
  removals: Array<{
    mint: string;
    table_name: string;
    rows_deleted: number;
  }>;
}
```

## Related

- [[validate-addresses]] - Validate addresses
- [[migrate-duckdb]] - Database migrations


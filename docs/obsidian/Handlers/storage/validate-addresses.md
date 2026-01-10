# validate-addresses Handler

## Overview

Validates addresses in DuckDB database.

## Location

`packages/cli/src/handlers/storage/validate-addresses.ts`

## Handler Function

`validateAddressesHandler`

## Command

```bash
quantbot storage validate-addresses [options]
```

## Examples

```bash
# Validate addresses in DuckDB
quantbot storage validate-addresses --duckdb data/alerts.duckdb

# Using environment variable
DUCKDB_PATH=data/alerts.duckdb quantbot storage validate-addresses

# JSON output
quantbot storage validate-addresses --duckdb data/alerts.duckdb --format json
```

## Parameters

- `--duckdb <path>`: Path to DuckDB database (or set DUCKDB_PATH env var)
- `--format <format>`: Output format

## Returns

```typescript
{
  total: number;
  valid: number;
  invalid: number;
  errors: Array<{
    address: string;
    error: string;
  }>;
}
```

## Related

- [[remove-faulty-addresses]] - Remove faulty addresses
- [[migrate-duckdb]] - Database migrations


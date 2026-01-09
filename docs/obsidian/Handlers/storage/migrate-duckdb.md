# migrate-duckdb Handler

## Overview

Runs SQL migration files against a DuckDB database.

## Location

`packages/cli/src/handlers/storage/migrate-duckdb.ts`

## Handler Function

`migrateDuckdbHandler`

## Command

```bash
quantbot storage migrate-duckdb --duckdb <path> [options]
```

## Examples

```bash
# Run all migrations
quantbot storage migrate-duckdb --duckdb data/alerts.duckdb --all

# Run specific migration
quantbot storage migrate-duckdb --duckdb data/alerts.duckdb --migration 006_create_backtest_tables.sql
```

## Parameters

- `--duckdb <path>`: Path to DuckDB database file (required)
- `--migration <file>`: Specific migration file to run (e.g., `006_create_backtest_tables.sql`)
- `--all`: Run all migrations in order

## Implementation

- Opens DuckDB connection
- Reads migration files from `packages/storage/migrations` directory
- Executes SQL migrations in order
- Tracks which migrations have been run (if migration tracking table exists)

## Migration Files

Located in: `packages/storage/migrations/`

Format: `NNN_description.sql` (e.g., `006_create_backtest_tables.sql`)

## Returns

```typescript
{
  success: boolean;
  migrationsRun: string[];
  error?: string;
}
```

## Related

- [[validate-addresses]] - Validate addresses
- [[remove-faulty-addresses]] - Remove faulty addresses


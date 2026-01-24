# Data Raw List

**Command**: `quantbot data raw list`

**Package**: `data`

**Handler**: `packages/cli/src/handlers/data/list-raw-sources.ts`

## Description

List all raw immutable data sources stored in the system.

## Pattern

- **Handler**: Pure function pattern
- **Service**: Accesses `RawDataRepository` via `CommandContext`
- **Repository**: `RawDataDuckDBAdapter` implements `RawDataRepository` port

## Options

- `--format <format>` - Output format: json, table, csv (default: "table")

## Examples

```bash
# List all sources
quantbot data raw list

# JSON output
quantbot data raw list --format json
```

## Related

- [[raw-query]] - Query raw data
- [[canonical-query]] - Query canonical events


# Features Compute

**Command**: `quantbot features compute`

**Package**: `features`

**Handler**: `packages/cli/src/handlers/features/compute-features.ts`

## Description

Compute features for a feature set with optional date range filtering.

## Pattern

- **Handler**: Pure function pattern
- **Service**: Accesses `FeatureStore` via `CommandContext`
- **Store**: Feature store implementation computes features

## Options

- `--feature-set <id>` - Feature set ID (required, e.g., "rsi:1.0.0")
- `--from <date>` - Start date (ISO 8601)
- `--to <date>` - End date (ISO 8601)
- `--format <format>` - Output format: json, table, csv (default: "table")

## Examples

```bash
# Compute features for feature set
quantbot features compute --feature-set rsi:1.0.0

# With date range
quantbot features compute --feature-set rsi:1.0.0 --from 2024-01-01 --to 2024-12-31
```

## Related

- [[list-features]] - List registered features


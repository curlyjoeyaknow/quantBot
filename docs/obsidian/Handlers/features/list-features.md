# Features List

**Command**: `quantbot features list`

**Package**: `features`

**Handler**: `packages/cli/src/handlers/features/list-features.ts`

## Description

List all registered features in the feature store.

## Pattern

- **Handler**: Pure function pattern
- **Service**: Accesses `FeatureStore` via `CommandContext`
- **Store**: Feature store implementation provides feature registry

## Options

- `--format <format>` - Output format: json, table, csv (default: "table")

## Examples

```bash
# List all features
quantbot features list

# JSON output
quantbot features list --format json
```

## Related

- [[compute-features]] - Compute features for feature set


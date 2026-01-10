# validate-slice Handler

## Overview

Validates a slice file or directory.

## Location

`packages/cli/src/handlers/slices/validate-slice.ts`

## Handler Function

`validateSliceHandler`

## Command

```bash
quantbot slices validate --slice <path> [options]
```

## Examples

```bash
# Validate slice file
quantbot slices validate --slice slices/2025-05/slice_001.parquet

# Validate slice directory
quantbot slices validate --slice slices/2025-05/

# JSON output
quantbot slices validate --slice slices/2025-05/ --format json
```

## Parameters

- `--slice <path>`: Path to slice file or directory (required)
- `--format <format>`: Output format

## Returns

```typescript
{
  valid: boolean;
  errors: string[];
  warnings: string[];
  metadata: SliceMetadata;
}
```

## Related

- [[export-slice]] - Export slice
- [[export-slices-for-alerts]] - Export slices for alerts


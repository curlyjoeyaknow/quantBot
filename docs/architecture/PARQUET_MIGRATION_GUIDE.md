# Parquet Migration Guide

**Status**: Ready for use  
**Created**: 2026-01-22

## Overview

This guide helps you migrate existing flat Parquet files to the canonical partitioned structure defined in [PARQUET_ARTIFACT_SPEC.md](./PARQUET_ARTIFACT_SPEC.md).

## Quick Start

### 1. Run Migration Script (Dry Run First)

```bash
tsx scripts/data-processing/migrate-parquet-to-partitioned.ts \
  --source-dir ./slices/per_token_v2 \
  --target-base ./slices/partitioned \
  --dataset candles_1m \
  --chain sol \
  --dry-run
```

### 2. Review Output

The script will show:
- Files that would be migrated
- Target paths for each file
- Manifests that would be created

### 3. Run Actual Migration

Remove `--dry-run` flag:

```bash
tsx scripts/data-processing/migrate-parquet-to-partitioned.ts \
  --source-dir ./slices/per_token_v2 \
  --target-base ./slices/partitioned \
  --dataset candles_1m \
  --chain sol
```

## Migration Script Options

```bash
--source-dir <path>     # Source directory with flat Parquet files (default: ./slices/per_token_v2)
--target-base <path>    # Base directory for partitioned output (default: ./slices/partitioned)
--dataset <name>        # Dataset name (default: candles_1m)
--chain <chain>         # Chain identifier: sol|eth|base|bsc (default: sol)
--dry-run               # Preview changes without moving files
--max-files <number>    # Limit number of files to process (for testing)
```

## What the Script Does

1. **Scans source directory** for `.parquet` files
2. **Infers metadata** from filenames (date, token ID, etc.)
3. **Reads Parquet metadata** using DuckDB to get:
   - Row counts
   - Timestamp ranges
   - Chain information
4. **Reorganizes files** into canonical partitioned structure:
   ```
   {dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}/part-*.parquet
   ```
5. **Creates manifests** (`slice.manifest.json`) for each partition
6. **Validates integrity** after migration

## Filename Patterns Supported

The script can infer metadata from these patterns:

- `YYYYMMDD_HHMM_<token>_<label>.parquet` → Extracts date and token ID
- Other patterns → Relies on Parquet metadata

## After Migration

### Verify Structure

```bash
# Check partitioned structure
tree slices/partitioned -L 4

# Should see:
# slices/partitioned/
#   candles_1m/
#     chain=sol/
#       dt=2024-12-01/
#         run_id=migration_<timestamp>/
#           part-*.parquet
#           slice.manifest.json
```

### Verify Manifests

```bash
# Check manifest exists
cat slices/partitioned/candles_1m/chain=sol/dt=2024-12-01/run_id=*/slice.manifest.json

# Should contain:
# - File paths
# - Row counts
# - Timestamp ranges
# - Integrity hashes
```

### Test Queries

```typescript
import { DuckDBClient } from '@quantbot/storage';

const client = new DuckDBClient(':memory:');
await client.execute('INSTALL parquet;');
await client.execute('LOAD parquet;');

// Query migrated files
const result = await client.query(`
  SELECT COUNT(*) as cnt
  FROM read_parquet('slices/partitioned/candles_1m/chain=sol/dt=2024-12-01/run_id=*/part-*.parquet')
`);
```

## Troubleshooting

### Issue: "No Parquet files found"

**Solution**: Check source directory path:
```bash
ls -la ./slices/per_token_v2/*.parquet | head -5
```

### Issue: "Failed to read Parquet metadata"

**Solution**: File may be corrupted or have unsupported schema. Check file:
```bash
file slices/per_token_v2/<filename>.parquet
```

### Issue: "Cannot infer date from filename"

**Solution**: Script will use Parquet metadata. If that fails, manually specify date in script or use `--max-files 1` to test one file.

### Issue: "Out of memory"

**Solution**: Use `--max-files` to process in batches:
```bash
# Process first 100 files
tsx scripts/data-processing/migrate-parquet-to-partitioned.ts \
  --source-dir ./slices/per_token_v2 \
  --target-base ./slices/partitioned \
  --dataset candles_1m \
  --chain sol \
  --max-files 100
```

## Validation

After migration, all new exports are automatically validated against the canonical artifact spec:

```typescript
import { validateParquetLayout, getCanonicalLayoutSpec } from '@quantbot/core';

// Get canonical layout
const layout = getCanonicalLayoutSpec('file://./slices');

// Validate (throws on error)
const validation = validateParquetLayout(layout);
if (!validation.valid) {
  console.error('Errors:', validation.errors);
}
if (validation.warnings.length > 0) {
  console.warn('Warnings:', validation.warnings);
}
```

## Next Steps

1. ✅ Migrate existing flat files
2. ✅ Verify migrated structure
3. ✅ Update queries to use new paths
4. ✅ Remove old flat files (after verification)
5. ✅ All new exports use canonical layout (enforced)

## References

- [Parquet Artifact Specification](./PARQUET_ARTIFACT_SPEC.md)
- [Storage Strategy](./STORAGE_STRATEGY.md)
- Migration script: `scripts/data-processing/migrate-parquet-to-partitioned.ts`


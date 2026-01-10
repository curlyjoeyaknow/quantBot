# export-slice Handler

## Overview

Pure handler that orchestrates slice export and analysis. No I/O, no DB clients - uses adapters from context.

## Location

`packages/cli/src/handlers/slices/export-slice.ts`

## Handler Function

`exportSliceHandler`

## Command

```bash
quantbot slices export [options]
```

## Examples

```bash
# Export slice for date range
quantbot slices export --dataset alerts --chain solana --from 2025-05-01 --to 2026-01-07 --output-dir slices/2025-05

# Export specific tokens
quantbot slices export --dataset alerts --chain solana --from 2025-05-01 --to 2026-01-07 --tokens "So1111...,So2222..." --output-dir slices/2025-05

# JSON output
quantbot slices export --dataset alerts --chain solana --from 2025-05-01 --to 2026-01-07 --output-dir slices/2025-05 --format json
```

## Parameters

- `--dataset <name>`: Dataset name (required)
- `--chain <chain>`: Chain name (required)
- `--from <date>`: Start date (ISO 8601) (required)
- `--to <date>`: End date (ISO 8601) (required)
- `--tokens <addresses>`: Comma-separated token addresses (optional)
- `--output-dir <dir>`: Output directory for Parquet files (required)
- `--format <format>`: Output format

## Workflow

1. **Generate runId**: Create unique run ID
2. **Build RunContext**: Create run context with runId and timestamp
3. **Build SliceSpec**: Convert CLI args to slice specification
4. **Build ParquetLayoutSpec**: Create Parquet layout specification
5. **Create adapters**: 
   - `createClickHouseSliceExporterAdapterImpl` for export
   - `createDuckDbSliceAnalyzerAdapterImpl` for analysis
6. **Export and analyze**: Call `exportAndAnalyzeSlice` workflow
7. **Return results**: Export and analysis results

## Returns

```typescript
{
  runId: string;
  export: SliceExportResult;
  analysis: SliceAnalysisResult;
}
```

## Related

- [[export-slices-for-alerts]] - Export slices for alerts
- [[validate-slice]] - Validate slice


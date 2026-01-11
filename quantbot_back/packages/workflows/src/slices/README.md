# Slice Export + Analyze Workflow

This workflow standardizes the pipeline:

ClickHouse (canonical store) -> Parquet (frozen slice artifact) -> DuckDB (analysis/runtime)

## Design Rules

- `exportAndAnalyzeSlice` is a **pure handler** (no fs/env/db).
- Adapters implement:
  - `SliceExporter` (ClickHouse -> Parquet + manifest)
  - `SliceAnalyzer` (Parquet -> DuckDB analysis)
- The manifest is the contract between export and analysis.

## Why a manifest?

It makes experiments:

- reproducible
- debuggable
- diffable between runs

## What goes into ClickHouse vs DuckDB?

- Raw / high-volume sim outputs: store as Parquet artifacts.
- Canonical summaries (PnL, drawdown, win-rate per run): ingest into ClickHouse (optionally via MV).

## Implementation Status

✅ **ClickHouse exporter implemented** (`ClickHouseSliceExporterAdapterImpl`)

- Currently supports: `candles_1m` dataset (maps to `ohlcv_candles` table with `interval='1m'`)
- Simple filters: time range + optional tokenIds
- Single Parquet file output
- Generates manifest with row counts and file metadata

⏳ **DuckDB analyzer** - Stub implementation ready, can be filled in

## Quick Start

```typescript
import { exportAndAnalyzeSlice } from '@quantbot/workflows';
import {
  createClickHouseSliceExporterAdapterImpl,
  createDuckDbSliceAnalyzerAdapterImpl,
} from '@quantbot/storage';

const exporter = createClickHouseSliceExporterAdapterImpl();
const analyzer = createDuckDbSliceAnalyzerAdapterImpl();

const result = await exportAndAnalyzeSlice({
  run: {
    runId: 'run_001',
    createdAtIso: new Date().toISOString(),
  },
  spec: {
    dataset: 'candles_1m', // Only this dataset is supported currently
    chain: 'sol',
    timeRange: {
      startIso: '2024-12-01T00:00:00.000Z',
      endIso: '2024-12-02T00:00:00.000Z',
    },
    // Optional: tokenIds: ['mint1', 'mint2'],
  },
  layout: {
    baseUri: 'file:///tmp/slices',
    subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
  },
  analysis: {
    kind: 'sql',
    sql: `
      SELECT 
        COUNT(*) as total_candles,
        COUNT(DISTINCT token_address) as unique_tokens,
        AVG(volume) as avg_volume
      FROM slice
    `,
  },
  exporter,
  analyzer,
});
```

## Next Steps

See [NEXT_STEPS.md](./NEXT_STEPS.md) for detailed roadmap.

**Immediate priorities:**

1. ✅ **ClickHouse exporter** - Working for `candles_1m`
2. ✅ **DuckDB analyzer** - Basic SQL execution working
3. ⏳ **Test with real data** - Verify end-to-end pipeline
4. ⏳ **CLI command** - Make it easy to use from command line
5. ⏳ **More datasets** - Add support for other datasets (alerts, indicators, etc.)

## Why Start Simple?

- **1m datasets** - You have this interval for all datasets
- **Alerts, not trades** - You don't have trades currently, only alerts
- **One dataset, one filter mode, one file** - Keeps it boring and testable

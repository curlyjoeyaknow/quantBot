# Export Slice and Analyze Workflow

Clean architecture implementation for exporting data slices from ClickHouse to Parquet and analyzing them in DuckDB.

**This is an intent, not a tech.** The handler owns the operation. Two adapters do the dirty work.

## Architecture

**Handler (Pure):** `exportSliceAndAnalyze`
- Accepts inputs (slice spec, analysis spec, run context)
- Calls ports: `SliceExporter.exportSlice()` and `SliceAnalyzer.analyze()`
- Returns structured result with artifact references
- **No filesystem reads, no env, no DB clients. Just orchestration.**

**Adapters (Impure, do the dirty work):**

1. **ClickHouse → Parquet adapter** (`ClickHouseSliceExporterAdapter`)
   - Executes ClickHouse queries
   - Writes Parquet files + manifest
   - Handles partitioning, compression, file naming, retries

2. **Parquet → DuckDB adapter** (`DuckDbSliceAnalyzerAdapter`)
   - Creates/opens DuckDB (in-memory or file)
   - Attaches Parquet as external tables/views
   - Runs analysis SQL and emits results (Parquet/JSON/CSV)

## Implementation Strategy

**Build one adapter first:** ClickHouse → Parquet
- It's deterministic
- It produces a tangible artifact
- You can test it in isolation
- DuckDB can come later without changing the handler

You can even stub the analyzer initially:
```typescript
return { status: "skipped" }
```
The handler still works, and the pipeline shape is validated.

## Usage Example

```typescript
import { exportSliceAndAnalyze, createSliceContext } from '@quantbot/workflows';
import type { ExportSliceAndAnalyzeSpec } from '@quantbot/workflows';

// Create context (wires adapters)
const ctx = await createSliceContext();

// Define spec (just data, no clients, no paths)
const spec: ExportSliceAndAnalyzeSpec = {
  sliceSpec: {
    exportId: 'run_123',
    timeRange: {
      from: '2024-12-01T00:00:00Z',
      to: '2024-12-07T23:59:59Z',
    },
    tokenAddresses: ['token1', 'token2', 'token3'],
    chain: 'solana',
    tables: [
      {
        tableName: 'ohlcv_candles',
        columns: ['token_address', 'timestamp', 'open', 'high', 'low', 'close', 'volume'],
      },
      {
        tableName: 'trades',
        columns: ['token_address', 'timestamp', 'price', 'size', 'side'],
      },
    ],
    output: {
      basePath: './exports/run_123',
      compression: 'snappy',
    },
  },
  analysisSpec: {
    sql: `
      SELECT 
        token_address,
        COUNT(*) as trade_count,
        SUM(volume) as total_volume,
        AVG(close) as avg_price
      FROM ohlcv_candles
      GROUP BY token_address
    `,
    outputFormat: 'json',
  },
};

  runContext: {
    runId: 'run_123',
    strategyId: 'momentum_v4',
  },
};

// Execute workflow
const result = await exportSliceAndAnalyze(spec, ctx);

if (result.success) {
  console.log('Export completed:', result.summary);
  console.log('Manifest:', result.manifest);
  console.log('Artifact refs:', result.artifactRefs);
  if (result.analysisResults) {
    console.log('Analysis result:', result.analysisResults);
  }
} else {
  console.error('Export failed:', result.errors);
}
```

## Manifest

The export adapter produces `slice.manifest.json` that includes:

- **slice spec** (time range, tokens, columns)
- **parquet file list** (paths, row counts, sizes)
- **schema version**
- **row counts** per table
- **checksum/version hash** (for integrity verification)

This makes the pipeline reproducible and debuggable.

## The Rule That Keeps You Honest

**If the code needs any of:**
- filesystem
- network
- env vars
- DB connections

**→ It's an adapter. The handler should only see `exportSlice()` and `analyze()`.**

## Package Structure

- **Handler:** `packages/workflows/src/slice/exportAndAnalyzeSlice.ts`
- **Adapters:**
  - `packages/storage/src/adapters/clickhouse-slice-exporter-adapter.ts` (build this first)
  - `packages/storage/src/adapters/duckdb-slice-analyzer-adapter.ts` (can stub initially)
- **Ports:** `packages/core/src/ports/slice-exporter-port.ts`, `slice-analyzer-port.ts`
- **Composition Root:** `packages/workflows/src/context/createSliceContext.ts`

## Mental Checksum

In two weeks you should be able to:
- ✅ re-run a simulation
- ✅ re-export a slice
- ✅ diff two Parquet manifests
- ✅ re-run DuckDB analysis without touching ClickHouse

**That's the difference between a research lab and a data swamp.**

## Testing

The handler is pure and testable:

```typescript
import { exportSliceAndAnalyze } from '@quantbot/workflows';

const mockExporter = {
  exportSlice: vi.fn().mockResolvedValue({
    success: true,
    manifest: { /* ... */ },
  }),
};

const mockAnalyzer = {
  analyze: vi.fn().mockResolvedValue({
    success: true,
    metadata: { rowCount: 100, columns: ['col1'], executionTimeMs: 50 },
  }),
};

const ctx = {
  ports: { /* mock ports */ },
  sliceExporter: mockExporter,
  sliceAnalyzer: mockAnalyzer,
};

const result = await exportSliceAndAnalyze(spec, ctx);
// Test assertions...
```

## What NOT to Do

❌ **Don't add this to an existing simulation handler**
❌ **Don't let the handler open a file or DB connection**
❌ **Don't pre-optimize partition schemes**
❌ **Don't materialize sim internals in ClickHouse "just for now"**

You already escaped those potholes. Keep the simulation lab clean.


# @quantbot/labcatalog

Lab catalog system for QuantBot - structured artifact store inspired by Nautilus Data Catalog.

## Purpose

Provides a consistent, productized way to store and retrieve lab artifacts:
- **Slices**: Exported OHLCV data as Parquet files
- **Runs**: Simulation runs with results and metadata
- **Cacheable**: Content-addressed for automatic deduplication
- **Queryable**: Stable paths enable fast lookup

## Key Concepts

### Catalog Layout

The catalog uses a predictable directory structure:

```
catalog/
├── data/
│   └── bars/              # OHLCV candle data
│       └── <token>/       # Organized by token (mint address)
│           └── <start>_<end>.parquet
├── runs/
│   └── <runId>/           # Simulation run outputs
│       ├── manifest.json
│       ├── results.parquet
│       └── events.ndjson
└── manifest.json          # Root catalog manifest
```

### Content Addressing

Catalog uses hash-based IDs for:
- **Slice manifests**: Deterministic ID from spec + content
- **Run IDs**: Deterministic ID from run context + timestamp
- **File paths**: Include hash for cacheability

### Catalog API

Simple API surface:
- `putSlice(manifest, basePath)` - Store slice manifest and files
- `getSlice(manifestId, basePath)` - Retrieve slice by ID
- `putRun(runId, runData, basePath)` - Store run artifacts
- `listRuns(basePath, filters?)` - Query runs by filters

## Architecture

- **Pure functions**: No direct FS/DB dependencies
- **Adapter pattern**: FS operations handled by adapters
- **Zod validation**: All schemas validated
- **Deterministic**: Same inputs → same paths/IDs

## Usage

```typescript
import { Catalog, FileSystemCatalogAdapter } from '@quantbot/labcatalog';

const adapter = new FileSystemCatalogAdapter('./catalog');
const catalog = new Catalog(adapter, './catalog');

// Store a slice
const manifestId = await catalog.putSlice(sliceManifest);

// Retrieve a slice
const manifest = await catalog.getSlice(manifestId);

// Store a run
await catalog.putRun(runId, runData);

// List runs
const runs = await catalog.listRuns({ strategyId: 'PT2_SL25' });
```


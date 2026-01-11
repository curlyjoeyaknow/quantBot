# QuantBot Workflows Documentation

> Complete reference for all workflows in `@quantbot/workflows`

## Overview

Workflows are the orchestration layer that coordinates storage, services, and I/O operations. They follow a strict contract:

1. **Validate spec** (Zod schema)
2. **Use WorkflowContext** (dependency injection)
3. **Return JSON-serializable results**
4. **Explicit error policy** (collect vs failFast)

See [WORKFLOW_ENFORCEMENT.md](./WORKFLOW_ENFORCEMENT.md) for contract details.

---

## Core Workflows

### Simulation Workflows

#### `runSimulation`

Main simulation workflow that orchestrates strategy execution over historical calls.

**Location**: `packages/workflows/src/simulation/runSimulation.ts`

**Spec**:
```typescript
type SimulationRunSpec = {
  strategyName: string;
  callerName?: string;
  from: DateTime;
  to: DateTime;
  options?: {
    dryRun?: boolean;
    preWindowMinutes?: number;
    postWindowMinutes?: number;
  };
};
```

**Flow**:
1. Validates spec (Zod schema)
2. Loads strategy by name
3. Fetches calls in date range
4. Deduplicates calls by ID
5. For each call:
   - Fetches candles with time window
   - Runs simulation using `causalAccessor` (Gate 2 compliance)
   - Captures per-call errors (doesn't fail entire run)
6. Computes aggregate statistics (PnL min/max/mean/median)
7. Persists results (unless dryRun=true)

**Result**:
```typescript
type SimulationRunResult = {
  runId: string;
  totals: {
    calls: number;
    successful: number;
    failed: number;
    trades: number;
  };
  pnl: {
    min?: number;
    max?: number;
    mean?: number;
    median?: number;
  };
  results: SimulationCallResult[];
};
```

**Usage**:
```typescript
import { runSimulation, createProductionContext } from '@quantbot/workflows';
import { DateTime } from 'luxon';

const ctx = createProductionContext();
const result = await runSimulation(
  {
    strategyName: 'IchimokuV1',
    callerName: 'Brook',
    from: DateTime.fromISO('2024-01-01T00:00:00.000Z'),
    to: DateTime.fromISO('2024-12-01T00:00:00.000Z'),
    options: {
      dryRun: false,
      preWindowMinutes: 60,
      postWindowMinutes: 120,
    },
  },
  ctx
);
```

---

#### `runSimulationDuckdb`

DuckDB-based simulation workflow with automatic OHLCV ingestion retry.

**Location**: `packages/workflows/src/simulation/runSimulationDuckdb.ts`

**Spec**:
```typescript
type RunSimulationDuckdbSpec = {
  duckdbPath: string;
  strategyName: string;
  callerName?: string;
  from: string; // ISO 8601
  to: string; // ISO 8601
  options?: {
    dryRun?: boolean;
    preWindowMinutes?: number;
    postWindowMinutes?: number;
  };
};
```

**Flow**:
1. Query DuckDB for calls (batch mode)
2. Check OHLCV availability (resume mode)
3. Filter calls by OHLCV availability
4. Run simulation (via simulation service)
5. Collect skipped tokens
6. If skipped tokens exist:
   - Trigger OHLCV ingestion workflow
   - Update OHLCV metadata
   - Mark unrecoverable tokens
   - Re-run simulation for retry tokens
   - Merge results
7. Return structured, serializable results

**Result**:
```typescript
type RunSimulationDuckdbResult = {
  runId: string;
  totals: {
    calls: number;
    successful: number;
    failed: number;
    trades: number;
  };
  skippedTokens: SkippedToken[];
  results: SimulationCallResult[];
};
```

---

### OHLCV Workflows

#### `ingestOhlcv`

OHLCV ingestion workflow using ports (control-plane orchestration).

**Location**: `packages/workflows/src/ohlcv/ingestOhlcv.ts`

**Spec**:
```typescript
type IngestOhlcvSpec = {
  duckdbPath: string;
  from?: string; // ISO 8601
  to?: string; // ISO 8601
  preWindowMinutes?: number;
  postWindowMinutes?: number;
  errorMode?: 'collect' | 'failFast';
};
```

**Flow**:
1. Generate worklist from DuckDB (offline work planning)
2. For each work item:
   - Check idempotency via `ctx.ports.state`
   - Optional: Check coverage to skip unnecessary fetches
   - Fetch candles via `ctx.ports.marketData.fetchOhlcv()`
   - Store candles via `storeCandles()` (ClickHouse)
   - Mark as processed via `ctx.ports.state`
   - Emit telemetry events/metrics
3. Batch update DuckDB metadata (ingestion bookkeeping)
4. Return structured, serializable results

**Architecture**: Uses ports for all external dependencies (market data, state, telemetry).

**Result**:
```typescript
type IngestOhlcvResult = {
  summary: {
    totalWorkItems: number;
    successful: number;
    failed: number;
    skipped: number;
  };
  errors: Array<{
    workItem: string;
    error: string;
  }>;
  metadata: {
    runId: string;
    startedAt: string; // ISO string
    completedAt: string; // ISO string
    durationMs: number;
  };
};
```

---

#### `ingestOhlcvWorkflowPorted`

Port-based OHLCV ingestion workflow (newer implementation).

**Location**: `packages/workflows/src/ohlcv/ingestOhlcvPorted.ts`

**Architecture**: Fully port-based, uses `WorkflowContextWithPorts` for all dependencies.

**Usage**:
```typescript
import { ingestOhlcvWorkflowPorted, createProductionContextWithPorts } from '@quantbot/workflows';

const ctx = createProductionContextWithPorts();
const result = await ingestOhlcvWorkflowPorted(
  {
    duckdbPath: './data/quantbot.duckdb',
    from: '2024-01-01T00:00:00.000Z',
    to: '2024-12-31T23:59:59.999Z',
  },
  ctx
);
```

---

#### `surgicalOhlcvFetch`

Surgical OHLCV fetch workflow for targeted candle retrieval.

**Location**: `packages/workflows/src/ohlcv/surgicalOhlcvFetch.ts`

**Features**:
- Coverage analysis before fetching
- Progress tracking with callbacks
- Timeout handling
- Parallel processing support

**Usage**:
```typescript
import { surgicalOhlcvFetch } from '@quantbot/workflows';

const result = await surgicalOhlcvFetch(
  {
    duckdbPath: './data/quantbot.duckdb',
    callerName: 'Brook',
    from: '2024-01-01T00:00:00.000Z',
    to: '2024-12-31T23:59:59.999Z',
    onProgress: (progress) => {
      console.log(`Progress: ${progress.current}/${progress.total}`);
    },
  },
  ctx
);
```

---

#### `analyzeCoverage`

Analyze OHLCV coverage for calls and callers.

**Location**: `packages/workflows/src/ohlcv/analyzeCoverage.ts`

**Result**:
```typescript
type AnalyzeCoverageResult = {
  overall: OverallCoverageResult;
  byCaller: CallerCoverageResult[];
};
```

---

#### `analyzeDetailedCoverage`

Detailed OHLCV coverage analysis with interval-level breakdown.

**Location**: `packages/workflows/src/ohlcv/analyzeDetailedCoverage.ts`

**Features**:
- Interval-level coverage (1m, 5m, 15m, 1h)
- Caller-based analysis
- Token-level statistics
- Coverage gaps identification

---

### Ingestion Workflows

#### `ingestTelegramJson`

Ingest Telegram JSON exports workflow.

**Location**: `packages/workflows/src/telegram/ingestTelegramJson.ts`

**Spec**:
```typescript
type TelegramJsonIngestSpec = {
  filePath: string;
  callerName: string;
  errorMode?: 'collect' | 'failFast';
};
```

**Flow**:
1. Parse Telegram JSON export
2. Extract calls, alerts, tokens
3. Normalize mint addresses (preserve case)
4. Store in DuckDB (idempotent)
5. Return ingestion statistics

**Result**:
```typescript
type TelegramJsonIngestResult = {
  summary: {
    calls: number;
    alerts: number;
    tokens: number;
    callers: number;
  };
  errors: Array<{
    message: string;
    context?: unknown;
  }>;
};
```

---

### Call Evaluation Workflows

#### `evaluateCallsWorkflow`

Evaluate calls workflow for caller performance analysis.

**Location**: `packages/workflows/src/calls/evaluate.ts`

**Features**:
- Caller performance metrics
- Token performance analysis
- Win rate calculations
- PnL aggregation

---

#### `queryCallsDuckdb`

Query calls from DuckDB workflow.

**Location**: `packages/workflows/src/calls/queryCallsDuckdb.ts`

**Spec**:
```typescript
type QueryCallsDuckdbSpec = {
  duckdbPath: string;
  callerName?: string;
  fromISO?: string;
  toISO?: string;
  limit?: number;
};
```

**Result**:
```typescript
type QueryCallsDuckdbResult = {
  calls: CallRecord[];
  total: number;
};
```

---

### Storage Workflows

#### `getStorageStats`

Get storage statistics workflow.

**Location**: `packages/workflows/src/storage/getStorageStats.ts`

**Result**:
```typescript
type GetStorageStatsResult = {
  duckdb: {
    strategies: number;
    runs: number;
    calls: number;
  };
  clickhouse: {
    candles: number;
    tokens: number;
  };
};
```

---

#### `getOhlcvStats`

Get OHLCV statistics workflow.

**Location**: `packages/workflows/src/storage/getOhlcvStats.ts`

**Result**:
```typescript
type GetOhlcvStatsResult = {
  totalCandles: number;
  uniqueTokens: number;
  dateRange: {
    earliest: string;
    latest: string;
  };
  intervals: Array<{
    interval: string;
    candleCount: number;
    tokenCount: number;
  }>;
};
```

---

#### `getTokenStats`

Get token statistics workflow.

**Location**: `packages/workflows/src/storage/getTokenStats.ts`

**Result**:
```typescript
type GetTokenStatsResult = {
  token: string;
  chain: string;
  candleCount: number;
  firstSeen: string;
  lastSeen: string;
  intervals: string[];
};
```

---

### Research OS Workflows

#### Data Snapshot Service

**Location**: `packages/workflows/src/research/services/DataSnapshotService.ts`

**Features**:
- Create reproducible data snapshots
- Content hashing for snapshot integrity
- Filtering and querying snapshots
- Snapshot comparison

**Usage**:
```typescript
import { DataSnapshotService } from '@quantbot/workflows/research';

const service = new DataSnapshotService(ctx);
const snapshot = await service.createSnapshot({
  from: DateTime.fromISO('2024-01-01T00:00:00.000Z'),
  to: DateTime.fromISO('2024-12-31T23:59:59.999Z'),
  callerName: 'Brook',
});
```

---

#### Execution Reality Service

**Location**: `packages/workflows/src/research/services/ExecutionRealityService.ts`

**Features**:
- Create execution models (latency, slippage, failure simulation)
- Create cost models (fees, priority fees, trading costs)
- Create risk models (position limits, circuit breakers)

---

#### Research Simulation Adapter

**Location**: `packages/workflows/src/research/simulation-adapter.ts`

**Features**:
- Loads data snapshots
- Converts strategy/execution/cost models to simulation formats
- Runs simulations using `simulateStrategy()`
- Returns complete `RunArtifact` with all required data

---

#### Leaderboard

**Location**: `packages/workflows/src/research/leaderboard.ts`

**Features**:
- Rank simulation runs by metrics (return, winRate, profitFactor, sharpeRatio, etc.)
- Filter by strategy name, snapshot ID
- Sort ascending/descending
- Limit results

---

### Slice Export & Analysis Workflows

#### `exportAndAnalyzeSlice`

Export slice from ClickHouse and analyze with DuckDB.

**Location**: `packages/workflows/src/slices/exportAndAnalyzeSlice.ts`

**Spec**:
```typescript
type ExportAndAnalyzeSliceSpec = {
  slicePath: string;
  dataset: string; // 'candles_1m'
  tokens: string[];
  from: string; // ISO 8601
  to: string; // ISO 8601
  analysisPlan?: string; // SQL query or plan name
};
```

**Flow**:
1. Validate slice manifest (AJV schema)
2. Export candles from ClickHouse to Parquet
3. Analyze slice with DuckDB (SQL queries)
4. Return analysis results

**Result**:
```typescript
type ExportAndAnalyzeSliceResult = {
  slicePath: string;
  exported: {
    fileCount: number;
    totalRows: number;
  };
  analysis: {
    plan: string;
    results: unknown; // Analysis-specific
  };
};
```

---

#### `exportSlicesForAlerts`

Export slices for multiple alerts.

**Location**: `packages/workflows/src/slices/exportSlicesForAlerts.ts`

**Features**:
- Batch slice export for multiple alerts
- Parallel processing
- Progress tracking

---

### Lab Workflows

#### `runLabPreset`

Run lab simulation preset workflow.

**Location**: `packages/workflows/src/lab/runLabPreset.ts`

**Features**:
- Load preset configuration
- Run simulations with preset parameters
- Aggregate results
- Export artifacts

---

#### `runOptimization`

Run optimization workflow.

**Location**: `packages/workflows/src/lab/runOptimization.ts`

**Features**:
- Parameter sweep
- Grid search
- Strategy optimization

---

#### `runRollingWindows`

Run rolling window analysis workflow.

**Location**: `packages/workflows/src/lab/runRollingWindows.ts`

**Features**:
- Rolling window simulations
- Time-series analysis
- Performance tracking

---

## Workflow Context

### WorkflowContext

Base context interface for workflows:

```typescript
type WorkflowContext = {
  clock: { nowISO(): string };
  ids: { newRunId(): string };
  logger: {
    info: (message: string, context?: unknown) => void;
    warn: (message: string, context?: unknown) => void;
    error: (message: string, context?: unknown) => void;
  };
  repos: {
    strategies: { getByName: (name: string) => Promise<StrategyRecord | null> };
    calls: {
      list: (q: { callerName?: string; fromISO: string; toISO: string }) => Promise<CallRecord[]>;
    };
    simulationRuns: { create: (run: {...}) => Promise<void> };
    simulationResults: { insertMany: (runId: string, rows: SimulationCallResult[]) => Promise<void> };
  };
  ohlcv: {
    causalAccessor: CausalCandleAccessor; // Primary method (Gate 2 compliance)
    getCandles?: (q: {...}) => Promise<Candle[]>; // Legacy (deprecated)
  };
  simulation: {
    run: (q: {...}) => Promise<SimulationOutput>;
  };
};
```

### WorkflowContextWithPorts

Extended context with ports for port-based workflows:

```typescript
type WorkflowContextWithPorts = WorkflowContext & {
  ports: {
    marketData: MarketDataPort;
    execution: ExecutionPort;
    state: StatePort;
    telemetry: TelemetryPort;
    clock: ClockPort;
  };
};
```

### Creating Contexts

**Production Context**:
```typescript
import { createProductionContext } from '@quantbot/workflows';

const ctx = createProductionContext();
```

**Production Context with Ports**:
```typescript
import { createProductionContextWithPorts } from '@quantbot/workflows';

const ctx = createProductionContextWithPorts();
```

**DuckDB Simulation Context**:
```typescript
import { createDuckdbSimulationContext } from '@quantbot/workflows';

const ctx = createDuckdbSimulationContext({
  duckdbPath: './data/quantbot.duckdb',
});
```

**OHLCV Ingestion Context**:
```typescript
import { createOhlcvIngestionContext } from '@quantbot/workflows';

const ctx = createOhlcvIngestionContext({
  duckdbPath: './data/quantbot.duckdb',
});
```

---

## Testing Workflows

### Mock Context

Create mock context for testing:

```typescript
import { createMockWorkflowContext } from '@quantbot/workflows/tests/helpers';

const ctx = createMockWorkflowContext({
  repos: {
    strategies: {
      getByName: vi.fn().mockResolvedValue(mockStrategy),
    },
    calls: {
      list: vi.fn().mockResolvedValue(mockCalls),
    },
  },
});
```

### Golden Tests

Workflows have comprehensive golden tests:

- Dry run vs persist modes
- Error handling (missing strategy, invalid dates, per-call errors)
- Deduplication and ordering
- Windowing logic
- Statistics correctness

See `packages/workflows/tests/` for test examples.

---

## Related Documentation

- [WORKFLOW_ENFORCEMENT.md](./WORKFLOW_ENFORCEMENT.md) - Workflow contract enforcement
- [WORKFLOW_ARCHITECTURE.md](./WORKFLOW_ARCHITECTURE.md) - Workflow architecture patterns
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall system architecture
- [packages/workflows/README.md](../../packages/workflows/README.md) - Package documentation


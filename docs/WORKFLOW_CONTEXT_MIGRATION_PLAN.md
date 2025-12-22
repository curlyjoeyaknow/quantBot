# WorkflowContext Migration Plan

This document outlines the incremental migration strategy for refactoring WorkflowContext to use ports instead of raw clients.

## Migration Rule

**No workflow gets refactored "all at once."**

Each workflow moves from "raw clients" → "ports" in one PR, then we delete the old access path.

## Four-Layer Migration Process

For each port:

1. **Define port** (already done ✅)
2. **Build adapter** (wrap existing client)
3. **Update WorkflowContext** to expose the port
4. **Update ONE workflow** to use the port
5. **Remove old client exposure** only after all workflows are migrated (or gate with "deprecated")

Repeat for each port.

## Step 1: Define the "Production Ports" Object

Update `createProductionContext()` to return:

```typescript
type ProductionPorts = {
  marketData: MarketDataPort;
  execution: ExecutionPort;
  state: StatePort;
  telemetry: TelemetryPort;
  clock: ClockPort;
};
```

Then WorkflowContext becomes:

```typescript
type WorkflowContext = {
  ports: ProductionPorts;
  // plus workflow-specific pure config if needed
  // (keep existing repos/ohlcv/simulation for backward compatibility during migration)
};
```

This becomes the single place where "the world" enters the app layer.

## Step 2: Build Adapters Incrementally

Order matters. Pick the ports where "correctness" is easiest and you won't bikeshed.

### A) TelemetryPort Adapter (Do This First) ⭐

**Why first**: Easiest and immediately pays off. Handlers return metrics/events, workflows emit them consistently.

**TelemetryPort interface** (already defined):
- `emitMetric(name, value, tags?)`
- `emitEvent(type, data?)`
- `startSpan(name, operation)`, `endSpan(span)`, `emitSpan(span)`

**Adapter implementation** (`packages/observability/src/adapters/telemetryAdapter.ts`):
```typescript
import type { TelemetryPort } from '@quantbot/core';
import { logger } from '@quantbot/utils';

export class ConsoleTelemetryAdapter implements TelemetryPort {
  emitMetric(metric: MetricEmission): void {
    // Write to console now
    // Later: OTEL, Prometheus, whatever
    console.log(`[METRIC] ${metric.name}=${metric.value}`, metric.labels);
  }

  emitEvent(event: EventEmission): void {
    // Use existing logger
    logger[event.level](event.message, event.context);
  }

  // ... span methods
}
```

**Benefits**:
- Makes the migration visible and satisfying
- Consistent telemetry across all workflows
- Easy to swap implementations later

### B) ClockPort Adapter (Already Exists) ✅

**Status**: Already defined in `packages/core/src/ports/clockPort.ts`

**Action**: Expose it in WorkflowContext. Done.

**Implementation**:
```typescript
const clockPort: ClockPort = {
  nowMs: () => Date.now(),
};
```

### C) StatePort Adapter (2nd)

**Why second**: Workflows currently reach into storage clients. Wrapping them lets you control caching/transactions later.

**Start with minimal surface**:
- `get(key, namespace?)` / `set(key, value, namespace?, ttl?)` (KV)
- `readPositions(...)` / `writePositions(...)`
- `dedupe(idempotencyKey)` (idempotency keys)

**Adapter implementation** (`packages/storage/src/adapters/stateAdapter.ts`):
```typescript
import type { StatePort } from '@quantbot/core';
import { DuckDBStorageService } from '@quantbot/simulation';

export class DuckDBStateAdapter implements StatePort {
  constructor(private readonly duckdb: DuckDBStorageService) {}

  async get<T>(request: StateGetRequest): Promise<StateGetResult<T>> {
    // Use DuckDB to get value
    // ...
  }

  async set(request: StateSetRequest): Promise<{ success: boolean; error?: string }> {
    // Use DuckDB to set value
    // ...
  }

  // ... other methods
}
```

**Expand later**: Add query(), transaction(), etc. as needed.

### D) MarketDataPort (3rd)

**Why third**: More nuanced (provider differences). Keep it narrow at first.

**Minimal surface**:
- `fetchOhlcv(request)` - Get candles
- `fetchMetadata(request)` - Get token metadata
- `fetchHistoricalPriceAtTime(request)` - Get price at specific time

**Adapter implementation** (`packages/api-clients/src/adapters/marketDataAdapter.ts`):
```typescript
import type { MarketDataPort } from '@quantbot/core';
import { BirdeyeClient, HeliusRestClient } from '../index.js';

export class BirdeyeMarketDataAdapter implements MarketDataPort {
  constructor(private readonly birdeye: BirdeyeClient) {}

  async fetchOhlcv(request: MarketDataOhlcvRequest): Promise<Candle[]> {
    // Use BirdeyeClient to fetch OHLCV
    // ...
  }

  // ... other methods
}
```

**Let adapter decide**: Birdeye vs Helius vs Shyft based on configuration.

### E) ExecutionPort (Last)

**Why last**: Hardest because it touches latency and "real money". Migrate only once the pattern is smooth.

**Minimal surface**:
- `execute(request)` - Execute trade
- `isAvailable()` - Check if execution is available

**Adapter implementation** (`packages/api-clients/src/adapters/executionAdapter.ts`):
```typescript
import type { ExecutionPort } from '@quantbot/core';
import { JitoClient } from '../jito-client.js';

export class JitoExecutionAdapter implements ExecutionPort {
  constructor(private readonly jito: JitoClient) {}

  async execute(request: ExecutionRequest): Promise<ExecutionResult> {
    // Use JitoClient to execute trade
    // ...
  }

  // ... other methods
}
```

## Step 3: Refactor ONE Workflow (The Golden "Ports Workflow")

Pick a workflow with minimal surface area and lots of usage.

### Candidate: OHLCV Ingestion Pipeline ⭐

**Why this workflow**:
- Already has deterministic inputs/outputs
- Ideal for port conversion
- High usage (good test case)

**Goal**:
```typescript
// Before (raw clients):
const candles = await birdeyeClient.fetchOHLCVData(...);
await duckdbStorage.updateOhlcvMetadata(...);
logger.info('Fetched candles', { count: candles.length });

// After (ports):
const candles = await ctx.ports.marketData.fetchOhlcv({ ... });
await ctx.ports.state.set({ key: 'ohlcv:metadata', value: metadata });
ctx.ports.telemetry.emitEvent({ name: 'candles_fetched', level: 'info', message: 'Fetched candles', context: { count: candles.length } });
```

**Zero raw client touches**: Workflow only calls `ctx.ports.*`

## Step 4: Add Architecture Gate (Workflows Must Not Import Raw Clients)

Once you have 1–2 workflows migrated, add ESLint rule in `packages/workflows/src/**` to block:

- `@quantbot/api-clients` direct imports (except adapters)
- `@quantbot/storage` implementation imports (except adapters)
- Any provider SDK import (BirdeyeClient, HeliusClient, etc.)

**ESLint rule**:
```javascript
{
  files: ['packages/workflows/src/**/*.ts'],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@quantbot/api-clients/src',
            message: 'Workflows must use ctx.ports.marketData, not direct API client imports.',
          },
          {
            name: '@quantbot/storage/src',
            message: 'Workflows must use ctx.ports.state, not direct storage imports.',
          },
        ],
        patterns: [
          {
            group: [
              '@quantbot/api-clients/src/**/birdeye*',
              '@quantbot/api-clients/src/**/helius*',
              '@quantbot/storage/src/**/duckdb*',
              '@quantbot/storage/src/**/clickhouse*',
            ],
            message: 'Workflows must use ports, not raw client implementations.',
          },
        ],
      },
    ],
  },
}
```

**This is the "ratchet"**: It makes the migration finish.

## Migration Checklist

### Phase 1: TelemetryPort (Easiest)
- [ ] Create `ConsoleTelemetryAdapter` in `packages/observability/src/adapters/`
- [ ] Update `createProductionContext()` to include `ports.telemetry`
- [ ] Update ONE workflow to use `ctx.ports.telemetry.emitEvent()`
- [ ] Verify telemetry is emitted correctly
- [ ] Update remaining workflows incrementally

### Phase 2: ClockPort (Already Exists)
- [ ] Expose `ports.clock` in `createProductionContext()`
- [ ] Update workflows to use `ctx.ports.clock.nowMs()` instead of `Date.now()`
- [ ] Remove direct `Date.now()` usage from workflows

### Phase 3: StatePort
- [ ] Create `DuckDBStateAdapter` in `packages/storage/src/adapters/`
- [ ] Update `createProductionContext()` to include `ports.state`
- [ ] Update ONE workflow to use `ctx.ports.state.get/set()`
- [ ] Verify state operations work correctly
- [ ] Update remaining workflows incrementally

### Phase 4: MarketDataPort
- [ ] Create `BirdeyeMarketDataAdapter` in `packages/api-clients/src/adapters/`
- [ ] Update `createProductionContext()` to include `ports.marketData`
- [ ] Update OHLCV ingestion workflow to use `ctx.ports.marketData.fetchOhlcv()`
- [ ] Verify market data fetching works correctly
- [ ] Update remaining workflows incrementally

### Phase 5: ExecutionPort (Last)
- [ ] Create `JitoExecutionAdapter` in `packages/api-clients/src/adapters/`
- [ ] Update `createProductionContext()` to include `ports.execution`
- [ ] Update ONE workflow to use `ctx.ports.execution.execute()`
- [ ] Verify execution works correctly
- [ ] Update remaining workflows incrementally

### Phase 6: Architecture Gate
- [ ] Add ESLint rule to block raw client imports in workflows
- [ ] Fix any remaining violations
- [ ] Remove deprecated client access paths from WorkflowContext
- [ ] Update documentation

## Benefits

1. **Testability**: Workflows can be tested with mock ports
2. **Swappability**: Easy to swap providers (Birdeye → Helius, DuckDB → ClickHouse)
3. **Consistency**: All workflows use the same port interface
4. **Maintainability**: Changes to clients don't affect workflows
5. **Observability**: Consistent telemetry across all workflows

## Notes

- Keep existing `repos/ohlcv/simulation` in WorkflowContext for backward compatibility during migration
- Mark old access paths as `@deprecated` once ports are available
- Remove deprecated paths only after all workflows are migrated
- Each port migration is a separate PR for easy review


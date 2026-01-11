# Workflow Architecture

> Architecture patterns and best practices for QuantBot workflows

## Overview

Workflows are the orchestration layer that coordinates storage, services, and I/O operations. They follow a strict contract to ensure testability, determinism, and maintainability.

## Core Principles

### 1. Workflow Contract

Every workflow must:

1. **Validate spec** (Zod schema)
2. **Use WorkflowContext** (dependency injection)
3. **Return JSON-serializable results**
4. **Explicit error policy** (collect vs failFast)

See [WORKFLOW_ENFORCEMENT.md](./WORKFLOW_ENFORCEMENT.md) for contract details.

### 2. Separation of Concerns

**Workflows = Orchestration (Application Layer)**

- Use cases that glue together storage + acquisition + simulation
- Coordinate I/O operations
- Handle error collection and aggregation
- Return structured, serializable results

**Simulation = Pure Compute**

- No I/O, no clocks, no global config
- Given inputs → deterministic outputs
- Testable without I/O chaos contaminating results

**CLI/TUI = Adapters**

- Translate human intent → spec
- Translate result → presentation
- No orchestration logic

### 3. Dependency Injection

**Workflows depend on interfaces, not implementations**

```typescript
// ✅ CORRECT: Use context methods
await ctx.ohlcv.causalAccessor.getCandles(...);
await ctx.repos.simulationRuns.saveRun(...);

// ❌ WRONG: Direct implementation imports
import { PostgresRunRepo } from '@quantbot/storage/src/postgres/run-repo';
import { ClickHouseClient } from '@quantbot/storage/src/clickhouse/client';
```

**Reason**: Keeps DI real, prevents "just this once" imports that metastasize. All dependencies must come through `WorkflowContext`.

## Workflow Patterns

### Pattern 1: Port-Based Workflows

**Use ports for all external dependencies**:

```typescript
export async function ingestOhlcvWorkflow(
  spec: IngestOhlcvSpec,
  ctx: WorkflowContextWithPorts
): Promise<IngestOhlcvResult> {
  // Use ports for all external dependencies
  const candles = await ctx.ports.marketData.fetchOhlcv(...);
  await ctx.ports.state.set('key', 'value');
  ctx.ports.telemetry.emitEvent({ name: 'ingest.complete' });
  
  return { /* JSON-serializable result */ };
}
```

**Benefits**:

- Testable with stubbed ports
- Easy to swap providers (Birdeye → Helius)
- Clear boundaries

### Pattern 2: Context Factory Pattern

**Create context factories for different use cases**:

```typescript
// Production context
export function createProductionContext(
  config?: ProductionContextConfig
): WorkflowContext {
  return {
    clock: systemClock,
    ids: { newRunId: () => generateId() },
    logger: logger,
    repos: createRepos(config),
    ohlcv: createOhlcvService(config),
    simulation: createSimulationService(),
  };
}

// Test context
export function createMockWorkflowContext(
  overrides?: Partial<WorkflowContext>
): WorkflowContext {
  return {
    clock: { nowISO: () => '2024-01-01T00:00:00.000Z' },
    ids: { newRunId: () => 'test-id' },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    repos: { /* mock repos */ },
    ohlcv: { /* mock ohlcv */ },
    simulation: { /* mock simulation */ },
    ...overrides,
  };
}
```

### Pattern 3: Error Collection vs Fail-Fast

**Explicit error policy in spec**:

```typescript
type WorkflowSpec = {
  // ... other fields ...
  errorMode?: 'collect' | 'failFast';
};

export async function myWorkflow(
  spec: WorkflowSpec,
  ctx: WorkflowContext
): Promise<WorkflowResult> {
  const errors: Error[] = [];
  
  for (const item of items) {
    try {
      await processItem(item);
    } catch (error) {
      if (spec.errorMode === 'failFast') {
        throw error; // Stop on first error
      }
      errors.push(error); // Collect errors
    }
  }
  
  return {
    success: errors.length === 0,
    errors: errors.map(e => e.message),
  };
}
```

**Default**: `'collect'` for backward compatibility.

### Pattern 4: JSON-Serializable Results

**All results must be JSON-serializable**:

```typescript
// ✅ CORRECT: Plain objects, ISO strings
type WorkflowResult = {
  runId: string;
  startedAt: string; // ISO string
  completedAt: string; // ISO string
  totals: {
    calls: number;
    successful: number;
  };
};

// ❌ WRONG: Date objects, class instances
type BadResult = {
  startedAt: Date; // Not JSON-serializable
  logger: Logger; // Class instance
};
```

**Validation**: Use Zod schema that enforces JSON-serializable types.

### Pattern 5: Default Parameter Pattern

**Always accept ctx with default parameter**:

```typescript
// ✅ CORRECT: Default parameter pattern
export async function myWorkflow(
  spec: MySpec,
  ctx: WorkflowContext = createDefaultWorkflowContext()
): Promise<MyResult> {
  // ...
}

// ❌ WRONG: Optional with conditional inside function
export async function badWorkflow(
  spec: MySpec,
  ctx?: WorkflowContext
): Promise<MyResult> {
  const actualCtx = ctx ?? createDefaultWorkflowContext(); // Don't do this
  // ...
}
```

**Reason**: Forces defaulting behavior to be explicit and consistent.

## Workflow Context

### WorkflowContext (Base)

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

### WorkflowContextWithPorts (Extended)

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

## Testing Patterns

### Mock Context Pattern

```typescript
import { createMockWorkflowContext } from '@quantbot/workflows/tests/helpers';

describe('myWorkflow', () => {
  it('processes items correctly', async () => {
    const ctx = createMockWorkflowContext({
      repos: {
        calls: {
          list: vi.fn().mockResolvedValue(mockCalls),
        },
      },
    });
    
    const result = await myWorkflow(spec, ctx);
    expect(result).toMatchSnapshot();
  });
});
```

### Golden Test Pattern

```typescript
describe('myWorkflow golden tests', () => {
  it('matches golden snapshot', async () => {
    const ctx = createProductionContext();
    const result = await myWorkflow(spec, ctx);
    expect(result).toMatchSnapshot();
  });
});
```

### Integration Test Pattern

```typescript
describe('myWorkflow integration', () => {
  it('works with real database', async () => {
    const ctx = createProductionContext({
      duckdbPath: './test-data/test.duckdb',
    });
    const result = await myWorkflow(spec, ctx);
    expect(result.success).toBe(true);
  });
});
```

## Enforcement

### ESLint Boundaries

**Forbidden imports in workflows**:

- ❌ `@quantbot/cli` or `@quantbot/tui`
- ❌ Implementation classes (only interfaces/types)
- ❌ Storage implementations (`@quantbot/storage/src/**`)

**Allowed**:

- ✅ `@quantbot/core` (ports, types)
- ✅ `@quantbot/utils` (logger, validation)
- ✅ Public API (`@quantbot/storage`, `@quantbot/ohlcv`)

### Pre-Commit Hooks

**Verify workflow contract compliance**:

- Check workflow signatures use default parameter pattern
- Verify results are JSON-serializable (Zod schema validation)
- Ensure no forbidden imports in workflows

### Code Review Checklist

**Every PR must verify**:

- [ ] Workflows use WorkflowContext for all dependencies
- [ ] Workflow results are JSON-serializable
- [ ] Error policy is explicit in workflow spec
- [ ] Tests use independent math/constants (not prod helpers)
- [ ] No forbidden imports in workflows

## Migration Guide

### Migrating to Port-Based Workflows

**Step 1**: Update workflow signature to use `WorkflowContextWithPorts`:

```typescript
// Before
export async function myWorkflow(
  spec: MySpec,
  ctx: WorkflowContext
): Promise<MyResult> {
  const candles = await ctx.ohlcv.getCandles(...);
}

// After
export async function myWorkflow(
  spec: MySpec,
  ctx: WorkflowContextWithPorts
): Promise<MyResult> {
  const candles = await ctx.ports.marketData.fetchOhlcv(...);
}
```

**Step 2**: Update context creation:

```typescript
// Before
const ctx = createProductionContext();

// After
const ctx = createProductionContextWithPorts();
```

**Step 3**: Update tests:

```typescript
// Before
const ctx = createMockWorkflowContext();

// After
const ctx = createMockWorkflowContextWithPorts();
```

## Related Documentation

- [WORKFLOWS.md](./WORKFLOWS.md) - Complete workflow reference
- [WORKFLOW_ENFORCEMENT.md](./WORKFLOW_ENFORCEMENT.md) - Contract enforcement
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall system architecture
- [packages/workflows/README.md](../../packages/workflows/README.md) - Package documentation

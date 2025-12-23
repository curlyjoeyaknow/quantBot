# Workflow Contract Enforcement

This document describes how workflow rules are enforced and the current implementation status.

## Workflow Contract Compliance

### ✅ 1. Spec Validation (Zod Schema)

**Location**: `packages/workflows/src/ohlcv/ingestOhlcv.ts`

```typescript
export const IngestOhlcvSpecSchema = z.object({
  duckdbPath: z.string().min(1, 'duckdbPath is required'),
  from: z.string().optional(),
  to: z.string().optional(),
  // ... other fields
  errorMode: z.enum(['collect', 'failFast']).optional().default('collect'),
});
```

**Enforcement**: Spec is validated with Zod before processing begins.

### ✅ 2. WorkflowContext (Dependency Injection)

**Location**: `packages/workflows/src/ohlcv/ingestOhlcv.ts`

```typescript
export type IngestOhlcvContext = WorkflowContext & {
  jobs: {
    ohlcvFetch: {
      fetchWorkList: (worklist: OhlcvWorkItem[]) => Promise<Array<...>>;
    };
  };
};
```

**Enforcement**: 
- All dependencies come through `WorkflowContext`
- No direct imports of implementation classes (PostgresRunRepo, ClickHouseClient, etc.)
- Jobs service is accessed via `ctx.jobs.ohlcvFetch.fetchWorkList()`

### ✅ 3. Structured Results (JSON-Serializable)

**Location**: `packages/workflows/src/ohlcv/ingestOhlcv.ts`

```typescript
export type IngestOhlcvResult = {
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

**Enforcement**: 
- All timestamps use ISO strings (not Date objects)
- Results are plain objects (no class instances)
- Results can be serialized to JSON without loss

### ✅ 4. Error Policy (Explicit in Spec)

**Location**: `packages/workflows/src/ohlcv/ingestOhlcv.ts`

```typescript
export type IngestOhlcvSpec = {
  // ... other fields
  errorMode?: 'collect' | 'failFast';
};
```

**Enforcement**: 
- `errorMode: 'failFast'` → throws on first error, stops processing
- `errorMode: 'collect'` → collects errors, continues processing, returns errors in result
- Default is `'collect'` for backward compatibility

### ✅ 5. Default Parameter Pattern

**Location**: `packages/workflows/src/ohlcv/ingestOhlcv.ts`

```typescript
export async function ingestOhlcv(
  spec: IngestOhlcvSpec,
  ctx: IngestOhlcvContext = createDefaultIngestOhlcvContext()
): Promise<IngestOhlcvResult> {
  // ...
}
```

**Enforcement**: 
- Context uses default parameter pattern (not optional with conditional inside function)
- Default context creation is explicit and consistent

## Enforcement Mechanisms

### ✅ ESLint Boundaries

**Location**: `eslint.config.mjs`

**Rules**:
- Workflows cannot import from `@quantbot/cli` or `@quantbot/tui`
- Workflows cannot import implementation classes (only interfaces/types)
- CLI handlers cannot import workflow internals (only public API)

**Status**: ✅ Implemented and enforced

### ✅ Test Harness

**Location**: `packages/workflows/tests/helpers/createTestContext.ts`

**Features**:
- Creates mock WorkflowContext with all dependencies
- Supports real implementations (DuckDB, ClickHouse) for integration tests
- Configurable mocking of external APIs

**Status**: ✅ Implemented

### ⚠️ Workflow Contract Verification Script

**Location**: `scripts/verify-workflow-contract.ts`

**Status**: ✅ Implemented - Verifies workflow contract compliance

### ✅ Pre-Commit Hooks

**Status**: ✅ Implemented - Workflow contract checks run in pre-commit

## Next Steps (Completed)

### ✅ ESLint Boundaries for Workflows Package

**File**: `eslint.config.mjs`

Added configuration to prevent workflows from importing forbidden dependencies:
- Workflows cannot import from CLI/TUI
- Workflows cannot import storage implementations
- CLI handlers cannot import workflow internals

**Status**: ✅ Completed

### ✅ Test Harness

**Status**: ✅ Completed - `createMockContext` exists and is used in tests

### ✅ Workflow Contract Compliance Verification

**Status**: ✅ Completed - `scripts/verify-workflow-contract.ts` exists

## Workflow Candidates

Workflow candidate analysis has been completed. See archived documentation in `docs/archive/workflow-candidates-archived.md` for historical reference.

## Related Documentation

- [ARCHITECTURE_BOUNDARIES.md](./ARCHITECTURE_BOUNDARIES.md) - Architecture boundary enforcement
- [SIMULATION_CONTRACT.md](./SIMULATION_CONTRACT.md) - Simulation engine contract

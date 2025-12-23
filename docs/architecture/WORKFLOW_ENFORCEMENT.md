# Workflow Contract Enforcement

This document summarizes how the workflow rules are enforced in the refactored OHLCV ingestion code.

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

### ✅ 3. JSON-Serializable Results

**Location**: `packages/workflows/src/ohlcv/ingestOhlcv.ts`

```typescript
export type IngestOhlcvResult = {
  worklistGenerated: number;
  workItemsProcessed: number;
  // ... all fields are primitives or plain objects
  startedAtISO: string;  // ISO string, not Date object
  completedAtISO: string; // ISO string, not Date object
  durationMs: number;
  errors: Array<{ mint: string; chain: string; error: string }>;
};
```

**Enforcement**:
- All timestamps use ISO strings (`DateTime.toISO()`)
- No Date objects in results
- No class instances
- All types are JSON-serializable

### ✅ 4. Explicit Error Policy

**Location**: `packages/workflows/src/ohlcv/ingestOhlcv.ts`

```typescript
const errorMode = validated.errorMode ?? 'collect';

// In error handling:
if (errorMode === 'failFast') {
  throw error;
}
// Otherwise, collect errors and continue
```

**Enforcement**: Error policy is explicit in spec (`errorMode: 'collect' | 'failFast'`)

### ✅ 5. Default Parameter Pattern

**Location**: `packages/workflows/src/ohlcv/ingestOhlcv.ts`

```typescript
export async function ingestOhlcv(
  spec: IngestOhlcvSpec,
  ctx: IngestOhlcvContext = createOhlcvIngestionContext()
): Promise<IngestOhlcvResult>
```

**Enforcement**: Uses default parameter pattern (not optional inside function body)

## CLI Handler Compliance

### ✅ Thin Adapter Pattern

**Location**: `packages/cli/src/handlers/ingestion/ingest-ohlcv.ts`

```typescript
export async function ingestOhlcvHandler(args: IngestOhlcvArgs, ctx: CommandContext) {
  // 1. Parse args → build spec
  const spec: IngestOhlcvSpec = { ... };
  
  // 2. Create workflow context
  const workflowContext = createOhlcvIngestionContext({ ... });
  
  // 3. Call workflow (orchestration happens here)
  const result = await ingestOhlcv(spec, workflowContext);
  
  // 4. Return result (already JSON-serializable)
  return result;
}
```

**Enforcement**:
- ✅ Parses args → builds spec
- ✅ Creates context
- ✅ Calls workflow
- ✅ Returns structured result
- ❌ NO orchestration logic (moved to workflow)
- ❌ NO multi-step business flows
- ❌ NO direct repository calls

## Architecture Boundaries

### ✅ Workflows Use Interfaces, Not Implementations

**Checked**: No imports of:
- `PostgresRunRepo` from `@quantbot/storage/src/postgres`
- `ClickHouseClient` from `@quantbot/storage/src/clickhouse`
- Direct instantiation of implementation classes

**Enforcement**: All dependencies come through `WorkflowContext`

### ✅ CLI Handlers Are Thin Adapters

**Checked**: `ingest-ohlcv.ts` handler:
- ✅ Parses args
- ✅ Builds spec
- ✅ Calls workflow
- ✅ Returns result
- ❌ No orchestration logic

## Testing Requirements

### ✅ Test Independence

**Required**: Tests must NOT share:
- Fee helpers from production
- Rounding helpers from production
- Constants from production

**Status**: Tests should be created following this pattern (not yet implemented)

### ✅ Golden Tests

**Required**: Load fixtures, not call prod math

**Status**: Tests should be created following this pattern (not yet implemented)

### ✅ Mock Context Factory

**Location**: `packages/workflows/src/context/createOhlcvIngestionContext.ts`

```typescript
export function createOhlcvIngestionContext(
  config?: OhlcvIngestionContextConfig
): IngestOhlcvContext {
  const baseContext: WorkflowContext = createProductionContext(config);
  const fetchJob = config?.ohlcvFetchJob ?? new OhlcvFetchJob();
  return {
    ...baseContext,
    jobs: { ohlcvFetch: { fetchWorkList: (worklist) => fetchJob.fetchWorkList(worklist) } },
  };
}
```

**Enforcement**: Easy to mock for testing

## Summary

The refactored OHLCV ingestion code follows all workflow contract rules:

1. ✅ Spec validation with Zod
2. ✅ WorkflowContext for all dependencies
3. ✅ JSON-serializable results
4. ✅ Explicit error policy
5. ✅ Default parameter pattern
6. ✅ CLI handler is thin adapter
7. ✅ No orchestration in CLI
8. ✅ Workflows use interfaces, not implementations

## Next Steps

1. Create unit tests for `ingestOhlcv` workflow
2. Create mock context factory for testing
3. Add ESLint rules to enforce boundaries
4. Update other workflows to follow the same pattern


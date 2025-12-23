# Workflow Candidates Analysis

This document identifies packages and handlers that require workflows based on the workflow architecture rules.

## Current Status

### ✅ Already Using Workflows

1. **Simulation Run** (`run-simulation.ts`)
   - ✅ Uses `runSimulation` workflow
   - ✅ Handler is thin adapter

2. **OHLCV Ingestion** (`ingest-ohlcv.ts`)
   - ✅ Uses `ingestOhlcv` workflow
   - ✅ Handler is thin adapter

3. **Telegram JSON Ingestion** (`ingestTelegramJson` workflow exists)
   - ⚠️ Workflow exists but handler doesn't use it
   - Handler: `ingest-telegram.ts` calls `TelegramAlertIngestionService.ingestExport()` directly

## ❌ Need Workflows

### 1. **Telegram Ingestion** (High Priority)

**Current State**:

- Handler: `packages/cli/src/handlers/ingestion/ingest-telegram.ts`
- Calls: `TelegramAlertIngestionService.ingestExport()` directly
- Workflow exists: `packages/workflows/src/telegram/ingestTelegramJson.ts`

**Issue**: Handler bypasses workflow, calls service directly

**Solution**: Update handler to use `ingestTelegramJson` workflow

**Orchestration Steps** (already in workflow):

1. Parse and normalize JSON export
2. Convert normalized messages to ParsedMessage format
3. Build message index
4. Find bot messages
5. Extract bot data, resolve callers, validate, store

---

### 2. **OHLCV Backfill** (Medium Priority)

**Current State**:

- Handler: `packages/cli/src/handlers/ohlcv/backfill-ohlcv.ts`
- Directly calls: `getOhlcvIngestionEngine().fetchCandles()`
- Does orchestration: validation → fetch → return results

**Issue**: Handler does orchestration (validation + fetch + error handling)

**Solution**: Create `backfillOhlcv` workflow

**Orchestration Steps**:

1. Validate mint address and date range
2. Check coverage (optional)
3. Fetch candles from API (via jobs service)
4. Store candles in ClickHouse
5. Return structured results

**Workflow Spec**:

```typescript
type BackfillOhlcvSpec = {
  mint: string;
  chain: Chain;
  interval: '15s' | '1m' | '5m' | '1H';
  from: string; // ISO date
  to: string; // ISO date
  checkCoverage?: boolean;
  errorMode?: 'collect' | 'failFast';
};
```

---

### 3. **DuckDB Simulation** (CRITICAL - High Priority)

**Current State**:

- Handler: `packages/cli/src/handlers/simulation/run-simulation-duckdb.ts`
- **MASSIVE orchestration** (326 lines):
  1. Query DuckDB for calls
  2. Check OHLCV availability (resume mode)
  3. Filter calls by OHLCV availability
  4. Run simulation
  5. Track skipped tokens
  6. Trigger OHLCV ingestion for skipped tokens
  7. Update OHLCV metadata
  8. Mark unrecoverable tokens
  9. Re-run simulation for retry tokens
  10. Merge retry results with original results

**Issue**: This is a **textbook example** of orchestration that belongs in a workflow, not a CLI handler.

**Solution**: Create `runSimulationDuckdb` workflow

**Orchestration Steps**:

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
7. Return structured results

**Workflow Spec**:

```typescript
type RunSimulationDuckdbSpec = {
  duckdbPath: string;
  strategy: string;
  initialCapital: number;
  lookbackMinutes: number;
  lookforwardMinutes: number;
  resume?: boolean;
  batch?: boolean;
  mint?: string; // Single mode
  alertTimestamp?: string; // Single mode
  errorMode?: 'collect' | 'failFast';
  maxRetries?: number; // Default: 1
};
```

**Context Extension**:

```typescript
type RunSimulationDuckdbContext = WorkflowContext & {
  services: {
    simulation: { runSimulation: (config: SimulationConfig) => Promise<SimulationResult> };
    duckdbStorage: { 
      queryCalls: (path: string, limit: number) => Promise<...>;
      checkOhlcvAvailability: (...) => Promise<boolean>;
      updateOhlcvMetadata: (...) => Promise<void>;
      addOhlcvExclusion: (...) => Promise<void>;
    };
    ohlcvIngestion: { ingestForCalls: (params: IngestForCallsParams) => Promise<IngestForCallsResult> };
  };
};
```

---

### 4. **Telegram Pipeline** (Low Priority)

**Current State**:

- Handler: `packages/cli/src/handlers/ingestion/process-telegram-python.ts`
- Calls: `TelegramPipelineService.runPipeline()`
- Simple: Just calls Python tool

**Issue**: Minimal orchestration, but could be workflow for consistency

**Solution**: Optional - could create `runTelegramPipeline` workflow, or keep as-is since it's just a single service call

---

## Summary

### Critical (Must Fix)

1. ✅ **DuckDB Simulation** - 326 lines of orchestration in handler
   - ✅ **COMPLETED**: Created `runSimulationDuckdb` workflow
   - ✅ **COMPLETED**: Updated CLI handler to be thin adapter
   - ✅ **COMPLETED**: All orchestration moved to workflow

### High Priority

2. **Telegram Ingestion** - Workflow exists but handler doesn't use it
   - Easy fix: Update handler to use existing workflow

### Medium Priority

3. **OHLCV Backfill** - Handler does orchestration
   - Should be workflow for consistency

### Low Priority

4. **Telegram Pipeline** - Simple service call
   - Could be workflow for consistency, but not critical

---

## Implementation Order

1. ✅ **OHLCV Ingestion** - Already done
2. 🔄 **Telegram Ingestion** - Update handler to use existing workflow
3. 🔄 **DuckDB Simulation** - Create workflow (critical)
4. 🔄 **OHLCV Backfill** - Create workflow
5. ⏸️ **Telegram Pipeline** - Optional

---

## Notes

- **OhlcvIngestionService.ingestForCalls()** is called from `run-simulation-duckdb.ts`
  - This service method does orchestration but is called from another orchestration
  - Consider: Should `ingestForCalls` be replaced by `ingestOhlcv` workflow?
  - The workflow already handles worklist generation and fetching

- **TelegramAlertIngestionService** and **TelegramCallIngestionService**
  - These are domain services, not workflows
  - They're called by the `ingestTelegramJson` workflow
  - This is correct - workflows orchestrate, services implement domain logic

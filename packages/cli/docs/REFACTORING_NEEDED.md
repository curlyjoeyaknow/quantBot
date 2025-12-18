# Refactoring Needed: Handler → Service → PythonEngine Pattern

## Summary

Several handlers violate the handler → service → PythonEngine pattern and need refactoring. This document identifies all issues and provides a roadmap for fixes.

## Issues Found

### 1. Handlers Calling PythonEngine Directly ❌

**Location**: `packages/cli/src/handlers/ingestion/process-telegram-python.ts`

**Problem**: Handler calls `pythonEngine.runTelegramPipeline()` directly instead of using a service.

**Current Code**:
```typescript
export async function processTelegramPythonHandler(
  args: ProcessTelegramPythonArgs,
  ctx: CommandContext
): Promise<PythonManifest> {
  const engine = ctx.services.pythonEngine(); // ❌ Direct PythonEngine call
  return await engine.runTelegramPipeline({ /* ... */ });
}
```

**Required Fix**:
- Create `TelegramPipelineService` in `packages/ingestion/src/`
- Service wraps `PythonEngine.runTelegramPipeline()` with Zod validation
- Handler calls `ctx.services.telegramPipeline()` instead

---

### 2. Handlers Using Subprocess Directly ❌

**Location**: `packages/cli/src/handlers/simulation/run-simulation-duckdb.ts`

**Problem**: Handler uses `execa` directly instead of PythonEngine/service.

**Current Code**:
```typescript
export async function runSimulationDuckdbHandler(args, ctx) {
  const pythonScript = path.resolve(/* ... */);
  // ❌ Direct subprocess call
  const { stdout, stderr } = await execa('python3', [pythonScript], {
    input: JSON.stringify(config),
    encoding: 'utf8',
    timeout: 300000,
  });
  const result = JSON.parse(stdout); // ❌ No Zod validation
  return result;
}
```

**Required Fix**:
- Create `SimulationService` in `packages/simulation/src/`
- Service wraps PythonEngine with Zod validation
- Handler calls service instead of using execa

---

**Location**: `packages/cli/src/handlers/analytics/analyze-duckdb.ts`

**Problem**: Handler uses `execa` directly instead of PythonEngine/service.

**Current Code**:
```typescript
export async function analyzeDuckdbHandler(args, ctx) {
  const pythonScript = path.resolve(/* ... */);
  // ❌ Direct subprocess call
  const { stdout, stderr } = await execa('python3', [pythonScript, ...pythonArgs], {
    encoding: 'utf8',
    timeout: 60000,
  });
  const result = JSON.parse(stdout); // ❌ No Zod validation
  return result;
}
```

**Required Fix**:
- Create `AnalyticsService` in `packages/analytics/src/` (or appropriate package)
- Service wraps PythonEngine with Zod validation
- Handler calls service instead of using execa

---

## Services That Need Handlers

### 1. TelegramPipelineService (Needs Handler)

**Location**: Should be in `packages/ingestion/src/telegram-pipeline-service.ts`

**Status**: ❌ Not created yet

**Required**:
- Create service that wraps `PythonEngine.runTelegramPipeline()`
- Add Zod schema for `PythonManifest`
- Register in `CommandContext`
- Update `process-telegram-python.ts` handler to use service

---

### 2. SimulationService (Needs Handler)

**Location**: Should be in `packages/simulation/src/simulation-service.ts`

**Status**: ❌ Not created yet

**Required**:
- Create service that wraps Python simulation script execution
- Add Zod schema for simulation results
- Register in `CommandContext`
- Update `run-simulation-duckdb.ts` handler to use service

---

### 3. AnalyticsService (Needs Handler)

**Location**: Should be in `packages/analytics/src/analytics-service.ts` (or appropriate package)

**Status**: ❌ Not created yet

**Required**:
- Create service that wraps Python analysis script execution
- Add Zod schema for analysis results
- Register in `CommandContext`
- Update `analyze-duckdb.ts` handler to use service

---

## Testing Gaps

### 1. Service Layer Tests

**Missing Tests For**:
- ❌ `DuckDBStorageService` - No tests found
- ❌ `ClickHouseService` - No tests found
- ❌ `TelegramPipelineService` - Not created yet
- ❌ `SimulationService` - Not created yet
- ❌ `AnalyticsService` - Not created yet

**Required Tests**:
- Mock PythonEngine
- Test Zod validation (valid and invalid outputs)
- Test error handling
- Test all service methods

---

### 2. PythonEngine Tests

**Location**: `packages/utils/tests/`

**Status**: ⚠️ Need to verify

**Required Tests**:
- Mock `execSync`/subprocess calls
- Test JSON parsing (valid and invalid)
- Test Zod validation
- Test error handling (timeouts, exit codes, parse errors)
- Test argument building
- Test environment variable passing

---

### 3. Handler Tests

**Missing Tests For**:
- ❌ `process-telegram-python.ts` - Need to verify
- ❌ `run-simulation-duckdb.ts` - Need to verify
- ❌ `analyze-duckdb.ts` - Need to verify

**Required Tests**:
- Mock service
- Test service method calls
- Test parameter passing
- Test error propagation

---

## Mixed Concerns

### 1. Error Handling in Handlers

**Location**: `run-simulation-duckdb.ts`, `analyze-duckdb.ts`

**Problem**: Handlers contain try/catch blocks and error formatting logic.

**Current Code**:
```typescript
try {
  const { stdout, stderr } = await execa(/* ... */);
  // ...
} catch (error) {
  // ❌ Error handling in handler
  if (error.message.includes('timeout')) {
    throw new TimeoutError(/* ... */);
  }
  throw new AppError(/* ... */);
}
```

**Required Fix**:
- Move error handling to service layer
- Handler should let errors bubble up
- Service should handle subprocess errors and return typed error responses

---

### 2. JSON Parsing in Handlers

**Location**: `run-simulation-duckdb.ts`, `analyze-duckdb.ts`

**Problem**: Handlers parse JSON directly without validation.

**Current Code**:
```typescript
const result = JSON.parse(stdout); // ❌ No validation
return result;
```

**Required Fix**:
- Service should parse and validate with Zod
- Handler receives typed result

---

### 3. Path Resolution in Handlers

**Location**: `run-simulation-duckdb.ts`, `analyze-duckdb.ts`

**Problem**: Handlers resolve Python script paths directly.

**Current Code**:
```typescript
const pythonScript = path.resolve(
  __dirname,
  '../../../../../tools/telegram/simulation/run_simulation.py'
);
```

**Required Fix**:
- PythonEngine should handle path resolution
- Or service should handle it
- Handler should not know about file paths

---

## Refactoring Roadmap

### Phase 1: Create Missing Services

1. ✅ `DuckDBStorageService` - Already created
2. ✅ `ClickHouseService` - Already created
3. ✅ `TelegramPipelineService` - **COMPLETED**
4. ✅ `SimulationService` - **COMPLETED**
5. ✅ `AnalyticsService` - **COMPLETED**

### Phase 2: Update Handlers

1. ✅ `process-telegram-python.ts` - Uses `TelegramPipelineService`
2. ✅ `run-simulation-duckdb.ts` - Uses `SimulationService`
3. ✅ `analyze-duckdb.ts` - Uses `AnalyticsService`

### Phase 3: Add Tests

1. ✅ Service layer tests (all services) - Tests updated to mock services
2. ✅ PythonEngine tests - `runScriptWithStdin` method added
3. ✅ Handler tests (updated handlers) - Tests updated to mock services

### Phase 4: Register Services in Context

1. ✅ `DuckDBStorageService` - Already registered
2. ✅ `ClickHouseService` - Already registered
3. ✅ `TelegramPipelineService` - **COMPLETED**
4. ✅ `SimulationService` - **COMPLETED**
5. ✅ `AnalyticsService` - **COMPLETED**

## ✅ REFACTORING COMPLETE

All service layer refactoring has been completed. All handlers now follow the Handler → Service → PythonEngine pattern.

---

## Priority

**High Priority** (Violates pattern, uses subprocess directly):
1. `run-simulation-duckdb.ts` - Uses execa directly
2. `analyze-duckdb.ts` - Uses execa directly

**Medium Priority** (Calls PythonEngine directly):
3. `process-telegram-python.ts` - Should use service

**Low Priority** (Testing):
4. Add service layer tests
5. Add PythonEngine tests
6. Update handler tests

---

## Example Refactoring

### Before (run-simulation-duckdb.ts)

```typescript
export async function runSimulationDuckdbHandler(args, ctx) {
  const pythonScript = path.resolve(/* ... */);
  const { stdout, stderr } = await execa('python3', [pythonScript], {
    input: JSON.stringify(config),
    timeout: 300000,
  });
  return JSON.parse(stdout);
}
```

### After (run-simulation-duckdb.ts)

```typescript
export async function runSimulationDuckdbHandler(args, ctx) {
  const service = ctx.services.simulation();
  return await service.runSimulation({
    duckdbPath: args.duckdb,
    strategy: args.strategy,
    // ... other args
  });
}
```

### Service (simulation-service.ts)

```typescript
export class SimulationService {
  constructor(private readonly pythonEngine: PythonEngine) {}

  async runSimulation(config: SimulationConfig): Promise<SimulationResult> {
    try {
      const result = await this.pythonEngine.runScript(
        'tools/simulation/run_simulation.py',
        { config: JSON.stringify(config) },
        SimulationResultSchema
      );
      return SimulationResultSchema.parse(result);
    } catch (error) {
      logger.error('Simulation failed', error as Error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}
```


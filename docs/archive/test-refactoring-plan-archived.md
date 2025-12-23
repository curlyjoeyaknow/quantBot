# Test Refactoring Plan: Real Implementations

## Problem Statement

Current tests use excessive mocking, violating the core testing principle: **"Use Real Implementations: Tests must use the actual production code, not simplified mocks or stubs"**.

This leads to:
- Tests that pass but don't catch real bugs
- False confidence in code quality
- Tests that don't enforce architectural boundaries
- Tests that don't validate actual integration points

## Solution: Three-Tier Testing Strategy

### Tier 1: Unit Tests (`*.test.ts`)
**Purpose**: Fast, isolated testing of pure logic
**Allowed**: Minimal mocks for external boundaries (APIs, databases) ONLY when:
- Testing pure business logic (calculations, transformations)
- External dependency is truly external (third-party API)
- Test would be prohibitively slow with real implementation

**Location**: `tests/unit/` or `tests/*.test.ts`

### Tier 2: Integration Tests (`*.integration.test.ts`)
**Purpose**: Test real system behavior with real implementations
**Required**: 
- Real `PythonEngine` (calls actual Python scripts)
- Real DuckDB files (created with test data)
- Real ClickHouse connections (test instance or in-memory)
- Real `WorkflowContext` with real ports
- Real `CommandContext` with real services

**Location**: `tests/integration/` or `tests/*.integration.test.ts`

**Refactoring Priority**:
1. OHLCV ingestion workflows
2. Simulation workflows
3. Storage operations
4. CLI handlers

### Tier 3: Stress Tests (`*.stress.test.ts`)
**Purpose**: Push system to absolute limits, test failure modes
**Required**: 
- **ALL real implementations** - no mocks except for external APIs (Birdeye, Helius)
- Real DuckDB with realistic data volumes
- Real ClickHouse (test instance)
- Real PythonEngine
- Test actual error recovery, resilience, resource constraints

**Location**: `tests/stress/`

## Implementation Phases

### Phase 1: Test Infrastructure (Foundation)
**Goal**: Create reusable test infrastructure for real implementations

**Tasks**:
1. ✅ Create `createTestDuckDB()` helper (already exists)
2. Create `createTestClickHouse()` helper (test instance or in-memory)
3. Create `createTestWorkflowContext()` helper (real ports, real adapters)
4. Create `createTestCommandContext()` helper (real services)
5. Create test fixtures for common scenarios
6. Create test data generators for realistic test data

**Files to Create**:
- `packages/workflows/tests/helpers/createTestContext.ts`
- `packages/cli/tests/helpers/createTestContext.ts`
- `packages/storage/tests/helpers/createTestClickHouse.ts`
- `packages/workflows/tests/fixtures/` (test data)

### Phase 2: Critical Path Tests (High ROI)
**Goal**: Replace mocks in most critical workflows

**Priority Order**:
1. `ingestOhlcv` workflow (OHLCV ingestion - core functionality)
2. `runSimulationDuckdb` workflow (simulation - core functionality)
3. Storage operations (ClickHouse queries, DuckDB operations)
4. CLI handlers (ingestion, simulation commands)

**Files to Refactor**:
- `packages/workflows/tests/golden/ingestOhlcv.golden.test.ts`
- `packages/workflows/tests/golden/runSimulationDuckdb.golden.test.ts`
- `packages/cli/tests/unit/handlers/ingestion/ingest-ohlcv.test.ts`
- `packages/cli/tests/unit/handlers/simulation/run-simulation-duckdb.test.ts`

### Phase 3: Integration Test Suite (End-to-End)
**Goal**: Create comprehensive integration tests with real implementations

**Tests to Create**:
1. End-to-end OHLCV ingestion: DuckDB → Worklist → API → ClickHouse
2. End-to-end simulation: Strategy → Calls → Candles → Simulation → Results
3. End-to-end CLI commands: Parse → Execute → Format
4. Boundary enforcement: Verify ports are used, not direct clients

**Files to Create**:
- `packages/workflows/tests/integration/ingestOhlcv.integration.test.ts`
- `packages/workflows/tests/integration/runSimulation.integration.test.ts`
- `packages/cli/tests/integration/end-to-end.test.ts`

### Phase 4: Remaining Tests (Complete Coverage)
**Goal**: Convert remaining unit tests to use real implementations

**Files to Refactor**:
- All remaining `*.test.ts` files that use mocks
- Convert to integration tests or remove mocks

## Test Infrastructure Details

### Real DuckDB Instances
```typescript
// packages/workflows/tests/helpers/createTestDuckDB.ts
export async function createTestDuckDB(
  dbPath: string,
  calls: TestCall[]
): Promise<void> {
  // Uses real PythonEngine to create DuckDB with schema and data
  // Tests actual DuckDB operations, not mocks
}
```

### Real ClickHouse Connections
```typescript
// packages/storage/tests/helpers/createTestClickHouse.ts
export async function createTestClickHouse(): Promise<ClickHouseClient> {
  // Creates test ClickHouse instance or uses test database
  // Tests actual ClickHouse operations, not mocks
}
```

### Real WorkflowContext
```typescript
// packages/workflows/tests/helpers/createTestContext.ts
export async function createTestWorkflowContext(
  options?: TestContextOptions
): Promise<WorkflowContextWithPorts> {
  // Creates real WorkflowContext with real ports
  // Uses real adapters (Birdeye, DuckDB, ClickHouse)
  // Only mocks external APIs if necessary
}
```

### Real CommandContext
```typescript
// packages/cli/tests/helpers/createTestContext.ts
export function createTestCommandContext(
  options?: TestContextOptions
): CommandContext {
  // Creates real CommandContext with real services
  // Uses real implementations, not mocks
}
```

## Boundary Enforcement Tests

### Architecture Boundary Tests
```typescript
// packages/workflows/tests/integration/boundaries.test.ts
describe('Architecture Boundaries', () => {
  it('workflows use ports, not direct clients', async () => {
    // Verify workflows call ctx.ports.*, not direct clients
    // This enforces the ports pattern
  });

  it('handlers are pure functions', async () => {
    // Verify handlers don't perform I/O
    // This enforces handler purity
  });
});
```

## Success Criteria

1. **No mocks in integration tests** (except external APIs)
2. **Real implementations in critical path tests**
3. **Tests catch real bugs** (not just pass)
4. **Tests enforce boundaries** (architecture compliance)
5. **Tests provide value** (catch regressions, validate behavior)

## Migration Strategy

1. **Start with infrastructure** (Phase 1)
2. **Migrate one test at a time** (Phase 2)
3. **Verify tests catch bugs** (run mutation tests)
4. **Expand to full suite** (Phase 3-4)

## Timeline

- **Week 1**: Phase 1 (Test Infrastructure)
- **Week 2**: Phase 2 (Critical Path Tests)
- **Week 3**: Phase 3 (Integration Test Suite)
- **Week 4**: Phase 4 (Remaining Tests)


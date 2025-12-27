# Wiring Pattern Exceptions

## Overview

This document lists exceptions to the wiring patterns where direct instantiation is acceptable.

## Composition Roots (Acceptable Direct Instantiation)

### CLI Handlers
**Location**: `packages/cli/src/handlers/**/*.ts`

**Rationale**: Handlers are composition roots - they're the boundary between infrastructure and application.

**Examples**:
- `packages/cli/src/handlers/storage/validate-addresses.ts` - Creates repositories for validation
- `packages/cli/src/handlers/storage/remove-faulty-addresses.ts` - Creates repositories for cleanup
- `packages/cli/src/handlers/ingestion/ensure-ohlcv-coverage.ts` - Creates services for coverage checks
- `packages/cli/src/handlers/research/create-*.ts` - Creates services for research workflows

**Pattern**: Handlers can create repositories/services when:
1. Custom configuration is needed (e.g., custom DuckDB path)
2. Service is not available in CommandContext
3. Handler is a composition root (entry point)

### Context Factories
**Location**: `packages/workflows/src/context/*.ts`

**Rationale**: Context factories are composition roots - they wire dependencies together.

**Examples**:
- `createProductionContext.ts` - Creates repositories and services
- `createProductionContextWithPorts.ts` - Creates ports and adapters
- `createDuckdbSimulationContext.ts` - Creates simulation context
- `createOhlcvIngestionContext.ts` - Creates ingestion context

**Pattern**: Factories can create dependencies directly - this is their purpose.

### Service Constructors
**Location**: `packages/workflows/src/research/services/*.ts`

**Rationale**: Services are composition roots - they orchestrate workflows.

**Examples**:
- `DataSnapshotService.ts` - Creates catalog adapters
- `ExecutionRealityService.ts` - Creates execution adapters

**Pattern**: Services can create adapters when they're the composition root.

### Adapter Factories
**Location**: `packages/workflows/src/**/*Adapter.ts`, `packages/workflows/src/research/simulation-adapter.ts`

**Rationale**: Adapter factories create adapters - this is their purpose.

**Examples**:
- `simulation-adapter.ts` - `createSimulationAdapter()` creates `ResearchSimulationAdapter`
- `executionStubAdapter.ts` - `createExecutionStubAdapter()` creates stub adapter

**Pattern**: Factory functions can create instances directly.

### Workflow Entry Points
**Location**: `packages/workflows/src/**/*.ts` (workflow functions)

**Rationale**: Some workflows create contexts directly - this is acceptable for entry points.

**Examples**:
- `queryCallsDuckdb.ts` - `createQueryCallsDuckdbContext()` creates context
- `ingestTelegramJson.ts` - `createDefaultTelegramJsonIngestContext()` creates context

**Pattern**: Workflow entry points can create contexts directly.

## Non-Composition Roots (Should Use Context)

### Workflow Functions
**Location**: `packages/workflows/src/**/*.ts` (non-entry-point workflows)

**Pattern**: Should use `WorkflowContext` provided as parameter.

**Example**:
```typescript
// ✅ CORRECT: Use context
export async function runSimulation(
  spec: SimulationSpec,
  ctx: WorkflowContext
) {
  const strategies = await ctx.repos.strategies.getByName(spec.strategyName);
  // ...
}

// ❌ WRONG: Direct instantiation
export async function runSimulation(spec: SimulationSpec) {
  const repo = new StrategiesRepository(dbPath); // ❌
  // ...
}
```

### Handler Business Logic
**Location**: `packages/cli/src/handlers/**/*.ts` (business logic, not entry points)

**Pattern**: Should use `CommandContext` services when available.

**Example**:
```typescript
// ✅ CORRECT: Use context
export async function handler(args: Args, ctx: CommandContext) {
  const repo = ctx.services.strategiesRepository();
  // ...
}

// ❌ WRONG: Direct instantiation (unless custom config needed)
export async function handler(args: Args, ctx: CommandContext) {
  const repo = new StrategiesRepository(dbPath); // ❌ (unless custom path)
  // ...
}
```

## Guidelines

### When Direct Instantiation is Acceptable

1. **Composition Roots**: Entry points (handlers, factories, services)
2. **Custom Configuration**: When context doesn't support needed configuration
3. **One-Time Use**: When service is only used once and not worth adding to context
4. **Testing**: Test setup/teardown code

### When to Use Context

1. **Workflow Functions**: Always use `WorkflowContext`
2. **Handler Business Logic**: Use `CommandContext` when service is available
3. **Reusable Code**: Code that might be called from multiple places
4. **Testability**: Code that needs to be testable with mocks

## Enforcement

### Code Review Checklist

- [ ] Is this a composition root? (handler, factory, service constructor)
- [ ] Does context provide this service?
- [ ] Is custom configuration needed?
- [ ] Is this code reusable?

### ESLint Rules (Future)

Consider adding ESLint rules to:
- Warn on direct instantiation in non-composition-root files
- Allow direct instantiation in composition roots
- Document exceptions in comments

## Summary

**Acceptable Direct Instantiation**:
- CLI handlers (composition roots)
- Context factories (composition roots)
- Service constructors (composition roots)
- Adapter factories (composition roots)
- Workflow entry points (composition roots)

**Should Use Context**:
- Workflow functions (non-entry-point)
- Handler business logic (when context provides service)
- Reusable code
- Testable code

---

**Last Updated**: 2025-01-25


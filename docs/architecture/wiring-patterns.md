# Wiring Patterns & Best Practices

## Overview

Wiring is the process of connecting adapters to ports and creating composition roots. This document outlines the patterns and best practices for wiring throughout the QuantBot codebase.

## Core Principles

1. **Composition Roots Only**: Direct instantiation of repositories/adapters should only happen in composition roots
2. **Dependency Injection**: Services should be provided through contexts (CommandContext, WorkflowContext)
3. **No Singletons**: Services are created fresh per context instance (except for connection pooling)
4. **Clear Boundaries**: Infrastructure (adapters) is separate from application logic (handlers/workflows)

## Composition Roots

Composition roots are the entry points where wiring happens. These are the ONLY places where direct instantiation is acceptable:

### 1. CLI Handlers (`packages/cli/src/handlers/**/*.ts`)

CLI handlers are composition roots. They can:
- Read `process.env`
- Do I/O
- Instantiate repositories/adapters when needed
- Use services from `CommandContext`

**Example:**
```typescript
export async function myHandler(args: MyArgs, ctx: CommandContext) {
  // ✅ Use service from context (preferred)
  const repo = ctx.services.strategiesRepository();
  
  // ✅ Direct instantiation is acceptable if context doesn't provide it
  // (but prefer adding to context)
  const customRepo = new CustomRepository(dbPath);
}
```

### 2. Workflow Context Factories (`packages/workflows/src/context/*.ts`)

Context factories create `WorkflowContext` instances with proper wiring:
- `createProductionContext()` - Production context with real adapters
- `createProductionContextWithPorts()` - Production context with ports
- `createDuckdbSimulationContext()` - DuckDB-specific context

**Example:**
```typescript
export function createProductionContext(config?: ProductionContextConfig): WorkflowContext {
  const dbPath = getDuckDBPath('data/tele.duckdb');
  const strategiesRepo = new StrategiesRepository(dbPath); // ✅ OK in factory
  
  return {
    repos: {
      strategies: { /* ... */ }
    }
  };
}
```

### 3. Server Entry Points (`packages/lab/src/server.ts`)

Standalone servers are composition roots. They can:
- Read `process.env`
- Instantiate repositories/adapters directly
- Create their own wiring

**Example:**
```typescript
fastify.get('/api/strategies', async (request, reply) => {
  // ✅ Direct instantiation is acceptable in server (composition root)
  const repo = new StrategiesRepository(duckdbPath);
  const strategies = await repo.list();
  return { strategies };
});
```

### 4. Wiring Scripts (`scripts/lab-sim.wiring.ts`)

Wiring scripts explicitly wire adapters to ports with cataloging/caching decorators.

## CommandContext Pattern

`CommandContext` is the primary composition root for CLI commands. It provides:
- Lazy service creation
- Storage initialization
- Service factory methods

### Adding New Services

When adding a new service to `CommandContext`:

1. Add to `CommandServices` interface
2. Implement in `_createServices()` method
3. Use environment variables for configuration
4. Document the service in comments

**Example:**
```typescript
export interface CommandServices {
  myNewService(): MyNewService;
}

private _createServices(): CommandServices {
  return {
    myNewService: () => {
      const config = process.env.MY_SERVICE_CONFIG || 'default';
      return new MyNewService(config);
    },
  };
}
```

## WorkflowContext Pattern

`WorkflowContext` provides:
- Repositories (via `repos`)
- OHLCV data access (via `ohlcv`)
- Simulation engine (via `simulation`)
- Clock, IDs, logger

Workflows should NOT directly instantiate repositories. They should use the context.

## Anti-Patterns (Don't Do This)

### ❌ Direct Instantiation in Workflows

```typescript
// ❌ BAD: Workflow directly instantiating repository
export async function myWorkflow(spec: MySpec, ctx: WorkflowContext) {
  const repo = new StrategiesRepository(dbPath); // ❌ NO
  // ...
}
```

### ❌ Direct Instantiation in Domain Logic

```typescript
// ❌ BAD: Domain service directly instantiating repository
export class MyDomainService {
  async doSomething() {
    const repo = new StrategiesRepository(dbPath); // ❌ NO
    // ...
  }
}
```

### ❌ Singleton Pattern

```typescript
// ❌ BAD: Using singletons
let _instance: MyService | null = null;
export function getMyService() {
  if (!_instance) {
    _instance = new MyService();
  }
  return _instance;
}
```

## Best Practices

### ✅ Use Context Services

```typescript
// ✅ GOOD: Use service from context
export async function myHandler(args: MyArgs, ctx: CommandContext) {
  const repo = ctx.services.strategiesRepository();
  // ...
}
```

### ✅ Pass Dependencies Through Context

```typescript
// ✅ GOOD: Workflow uses context
export async function myWorkflow(spec: MySpec, ctx: WorkflowContext) {
  const strategy = await ctx.repos.strategies.getByName(spec.name);
  // ...
}
```

### ✅ Create Contexts in Composition Roots

```typescript
// ✅ GOOD: Handler creates context
export async function myHandler(args: MyArgs, ctx: CommandContext) {
  const workflowCtx = await createProductionContextWithPorts();
  return await myWorkflow(spec, workflowCtx);
}
```

## Testing

When testing, use mock contexts:

```typescript
const mockContext: WorkflowContext = {
  repos: {
    strategies: {
      getByName: vi.fn().mockResolvedValue(mockStrategy),
    },
  },
  // ...
};
```

## Summary

- **Composition roots** (handlers, servers, context factories) can instantiate directly
- **Workflows and domain logic** must use contexts
- **CommandContext** is the primary CLI composition root
- **WorkflowContext** is the primary workflow composition root
- **No singletons** - services created fresh per context
- **Clear boundaries** - infrastructure separate from application logic


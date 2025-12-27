# Wiring Migration Guide

> Guide for migrating code to use proper wiring patterns (CommandContext, WorkflowContext)

## Overview

This guide helps you migrate existing code to use proper wiring patterns:

- **CLI Handlers**: Use `CommandContext` for all services
- **Workflows**: Use `WorkflowContext` for all dependencies
- **Composition Roots**: Only place where direct instantiation is acceptable

## Migration Checklist

### For CLI Handlers

- [ ] Handler receives `CommandContext` as parameter
- [ ] All services accessed via `ctx.services.serviceName()`
- [ ] No direct instantiation of repositories/services (unless in composition root)
- [ ] Environment variables read in composition root, passed as data
- [ ] Handler is pure (no `process.env`, no `Date.now()`, no filesystem)

### For Workflows

- [ ] Workflow receives `WorkflowContext` as parameter
- [ ] All repositories accessed via `ctx.repos.*`
- [ ] All services accessed via `ctx.ohlcv.*`, `ctx.simulation.*`, etc.
- [ ] No direct instantiation of repositories/services
- [ ] Results are JSON-serializable
- [ ] Error policy is explicit in spec

## Step-by-Step Migration

### Step 1: Identify Composition Root

**Determine where wiring should happen**:

- CLI handlers → `CommandContext`
- Workflows → `WorkflowContext`
- Server entry points → Custom wiring
- Context factories → Direct instantiation (this is their purpose)

### Step 2: Update Handler/Workflow Signature

**Before**:
```typescript
export async function myHandler(args: MyArgs) {
  const repo = new StrategiesRepository('./data/quantbot.duckdb');
  // ...
}
```

**After**:
```typescript
export async function myHandler(
  args: MyArgs,
  ctx: CommandContext
) {
  const repo = ctx.services.strategiesRepository();
  // ...
}
```

### Step 3: Move Direct Instantiation to Composition Root

**If service doesn't exist in context, add it**:

**CommandContext** (`packages/cli/src/core/command-context.ts`):
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

**WorkflowContext** (`packages/workflows/src/context/createProductionContext.ts`):
```typescript
export function createProductionContext(
  config?: ProductionContextConfig
): WorkflowContext {
  const dbPath = getDuckDBPath('data/tele.duckdb');
  const myRepo = new MyRepository(dbPath); // ✅ OK in factory
  
  return {
    repos: {
      myRepo: {
        // ... methods
      },
    },
  };
}
```

### Step 4: Update Callers

**Update code that calls handlers/workflows**:

**CLI Command** (`packages/cli/src/commands/my-command.ts`):
```typescript
.action(async (options) => {
  const { execute } = await import('../core/execute.js');
  const commandDef = commandRegistry.getCommand('my', 'command');
  if (!commandDef) {
    throw new Error('Command not found in registry');
  }
  await execute(commandDef, options);
});
```

**Workflow Caller**:
```typescript
import { createProductionContext } from '@quantbot/workflows';
import { myWorkflow } from './my-workflow.js';

const ctx = createProductionContext();
const result = await myWorkflow(spec, ctx);
```

### Step 5: Update Tests

**Use mock contexts in tests**:

**Handler Test**:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { myHandler } from '../../src/handlers/my/my-handler.js';

describe('myHandler', () => {
  it('calls service with correct parameters', async () => {
    const list = vi.fn().mockResolvedValue([/* ... */]);
    const fakeCtx = {
      services: {
        myService: () => ({ list }),
      },
    } as any;

    const result = await myHandler(args, fakeCtx);
    expect(list).toHaveBeenCalledWith(/* ... */);
  });
});
```

**Workflow Test**:
```typescript
import { createMockWorkflowContext } from '@quantbot/workflows/tests/helpers';

describe('myWorkflow', () => {
  it('processes items correctly', async () => {
    const ctx = createMockWorkflowContext({
      repos: {
        myRepo: {
          list: vi.fn().mockResolvedValue(mockItems),
        },
      },
    });
    
    const result = await myWorkflow(spec, ctx);
    expect(result).toMatchSnapshot();
  });
});
```

## Common Migration Patterns

### Pattern 1: Moving Repository Instantiation

**Before**:
```typescript
export async function myWorkflow(spec: Spec) {
  const repo = new StrategiesRepository('./data/quantbot.duckdb');
  const strategies = await repo.list();
  // ...
}
```

**After**:
```typescript
export async function myWorkflow(
  spec: Spec,
  ctx: WorkflowContext = createDefaultWorkflowContext()
) {
  const strategies = await ctx.repos.strategies.list();
  // ...
}
```

### Pattern 2: Moving Service Instantiation

**Before**:
```typescript
export async function myHandler(args: Args) {
  const service = new MyService({
    apiKey: process.env.API_KEY,
    endpoint: process.env.ENDPOINT,
  });
  const result = await service.doSomething();
  // ...
}
```

**After**:
```typescript
export async function myHandler(
  args: Args,
  ctx: CommandContext
) {
  const service = ctx.services.myService();
  const result = await service.doSomething();
  // ...
}
```

**Add to CommandContext**:
```typescript
myService: () => {
  return new MyService({
    apiKey: process.env.API_KEY || '',
    endpoint: process.env.ENDPOINT || 'https://api.example.com',
  });
},
```

### Pattern 3: Moving Environment Variable Reads

**Before**:
```typescript
export async function myHandler(args: Args) {
  const dbPath = process.env.DUCKDB_PATH || './data/quantbot.duckdb';
  const repo = new MyRepository(dbPath);
  // ...
}
```

**After**:
```typescript
export async function myHandler(
  args: Args,
  ctx: CommandContext
) {
  // ✅ Environment variables read in composition root
  // ✅ Handler receives service from context
  const repo = ctx.services.myRepository();
  // ...
}
```

### Pattern 4: Moving Clock Usage

**Before**:
```typescript
export async function myWorkflow(spec: Spec) {
  const now = Date.now();
  // ...
}
```

**After**:
```typescript
export async function myWorkflow(
  spec: Spec,
  ctx: WorkflowContext
) {
  const now = ctx.clock.nowISO();
  // ...
}
```

## Verification

### Run Verification Tests

```bash
# Verify handler wiring
pnpm test -- packages/cli/tests/unit/core/command-context-wiring.test.ts

# Verify workflow wiring
pnpm test -- packages/workflows/tests/unit/wiring-patterns.test.ts

# Verify integration wiring
pnpm test -- packages/workflows/tests/integration/wiring-integration.test.ts
```

### Check for Direct Instantiation

**Search for anti-patterns**:
```bash
# Find direct repository instantiation in workflows
grep -r "new.*Repository" packages/workflows/src --exclude-dir=context

# Find direct service instantiation in handlers (should only be in composition roots)
grep -r "new.*Service" packages/cli/src/handlers
```

### Verify Architecture Boundaries

```bash
# Check for forbidden imports
pnpm lint

# Verify ESLint rules
pnpm verify:architecture-boundaries
```

## Troubleshooting

### Issue: Service Not Available in Context

**Solution**: Add service to context factory

1. Add to `CommandServices` interface (for CLI) or `WorkflowContext` (for workflows)
2. Implement in `_createServices()` or context factory
3. Use environment variables for configuration
4. Document the service

### Issue: Circular Dependency

**Solution**: Use dependency injection

- Pass dependencies through context
- Don't import implementations, use interfaces
- Use ports for external dependencies

### Issue: Test Fails After Migration

**Solution**: Update test to use mock context

- Create mock context with required services
- Use `vi.fn()` for service methods
- Verify services are called correctly

## Related Documentation

- [wiring-patterns.md](./wiring-patterns.md) - Wiring patterns and best practices
- [wiring-exceptions.md](./wiring-exceptions.md) - Exceptions to wiring patterns
- [wiring-verification-status.md](./wiring-verification-status.md) - Verification status
- [ARCHITECTURE.md](./ARCHITECTURE.md) - Overall system architecture


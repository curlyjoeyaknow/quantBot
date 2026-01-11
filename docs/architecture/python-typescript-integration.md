# Python-TypeScript Integration Architecture

## Overview

QuantBot uses a **TypeScript-for-orchestration, Python-for-heavy-lifting** architecture:

- **TypeScript**: Orchestration, CLI, API, type safety, service composition
- **Python**: Data science, numerical computation, ClickHouse/DuckDB queries, backtesting

## Directory Structure

```
packages/
├── backtest/
│   ├── src/                    # TypeScript orchestration
│   │   └── services/           # TypeScript services wrapping Python
│   └── python/                 # Python implementation
│       ├── lib/                # Core Python modules
│       ├── scripts/            # Entry point scripts
│       ├── shared/             # Shared utilities
│       └── analysis/           # Analysis tools
├── storage/
│   ├── src/                    # TypeScript orchestration
│   └── python/                 # Python storage tools
├── ingestion/
│   ├── src/                    # TypeScript orchestration
│   └── python/                 # Python ingestion tools
│       └── telegram/           # Telegram parsing
└── utils/
    └── src/python/             # PythonEngine (TS→Python bridge)
```

## Integration Pattern

### 1. Python Script (Entry Point)

```python
# packages/backtest/python/scripts/run_baseline.py
import sys
import json
from packages.backtest.python.lib.v1_baseline_simulator import run_baseline

def main():
    args = parse_args()
    result = run_baseline(args)
    print(json.dumps(result))  # JSON output to stdout

if __name__ == "__main__":
    main()
```

### 2. TypeScript Service (Wrapper)

```typescript
// packages/backtest/src/services/baseline-backtest-service.ts
import { PythonEngine } from '@quantbot/utils';
import { z } from 'zod';

const ResultSchema = z.object({
  success: z.boolean(),
  // ... other fields
});

export class BaselineBacktestService {
  constructor(private readonly pythonEngine: PythonEngine) {}

  async runFullBaseline(config: Config): Promise<Result> {
    const scriptPath = 'packages/backtest/python/scripts/run_baseline.py';
    const result = await this.pythonEngine.runScript(
      scriptPath,
      args,
      ResultSchema,
      {
        timeout: 1800000,
        cwd: join(workspaceRoot, 'packages/backtest/python'),
        env: {
          PYTHONPATH: join(workspaceRoot, 'packages/backtest/python'),
        },
      }
    );
    return result;
  }
}
```

### 3. CLI Handler (Pure Orchestration)

```typescript
// packages/cli/src/handlers/backtest/baseline-python.ts
export async function baselinePythonHandler(args: Args, ctx: CommandContext) {
  await ctx.ensureInitialized();
  const service = ctx.services.baselineBacktest();
  return await service.runFullBaseline(config);
}
```

### 4. CommandContext (Service Factory)

```typescript
// packages/cli/src/core/command-context.ts
export class CommandContext {
  get services(): CommandServices {
    return {
      baselineBacktest: () => new BaselineBacktestService(pythonEngine),
      // ... other services
    };
  }
}
```

## Key Principles

### 1. Boundaries

- **Python scripts live in `packages/*/python/`** (not `tools/`)
- **TypeScript services live in `packages/*/src/services/`**
- **CLI handlers live in `packages/cli/src/handlers/`**

### 2. Data Flow

```
User → CLI → Handler → Service → PythonEngine → Python Script → JSON → Zod → TypeScript
```

### 3. Validation

- **Python**: Validates inputs, computes results, outputs JSON
- **TypeScript**: Validates JSON output with Zod schemas
- **CLI**: Formats output for display

### 4. Error Handling

- **Python**: Exits with non-zero code, writes error to stderr
- **PythonEngine**: Captures stderr, throws AppError
- **Handler**: Lets errors bubble up (no try/catch)
- **Executor**: Catches errors, formats for CLI

## PythonEngine API

```typescript
interface PythonEngine {
  runScript<T>(
    scriptPath: string,
    args: Record<string, unknown>,
    schema: z.ZodSchema<T>,
    options?: {
      timeout?: number;
      cwd?: string;
      env?: Record<string, string>;
    }
  ): Promise<T>;
}
```

## Testing Strategy

### 1. Python Unit Tests

```python
# packages/backtest/python/lib/test_v1_baseline_simulator.py
def test_run_baseline():
    result = run_baseline(config)
    assert result['success'] is True
```

### 2. TypeScript Integration Tests

```typescript
// packages/backtest/src/services/__tests__/baseline-backtest-service.integration.test.ts
it('should run baseline backtest', async () => {
  const service = new BaselineBacktestService(pythonEngine);
  const result = await service.runFullBaseline(config);
  expect(result.success).toBe(true);
});
```

### 3. CLI Handler Tests

```typescript
// packages/cli/src/handlers/__tests__/baseline-python.test.ts
it('should call service with correct parameters', async () => {
  const mockService = { runFullBaseline: vi.fn() };
  const ctx = { services: { baselineBacktest: () => mockService } };
  await baselinePythonHandler(args, ctx);
  expect(mockService.runFullBaseline).toHaveBeenCalledWith(config);
});
```

## Migration Checklist

When adding a new Python tool:

1. ✅ Create Python script in `packages/{package}/python/scripts/`
2. ✅ Create Python modules in `packages/{package}/python/lib/`
3. ✅ Create TypeScript service in `packages/{package}/src/services/`
4. ✅ Define Zod schemas for input/output
5. ✅ Create CLI handler in `packages/cli/src/handlers/{package}/`
6. ✅ Add service to CommandContext
7. ✅ Wire CLI command in `packages/cli/src/commands/{package}.ts`
8. ✅ Add integration tests

## Common Pitfalls

### ❌ Don't: Call PythonEngine directly from handlers

```typescript
// BAD
export async function handler(args, ctx) {
  const engine = ctx.services.pythonEngine();
  return await engine.runScript(...);
}
```

### ✅ Do: Use service layer

```typescript
// GOOD
export async function handler(args, ctx) {
  const service = ctx.services.baselineBacktest();
  return await service.runFullBaseline(config);
}
```

### ❌ Don't: Put Python scripts in `tools/`

```
tools/backtest/run_baseline.py  ❌
```

### ✅ Do: Put Python scripts in `packages/*/python/`

```
packages/backtest/python/scripts/run_baseline.py  ✅
```

### ❌ Don't: Mix business logic in handlers

```typescript
// BAD
export async function handler(args, ctx) {
  const result = await service.run(args);
  const filtered = result.filter(x => x.value > 10);  // ❌ Business logic
  return filtered;
}
```

### ✅ Do: Keep handlers pure orchestration

```typescript
// GOOD
export async function handler(args, ctx) {
  return await service.run(args);
}
```

## Performance Considerations

1. **Subprocess Overhead**: ~50-100ms per Python script invocation
2. **JSON Serialization**: Keep output schemas lean
3. **Timeouts**: Set appropriate timeouts for long-running operations
4. **Connection Pooling**: Use singleton ClickHouse/DuckDB clients in Python

## Future Improvements

1. **gRPC Bridge**: Replace JSON-over-stdout with gRPC for better performance
2. **Python Service Daemon**: Long-running Python process to avoid subprocess overhead
3. **Shared Memory**: Use shared memory for large data transfers
4. **Python Type Stubs**: Generate Python type stubs from Zod schemas


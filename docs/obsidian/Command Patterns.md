# QuantBot Command Patterns

> **Last Updated**: 2025-01-24  
> **Architecture**: Handler → Service → Repository/Port pattern

## Core Patterns

### 1. Handler Pattern (Mandatory)

**Location**: `packages/cli/src/handlers/{package}/{command-name}.ts`

**Rules**:
- ✅ Pure function: `(args: ValidatedArgs, ctx: CommandContext) => Promise<Result>`
- ✅ No `console.log` or `console.error` (use logger if needed)
- ✅ No `process.exit` (let errors bubble up)
- ✅ No `try/catch` (errors handled by executor)
- ✅ No output formatting (returns data only)
- ✅ Gets services from `CommandContext`: `ctx.services.serviceName()`
- ✅ Returns typed data (not formatted strings)

**Example**:
```typescript
export async function myCommandHandler(
  args: MyCommandArgs,
  ctx: CommandContext
) {
  const service = ctx.services.myService();
  return await service.doSomething(args);
}
```

### 2. Command Registration Pattern

**Location**: `packages/cli/src/commands/{package}.ts`

**Pattern**: Use `defineCommand()` wrapper

```typescript
import { defineCommand } from '../core/defineCommand.js';
import { commandRegistry } from '../core/command-registry.js';

const myCmd = program
  .command('my-command')
  .description('My command description')
  .option('--option <value>', 'Option description');

defineCommand(myCmd, {
  name: 'my-command',
  packageName: 'package',
  validate: (opts) => mySchema.parse(opts),
  handler: myCommandHandler,
});

// Register in command registry
const packageModule: PackageCommandModule = {
  packageName: 'package',
  description: 'Package description',
  commands: [
    {
      name: 'my-command',
      description: 'My command description',
      schema: mySchema,
      handler: myCommandHandler,
      examples: ['quantbot package my-command --option value'],
    },
  ],
};

commandRegistry.registerPackage(packageModule);
```

### 3. Command Context Pattern

**Access Services**:
```typescript
// In handler
const service = ctx.services.serviceName();
const result = await service.method(args);
```

**Available Services** (via `CommandContext`):
- `ohlcvIngestion()` - OHLCV ingestion service
- `ohlcvRepository()` - OHLCV repository
- `ohlcvDedup()` - OHLCV deduplication service
- `duckdbStorage()` - DuckDB storage service
- `clickHouse()` - ClickHouse service
- `simulation()` - Simulation service
- `analytics()` - Analytics service
- `pythonEngine()` - Python engine for subprocess calls
- `storageEngine()` - Storage engine abstraction
- `callersRepository()` - Callers repository
- `strategiesRepository()` - Strategies repository
- `experimentRepository()` - Experiment repository
- `runRepository()` - Run repository
- `artifactRepository()` - Artifact repository
- `rawDataRepository()` - Raw data repository
- `canonicalRepository()` - Canonical events repository
- `featureStore()` - Feature store
- `lakeExporter()` - Lake exporter service

### 4. Python/TypeScript Separation Pattern

**When integrating Python tools**:

```
Handler → Service → PythonEngine.run() → Python Script → Zod Validation → Typed Result
```

**Rules**:
- ✅ Handler calls service (not PythonEngine directly)
- ✅ Service wraps PythonEngine with Zod validation
- ✅ Python outputs JSON to stdout
- ✅ TypeScript validates with Zod schemas
- ❌ NO data science logic in TypeScript
- ❌ NO HTTP servers in Python

**Example**:
```typescript
// Handler
export async function myHandler(args, ctx) {
  const service = ctx.services.myPythonService();
  return await service.runPythonTool(args);
}

// Service
export class MyPythonService {
  constructor(private pythonEngine: PythonEngine) {}
  
  async runPythonTool(args) {
    const result = await this.pythonEngine.runScript('tools/my-tool.py', args);
    return MyResultSchema.parse(result);
  }
}
```

### 5. Dataset Registry Pattern (Slice Export)

**For slice export commands**:

```typescript
// Get dataset metadata
const datasetMetadata = datasetRegistry.get(spec.dataset);
if (!datasetMetadata) {
  throw new Error(`Unsupported dataset: ${spec.dataset}`);
}

// Check conditional availability
if (datasetMetadata.conditional) {
  const isAvailable = await datasetRegistry.isAvailable(spec.dataset);
  if (!isAvailable) {
    throw new Error(`Dataset ${spec.dataset} not available`);
  }
}
```

**Supported Datasets**:
- `candles_1s`, `candles_15s`, `candles_1m`, `candles_5m` (candle datasets)
- `indicators_1m` (conditional indicator dataset)

### 6. Schema Validation Pattern

**Zod Schemas**:
```typescript
import { z } from 'zod';

export const myCommandSchema = z.object({
  required: z.string(),
  optional: z.string().optional(),
  number: z.number().int().positive(),
  enum: z.enum(['option1', 'option2']),
  default: z.string().default('default-value'),
});

export type MyCommandArgs = z.infer<typeof myCommandSchema>;
```

**Coercion** (if needed):
```typescript
defineCommand(cmd, {
  name: 'my-command',
  packageName: 'package',
  coerce: (raw) => ({
    ...raw,
    number: raw.number ? coerceNumber(raw.number, 'number') : undefined,
    boolean: raw.boolean ? coerceBoolean(raw.boolean, 'boolean') : false,
  }),
  validate: (opts) => myCommandSchema.parse(opts),
});
```

### 7. Error Handling Pattern

**Handler**: Let errors bubble up
```typescript
export async function myHandler(args, ctx) {
  // No try/catch - errors handled by executor
  const service = ctx.services.myService();
  return await service.method(args);
}
```

**Executor**: Handles all errors
- Formats error messages
- Calls `process.exit(1)` on error
- Logs errors appropriately

### 8. Output Formatting Pattern

**Handler**: Returns data only
```typescript
return {
  success: true,
  data: result,
  count: result.length,
};
```

**Executor**: Formats output based on `--format` option
- `table` - Formatted table (default)
- `json` - JSON output
- `csv` - CSV output

## Anti-Patterns (Never Do This)

### ❌ Handler with CLI concerns
```typescript
export async function badHandler(args, ctx) {
  console.log('Starting...'); // ❌ NO
  try {
    const result = await service.doSomething();
    console.log(formatOutput(result, 'table')); // ❌ NO
    return result;
  } catch (error) {
    console.error('Error:', error); // ❌ NO
    process.exit(1); // ❌ NO
  }
}
```

### ❌ Handler with direct dependencies
```typescript
export async function badHandler(args, ctx) {
  const repo = new CallsRepository(); // ❌ NO - use context
  const service = new SomeService(repo); // ❌ NO - use context
}
```

### ❌ Command file with business logic
```typescript
.action(async (options) => {
  const service = new SomeService(); // ❌ NO - move to handler
  const result = await service.doSomething(); // ❌ NO - move to handler
  console.log(formatOutput(result)); // ❌ NO - executor does this
});
```

## Testing Patterns

### Handler Tests
```typescript
describe('myCommandHandler', () => {
  it('calls service with correct parameters', async () => {
    const mockService = { method: vi.fn().mockResolvedValue({}) };
    const fakeCtx = { services: { myService: () => mockService } } as any;
    
    await myCommandHandler(args, fakeCtx);
    expect(mockService.method).toHaveBeenCalledWith(args);
  });
});
```

### Isolation Test (Litmus Test)
```typescript
it('can be called with plain objects (REPL-friendly)', async () => {
  const handler = await import('./my-handler.js');
  const result = await handler.myCommandHandler(plainArgs, fakeCtx);
  expect(result).toBeDefined();
});
```

## Related Documentation

- [[INDEX]] - Complete command index
- [[OHLCV Fetch]] - OHLCV fetching patterns
- [[Backtesting Workflows]] - Backtest execution patterns
- Architecture rules: `.cursor/rules/10-architecture-ports-adapters.mdc`
- Handler rules: `.cursor/rules/cli-handlers-commands.mdc`


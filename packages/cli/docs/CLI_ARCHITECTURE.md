# CLI Architecture

## Overview

The QuantBot CLI follows a clean separation of concerns pattern that makes commands testable, repeatable, and decoupled from CLI infrastructure.

## Core Principles

**Commands are definitions. Handlers are use-cases. Executor handles side effects. Context provides dependencies.**

## The Four Layers

### 1. Command Definitions (`src/commands/*.ts`)

**Purpose**: Metadata only - schema, description, examples, handler pointer.

**Responsibilities**:
- Define Zod schemas for argument validation
- Define command descriptions and examples
- Register commands in `commandRegistry`
- Add Commander.js options (for CLI)
- Wire Commander actions to `execute()`

**What it does NOT do**:
- ❌ Business logic
- ❌ Service instantiation
- ❌ Output formatting
- ❌ Error handling with `process.exit`
- ❌ Console output

**Example**:
```typescript
export const analyzeSchema = z.object({
  caller: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

const analyticsModule: PackageCommandModule = {
  packageName: 'analytics',
  description: 'Analytics and performance metrics',
  commands: [
    {
      name: 'analyze',
      description: 'Analyze calls with metrics',
      schema: analyzeSchema,
      handler: async (args: unknown, ctx: CommandContext) => {
        const typedArgs = args as z.infer<typeof analyzeSchema>;
        return await analyzeAnalyticsHandler(typedArgs, ctx);
      },
      examples: ['quantbot analytics analyze --caller Brook'],
    },
  ],
};
```

### 2. Handlers (`src/handlers/{package}/{command-name}.ts`)

**Purpose**: Pure use-case functions - orchestrate domain services.

**Responsibilities**:
- Take validated args (already Zod-checked) + CommandContext
- Get services from context
- Call service methods
- Return data (not formatted output)

**What it does NOT do**:
- ❌ Commander.js
- ❌ `console.log` / `console.error`
- ❌ `process.exit`
- ❌ Environment variable reads
- ❌ Try/catch (let errors bubble up)
- ❌ Output formatting

**Example**:
```typescript
export async function analyzeAnalyticsHandler(
  args: AnalyzeArgs,
  ctx: CommandContext
) {
  const engine = ctx.services.analyticsEngine();
  
  return engine.analyzeCalls({
    callerNames: args.caller ? [args.caller] : undefined,
    from: args.from ? DateTime.fromISO(args.from).toJSDate() : undefined,
    to: args.to ? DateTime.fromISO(args.to).toJSDate() : undefined,
  });
}
```

**Handler should feel underwhelming** - if it's complex, move logic to domain services.

### 3. Executor (`src/core/execute.ts`)

**Purpose**: Centralize all CLI glue - the only place with side effects.

**Responsibilities**:
- Normalize options (handles `--flag value` and `--flag=value`)
- Parse and validate arguments (Zod)
- Create CommandContext
- Ensure storage initialization
- Call handler
- Format output
- Handle errors
- Call `process.exit` on error

**Example**:
```typescript
export async function execute(
  commandDef: CommandDefinition,
  rawOptions: Record<string, unknown>
): Promise<void> {
  try {
    const normalized = normalizeOptions(rawOptions);
    const args = parseArguments(commandDef.schema, normalized);
    
    const ctx = new CommandContext();
    await ctx.ensureInitialized();
    
    const format = (args as { format?: OutputFormat }).format ?? 'table';
    const handlerArgs = { ...(args as Record<string, unknown>) };
    if ('format' in handlerArgs) {
      delete (handlerArgs as { format?: OutputFormat }).format;
    }
    
    const result = await commandDef.handler(handlerArgs, ctx);
    const output = formatOutput(result, format);
    console.log(output);
  } catch (error) {
    const message = handleError(error);
    console.error(`Error: ${message}`);
    process.exit(1);
  }
}
```

### 4. Command Context (`src/core/command-context.ts`)

**Purpose**: Lazy service creation and dependency injection.

**Responsibilities**:
- Provide services via `ctx.services.serviceName()`
- Handle storage initialization
- Support service overrides (for testing/Python integration)

**Example**:
```typescript
// Default usage
const ctx = new CommandContext();
const service = ctx.services.analyticsEngine();

// With overrides (for testing)
const ctx = createCommandContext({
  analyticsEngineOverride: mockEngine,
});
```

## Schema Ownership

**Best Practice**: Schemas live in `src/command-defs/{package}.ts`

This prevents circular dependencies:
- `commands/*.ts` imports schemas for CLI help/options
- `handlers/*.ts` imports schemas for types
- No "commands own schemas, handlers depend on commands" circularity

**Example**:
```typescript
// src/command-defs/analytics.ts
export const analyzeSchema = z.object({ /* ... */ });
export type AnalyzeArgs = z.infer<typeof analyzeSchema>;

// src/commands/analytics.ts
import { analyzeSchema } from '../command-defs/analytics.js';

// src/handlers/analytics/analyze-analytics.ts
import { analyzeSchema, type AnalyzeArgs } from '../../command-defs/analytics.js';
```

## Testing

### Handler Tests

**Location**: `tests/unit/handlers/{package}/{command-name}.test.ts`

**Required tests**:
1. ✅ Calls service with correct parameters
2. ✅ Handles optional parameters
3. ✅ Propagates errors (no try/catch in handler)
4. ✅ Parameter conversion (e.g., string dates → Date objects)
5. ✅ Isolation test - can be called with plain objects (REPL-friendly)

### Litmus Test

**Handler must pass this test**:
- Can be imported into a REPL
- Can be called with plain objects (no CLI infrastructure)
- Returns deterministic results

If handler fails this test, it's still coupled to CLI infrastructure.

## Registry Smoke Test

**Location**: `tests/unit/command-registry-smoke.test.ts`

Ensures every registered command has:
- ✅ Schema
- ✅ Handler
- ✅ Executor wiring
- ✅ Doesn't throw when building CLI

This catches "added a command but forgot to wire it" regressions instantly.

## Migration Checklist

When refactoring an existing command:

1. ✅ Create handler file in `src/handlers/{package}/{command-name}.ts`
2. ✅ Move business logic to handler (remove from command file)
3. ✅ Remove service instantiation from command file
4. ✅ Remove formatting from command file
5. ✅ Remove try/catch + process.exit from command file
6. ✅ Wire command action to `execute()`
7. ✅ Update registry entry to use handler
8. ✅ Write unit tests for handler
9. ✅ Write isolation test (litmus test)
10. ✅ Verify handler can be called directly (no CLI)

## Why This Pattern?

1. **Testability**: Handlers can be tested without CLI infrastructure
2. **Repeatability**: Handlers can be called from scripts, REPL, or other contexts
3. **Separation of Concerns**: CLI glue is separate from business logic
4. **Maintainability**: Changes to CLI don't affect business logic
5. **Reusability**: Handlers can be used programmatically
6. **Future-Proof**: Easy to integrate Python/DuckDB tools through the same pattern

## Future: Python/DuckDB Integration

When integrating Python/DuckDB tools:

```
handler → service → PythonEngine.run() → output validated by Zod → artifacts referenced by manifest
```

The current handler setup is already the perfect skeleton for that.

## Enforcement

**This pattern is MANDATORY for all new commands.**

See `.cursor/rules/packages-cli-handlers.mdc` for detailed rules and anti-patterns.


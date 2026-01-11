# CLI Commands, Handlers, and Workflows Structure

## Overview

The QuantBot project has a clear separation between:
- **CLI Commands** - User-facing command definitions
- **Handlers** - Pure use-case functions
- **Workflows** - Standalone orchestration scripts

## Directory Structure

```
packages/cli/
├── src/
│   ├── commands/          # Command definitions (metadata only)
│   │   ├── analytics.ts
│   │   ├── simulation.ts
│   │   ├── ingestion.ts
│   │   └── ...
│   │
│   └── handlers/          # Pure use-case functions
│       ├── analytics/
│       │   └── analyze-analytics.ts
│       ├── simulation/
│       │   └── run-simulation.ts
│       ├── ingestion/
│       │   └── ingest-ohlcv.ts
│       └── ...
│
scripts/
└── workflows/            # Standalone workflow scripts
    ├── run-simulation.ts
    ├── fetch-ohlcv.ts
    ├── ingest-telegram-json.ts
    └── ...
```

## The Three Layers

### 1. Commands (`packages/cli/src/commands/`)

**Purpose**: Metadata only - schema, description, examples, handler pointer.

**What they do**:
- ✅ Define Zod schemas for argument validation
- ✅ Define command descriptions and examples
- ✅ Register commands in `commandRegistry`
- ✅ Add Commander.js options (for CLI)
- ✅ Wire Commander actions to `execute()`

**What they DON'T do**:
- ❌ Business logic
- ❌ Service instantiation
- ❌ Output formatting
- ❌ Error handling with `process.exit`

**Example**: `packages/cli/src/commands/simulation.ts`

### 2. Handlers (`packages/cli/src/handlers/`)

**Purpose**: Pure use-case functions - orchestrate domain services.

**What they do**:
- ✅ Take validated args (already Zod-checked) + CommandContext
- ✅ Get services from context
- ✅ Call service methods
- ✅ Return data (not formatted output)

**What they DON'T do**:
- ❌ Commander.js
- ❌ `console.log` / `console.error`
- ❌ `process.exit`
- ❌ Environment variable reads
- ❌ Try/catch (let errors bubble up)
- ❌ Output formatting

**Example**: `packages/cli/src/handlers/simulation/run-simulation.ts`

### 3. Workflows (`scripts/workflows/`)

**Purpose**: Standalone orchestration scripts that can be run directly.

**What they do**:
- ✅ Can be run directly with `tsx scripts/workflows/...`
- ✅ May use workflows from `@quantbot/workflows` package
- ✅ May call handlers programmatically
- ✅ Handle their own initialization and error handling

**Example**: `scripts/workflows/run-simulation.ts`

## Relationship Between Layers

```
User Command
    ↓
CLI Command Definition (metadata)
    ↓
Executor (validates, creates context)
    ↓
Handler (pure function, gets services from context)
    ↓
Domain Services (business logic)
```

## When to Use Each

### Use CLI Commands + Handlers when:
- Creating a user-facing CLI command
- Need argument validation
- Want consistent error handling
- Need to be testable in isolation

### Use Workflow Scripts when:
- One-off data processing tasks
- Batch operations
- Research/experimentation
- Scripts that don't need CLI interface

## Examples

### CLI Command Flow

```typescript
// 1. Command Definition (packages/cli/src/commands/simulation.ts)
export const runSchema = z.object({
  strategy: z.string(),
  mint: z.string(),
});

const simulationModule: PackageCommandModule = {
  packageName: 'simulation',
  commands: [
    {
      name: 'run',
      schema: runSchema,
      handler: async (args, ctx) => {
        return await runSimulationHandler(args, ctx);
      },
    },
  ],
};

// 2. Handler (packages/cli/src/handlers/simulation/run-simulation.ts)
export async function runSimulationHandler(
  args: RunSimulationArgs,
  ctx: CommandContext
) {
  const service = ctx.services.simulation();
  return service.runSimulation({
    strategy: args.strategy,
    mint: args.mint,
  });
}

// 3. User runs: quantbot simulation run --strategy PT2 --mint So111...
```

### Workflow Script Flow

```typescript
// scripts/workflows/run-simulation.ts
import { runSimulationWorkflow } from '@quantbot/workflows';

async function main() {
  const result = await runSimulationWorkflow({
    strategy: 'PT2',
    mint: 'So111...',
  });
  console.log(result);
}

main().catch(console.error);
```

## Key Differences

| Aspect | Commands | Handlers | Workflows |
|--------|----------|----------|-----------|
| **Location** | `packages/cli/src/commands/` | `packages/cli/src/handlers/` | `scripts/workflows/` |
| **Purpose** | CLI metadata | Pure functions | Standalone scripts |
| **Can run directly?** | No (via CLI) | No (via executor) | Yes (`tsx scripts/...`) |
| **Has CLI interface?** | Yes | No | No |
| **Testable?** | Via CLI tests | Unit tests | Integration tests |
| **Error handling** | Via executor | Let bubble up | Own try/catch |

## Architecture Rules

1. **Handlers are pure** - No side effects, no CLI concerns
2. **Commands are metadata** - No business logic
3. **Workflows are standalone** - Can run independently
4. **Executor centralizes side effects** - Only place with `process.exit`, formatting, etc.

## See Also

- `packages/cli/docs/CLI_ARCHITECTURE.md` - Full CLI architecture docs
- `.cursor/rules/packages-cli-handlers.mdc` - Handler pattern rules
- `.cursor/rules/workflows.mdc` - Workflow rules


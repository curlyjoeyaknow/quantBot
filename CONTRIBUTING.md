# Contributing to QuantBot

Thank you for your interest in contributing to QuantBot! This guide will help you get started.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Development Setup](#development-setup)
3. [Code Style & Architecture](#code-style--architecture)
4. [Testing Requirements](#testing-requirements)
5. [Pull Request Process](#pull-request-process)
6. [Architecture Rules](#architecture-rules)
7. [Common Patterns](#common-patterns)

---

## Getting Started

### Prerequisites

- **Node.js** 18+ and npm/pnpm
- **Docker** and Docker Compose (for databases)
- **Git** for version control
- **Python 3.8+** (for DuckDB integration scripts)
- Basic understanding of TypeScript, monorepos, and trading/simulation concepts

### Quick Setup

```bash
# Clone the repository
git clone <repository-url>
cd quantBot

# Install dependencies
pnpm install

# Copy environment template
cp env.example .env

# Edit .env with your API keys (see README.md for details)
nano .env

# Start databases
docker-compose up -d

# Build all packages (in correct dependency order)
pnpm build:ordered

# Run tests to verify setup
pnpm test
```

---

## Development Setup

### Project Structure

QuantBot is a **monorepo** using pnpm workspaces:

```text
packages/
├── core/           # Foundation types (no dependencies)
├── utils/          # Shared utilities (depends on core)
├── storage/        # Storage layer (DuckDB, ClickHouse)
├── observability/  # Logging, metrics
├── api-clients/    # External API clients
├── ohlcv/          # OHLCV data services
├── analytics/      # Analytics engine
├── ingestion/      # Data ingestion
├── simulation/     # Pure simulation engine (NO I/O)
├── workflows/      # Workflow orchestration
├── cli/            # Command-line interface
└── tui/            # Terminal UI
```

### Build Order

Packages **must** be built in dependency order:

```bash
# Build all packages in correct order
pnpm build:ordered

# Build individual package (ensure dependencies are built first)
pnpm --filter @quantbot/utils build
pnpm --filter @quantbot/storage build
pnpm --filter @quantbot/workflows build
```

See [Build Ordering Rules](.cursor/rules/build-ordering.mdc) for details.

### Development Workflow

```bash
# Run tests in watch mode
pnpm test:watch

# Run linting
pnpm lint

# Auto-fix linting issues
pnpm lint:fix

# Format code
pnpm format

# Type checking
pnpm typecheck
```

### Git Hooks

Pre-commit hooks run automatically:

- Formatting check (`npm run format:check`)
- Linting check (`npm run lint:fix`)
- Type checking (`npm run typecheck`)
- Workflow contract verification
- Dependency boundary checks

To skip hooks (use with caution):

```bash
git commit --no-verify
```

---

## Code Style & Architecture

### Architecture Principles

QuantBot follows strict architectural boundaries:

1. **Simulation is pure compute** - No I/O, no clocks, no global config
2. **Workflows coordinate I/O** - All multi-step business logic lives in `@quantbot/workflows`
3. **CLI handlers are thin adapters** - Parse args → call workflow → format output
4. **Handlers depend on ports** - Use dependency injection, not direct imports

### Package Dependencies

**Allowed:**

- ✅ Downstream packages can import upstream packages
- ✅ Services depend on infrastructure packages
- ✅ Workflows depend on services and infrastructure

**Forbidden:**

- ❌ Workflows cannot import from `@quantbot/cli` or `@quantbot/tui`
- ❌ Workflows cannot import storage implementations directly
- ❌ CLI handlers cannot import workflow internals
- ❌ Circular dependencies between packages

See [Architecture Boundaries](docs/ARCHITECTURE_BOUNDARIES.md) for enforcement details.

### Code Style

- **TypeScript strict mode** - All code must be type-safe
- **Async/await** - Prefer async/await over callbacks or promises
- **Functional patterns** - Use functional patterns where appropriate
- **Explicit types** - Prefer explicit types over inference when it improves clarity
- **No `any` types** - Use `unknown` and type guards instead

### File Naming

- **Files**: `kebab-case.ts`
- **Classes/Interfaces**: `PascalCase`
- **Functions/Variables**: `camelCase`
- **Constants**: `UPPER_SNAKE_CASE`

### Import Order

1. External dependencies (Node.js, npm packages)
2. Internal package imports (`@quantbot/...`)
3. Relative imports (`./`, `../`)
4. Type imports (use `import type` when importing only types)

---

## Testing Requirements

### Test Philosophy

**Tests are the specification, not validation.**

- Write invariants **BEFORE** implementation
- Tests guide development
- Every PR includes tests
- Design tests to fail - push implementations to their limits

### Test Types

1. **Unit Tests** - Fast, isolated, deterministic (80%+ coverage target)
2. **Integration Tests** - API/DB boundaries, realistic data
3. **Property Tests** - Math operations, invariants
4. **Fuzzing Tests** - Parsers, external input
5. **Stress Tests** - Push systems to absolute limits
6. **Regression Tests** - **MANDATORY for all bug fixes**

### Test Requirements by Change Type

| Change Type           | Required Tests        |
| --------------------- | --------------------- |
| Financial calculation | unit + property       |
| Parser                | unit + fuzzing        |
| Database              | integration           |
| API endpoint          | integration + unit    |
| Mint handling         | unit + property       |
| Async operation       | unit + concurrency    |
| Retry logic           | unit + integration    |
| Bug fix               | **regression + unit** |
| Other                 | unit                  |

### Regression Tests (MANDATORY)

**After finding and fixing a bug, you MUST create tests that would have detected the bug.**

See [Debugging and Regression Test Rules](.cursor/rules/debugging-regression-test.mdc) for details.

**Required:**

- Test the specific failure mode
- Test edge cases related to the bug
- Document what the test prevents (use `CRITICAL:` comments)
- Test should fail with old buggy code (if possible)

### Handler Tests (CLI)

CLI handler tests must be **REPL-friendly**:

```typescript
// ✅ CORRECT: Handler can be called with plain objects
import { ingestOhlcvHandler } from '../../../../src/handlers/ingestion/ingest-ohlcv.js';

const result = await ingestOhlcvHandler({ from: '2024-01-01', to: '2024-02-01' }, mockContext);
```

**Forbidden:**

- ❌ Handlers with CLI infrastructure dependencies
- ❌ Tests that require Commander.js
- ❌ Tests that require process.exit

### Test Independence

**Tests must NOT share production math helpers.**

If a test needs fee math, either:

- Hard-code expected numeric values, OR
- Compute independently inside the test file

**Reason:** Prevents "tests pass because they repeat the same mistake as prod."

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run with coverage
pnpm test:coverage

# Run specific package tests
pnpm --filter @quantbot/cli test

# Run specific test file
pnpm test packages/cli/tests/unit/handlers/ingestion/ingest-ohlcv.test.ts
```

---

## Pull Request Process

### Before Submitting

1. **Update CHANGELOG.md** - Document your changes
2. **Write tests** - Ensure all tests pass
3. **Run linting** - `pnpm lint:fix`
4. **Run type checking** - `pnpm typecheck`
5. **Verify build** - `pnpm build:ordered`

### PR Checklist

- [ ] Unit tests for all new functions
- [ ] **Regression tests for bug fixes** (mandatory)
- [ ] Property tests for financial calculations
- [ ] Handler tests for CLI commands (REPL-friendly)
- [ ] No forbidden imports (workflows can't import CLI)
- [ ] CLI handlers are thin adapters
- [ ] Workflow results are JSON-serializable
- [ ] CHANGELOG.md updated
- [ ] Documentation updated (if needed)
- [ ] Build passes (`pnpm build:ordered`)
- [ ] All tests pass (`pnpm test`)

### Commit Messages

Follow conventional commits:

```
feat: Add new OHLCV endpoint
fix: Resolve SQLite migration bug
docs: Update DuckDB schema documentation
test: Add regression tests for mint address handling
refactor: Simplify workflow orchestration
```

### PR Description

Include:

- **What** - What changes are being made
- **Why** - Why these changes are needed
- **How** - Brief overview of implementation approach
- **Testing** - How the changes were tested

### Code Review

PRs require:

- At least one approval
- All CI checks passing
- No linting errors
- All tests passing

---

## Architecture Rules

### Workflow Pattern

**All multi-step business logic must go through workflows:**

```typescript
// ❌ WRONG: CLI handler with orchestration
export async function badHandler(args, ctx) {
  const calls = await ctx.repos.calls.findByRange(args.from, args.to);
  for (const call of calls) {
    const candles = await ctx.ohlcv.fetchCandles(call.mint);
    const result = await ctx.simulation.run(candles, args.strategy);
    await ctx.repos.runs.save(result); // ❌ Orchestration in handler
  }
}

// ✅ CORRECT: CLI handler calls workflow
export async function goodHandler(args, ctx) {
  const service = ctx.services.simulationWorkflow();
  return service.runSimulationForCalls(args); // Returns data, not formatted output
}
```

### Handler Pattern

**CLI handlers are pure use-case functions:**

```typescript
// ✅ CORRECT: Pure handler
export async function ingestOhlcvHandler(args: IngestOhlcvArgs, ctx: CommandContext) {
  const service = ctx.services.ohlcvIngestion();
  return service.ingestForCalls({
    from: args.from ? new Date(args.from) : undefined,
    to: args.to ? new Date(args.to) : undefined,
  });
}

// ❌ WRONG: Handler with CLI concerns
export async function badHandler(args, ctx) {
  console.log('Processing...'); // ❌ NO console output
  try {
    const result = await service.doSomething();
    console.log(formatOutput(result, 'table')); // ❌ NO formatting
    return result;
  } catch (error) {
    console.error('Error:', error); // ❌ NO error handling
    process.exit(1); // ❌ NO process.exit
  }
}
```

**Forbidden in handlers:**

- ❌ `console.log` / `console.error`
- ❌ `process.exit`
- ❌ `try/catch` (let errors bubble up)
- ❌ Output formatting (executor handles this)
- ❌ Direct service instantiation (use context)

### Python Integration Pattern

**Services wrap PythonEngine with Zod validation:**

```typescript
// ✅ CORRECT: Service wraps PythonEngine
export class DuckDBStorageService {
  constructor(private readonly pythonEngine: PythonEngine) {}

  async storeStrategy(...): Promise<StrategyStorageResult> {
    const result = await this.pythonEngine.runDuckDBStorage({...});
    return StrategyStorageResultSchema.parse(result); // Validate with Zod
  }
}

// ❌ WRONG: Handler calling PythonEngine directly
export async function badHandler(args, ctx) {
  const engine = ctx.services.pythonEngine(); // ❌ NO
  return await engine.runDuckDBStorage({...}); // ❌ NO
}
```

### Mint Address Handling

**⚠️ NEVER MODIFY MINT ADDRESSES**

- ❌ No truncation, case changes, or string manipulation
- ✅ Store/pass full 32-44 char addresses, preserve exact case
- ✅ Truncate ONLY for display/logging, never for storage/API calls

---

## Common Patterns

### Creating a New CLI Command

1. **Create handler** (`packages/cli/src/handlers/{package}/{command-name}.ts`)
   - Pure function
   - Takes validated args + CommandContext
   - Returns data (not formatted output)

2. **Create command definition** (`packages/cli/src/commands/{package}.ts`)
   - Define Zod schema
   - Define command description
   - Register in commandRegistry
   - Wire to `execute()` function

3. **Add to CommandContext** (`packages/cli/src/core/command-context.ts`)
   - Add service factory method

4. **Write tests** (`packages/cli/tests/unit/handlers/{package}/{command-name}.test.ts`)
   - Test handler directly (no CLI infrastructure)
   - Test parameter conversion
   - Test error propagation

### Creating a New Workflow

1. **Create workflow function** (`packages/workflows/src/{domain}/{workflow-name}.ts`)
   - Accept `spec` (Zod-validated) and `ctx` (WorkflowContext)
   - Use `ctx` for all dependencies
   - Return JSON-serializable result

2. **Create context factory** (`packages/workflows/src/{domain}/context.ts`)
   - Factory function that creates WorkflowContext
   - Handles storage initialization
   - Provides all dependencies

3. **Write tests** (`packages/workflows/tests/{domain}/{workflow-name}.test.ts`)
   - Mock WorkflowContext
   - Test workflow steps
   - Verify result shape

### Adding a New Package

1. **Create package directory** (`packages/{package-name}/`)

2. **Create `package.json`**
   - Use `workspace:*` for internal dependencies
   - Declare dependencies in correct build order

3. **Add to root `build:ordered` script** (if in first 10 packages)

4. **Configure TypeScript project references**

5. **Add package to workspace** (`pnpm-workspace.yaml`)

---

## Resources

### Documentation

- [Architecture Overview](docs/ARCHITECTURE.md)
- [Architecture Boundaries](docs/ARCHITECTURE_BOUNDARIES.md)
- [DuckDB Schema](docs/DUCKDB_SCHEMA.md)
- [Workflow Patterns](.cursor/rules/packages-workflows.mdc)
- [CLI Handler Patterns](.cursor/rules/packages-cli-handlers.mdc)
- [Testing Rules](.cursor/rules/testing.mdc)

### Architecture Rules (`.cursor/rules/`)

- `build-ordering.mdc` - Package build order
- `packages-workflows.mdc` - Workflow patterns
- `packages-cli-handlers.mdc` - CLI handler patterns
- `testing.mdc` - Testing philosophy
- `debugging-regression-test.mdc` - Regression test requirements

### Getting Help

- Open an issue on GitHub
- Review existing documentation
- Check `.cursor/rules/` for architecture guidance
- Ask questions in PR comments

---

## Code of Conduct

- Be respectful and inclusive
- Provide constructive feedback
- Help others learn and grow
- Follow the project's architecture and patterns

---

Thank you for contributing to QuantBot! 🚀

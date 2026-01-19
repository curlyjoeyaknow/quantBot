# Contributing to QuantBot

Thank you for your interest in contributing to QuantBot! This guide will help you get started.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Development Setup](#development-setup)
3. [Git Workflow & Branching Strategy](#git-workflow--branching-strategy)
4. [Code Style & Architecture](#code-style--architecture)
5. [Testing Requirements](#testing-requirements)
6. [Pull Request Process](#pull-request-process)
7. [Architecture Rules](#architecture-rules)
8. [Common Patterns](#common-patterns)

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

### Git Workflow & Branching Strategy

QuantBot uses an **integration branch** workflow designed for worktrees and feature development.

#### The One Rule That Makes This Work

**⚠️ Never develop directly on `integration`.**

`integration` is a **merge target, not a workbench**.

- ✅ Work happens on `feature/*` worktrees
- ✅ Merges land in `integration`
- ✅ Only after tests does `integration` merge to `main`
- ❌ **NEVER** commit directly to `integration`
- ❌ **NEVER** use `integration` as a development branch

#### Branch Structure

- **`main`** - Production-ready code (sacred, protected)
- **`integration`** - Battle arena where feature branches merge and get tested
- **Feature branches** - `feature/*`, `refactor/*`, `fix/*`, etc. (gladiators)

#### Branch Naming Conventions

- **`feature/*`** - New capabilities
- **`refactor/*`** - Structural changes
- **`fix/*`** - Bug fixes
- **`chore/*`** - Dependencies, tooling, config
- **`spike/*`** - Experiments you might trash later

#### Complete Workflow (Feature → Integration → Main)

##### 1) Create Feature Worktree

**Always branch from `integration` by default** to keep feature work aligned with what's about to be merged:

```bash
# Fetch latest
git fetch origin

# Create branch + worktree in one command (prevents mistakes)
git worktree add -b feature/my-feature ../quantBot-feature integration
cd ../quantBot-feature
```

This one-liner:

- Creates branch `feature/my-feature`
- Creates worktree folder `../quantBot-feature`
- Bases it off `integration` (keeps you aligned)

##### 2) Work + Commit Normally

```bash
# Make your changes
pnpm test
git add -A
git commit -m "feat: my feature"
git push -u origin feature/my-feature
```

##### 3) Merge to Integration

```bash
# From your main repo (or the same worktree)
git checkout integration
git pull origin integration
git merge --no-ff feature/my-feature  # --no-ff keeps feature boundaries visible
git push origin integration
```

**Why `--no-ff`?** Keeps feature boundaries visible in history. Given you're using worktrees and doing big refactors, this is the sweet spot.

##### 4) Run Integration Tests

```bash
# Verify integration is green
pnpm test
# or your full CI-equivalent command
```

##### 5) Merge Integration → Main (Only After Green)

```bash
git checkout main
git pull origin main
git merge --no-ff integration
git push origin main
```

**Only merge `integration` → `main` when:**

- ✅ Integration CI is green
- ✅ Integration tests pass
- ✅ You're confident the changes are production-ready

#### Branch Hygiene

**Always branch from `integration` by default:**

- Keeps feature work aligned with what's about to be merged
- Reduces surprise conflicts
- Prevents divergence

**Keep integration linear-ish:**

- Prefer `--no-ff` merges into `integration` (keeps feature boundaries visible)
- Alternative: squash merges (keeps it tidy, but feature branch history won't matter)
- For worktrees and big refactors: `--no-ff` is the sweet spot

#### Ripwires (Prevents Integration from Rotting)

**Ripwire 1: Branch Protections (Minimum Viable)**

- Protect `main`: PR required, CI required
- Protect `integration`: CI required
- Disallow direct pushes to `main` (and ideally `integration` too, unless via PR)

**Ripwire 2: "Integration Must Be Green" Rule**

- No merge into `main` unless `integration` CI is green on the merge commit
- Integration is the gatekeeper

**Ripwire 3: Keep Integration Synced with Main (Optional but Good)**

If you hotfix `main`, bring it back into `integration` immediately after:

```bash
git checkout integration
git pull origin integration
git merge --no-ff main
git push origin integration
```

This prevents "main diverged and integration is lying to you."

#### Worktree Management

**List worktrees:**

```bash
git worktree list
```

**Remove worktree:**

```bash
# From the worktree directory
cd ../quantBot-feature
git worktree remove .
# Or from main repo
git worktree remove ../quantBot-feature
```

**Clean up after merging:**

```bash
# After feature is merged and no longer needed
git branch -d feature/my-feature  # Delete local branch
git push origin --delete feature/my-feature  # Delete remote branch
```

#### Example: Momentum Pattern

For multiple small fixes:

- `fix/manifest-file-uri`
- `fix/analysis-summary-columns`
- `fix/artifact-storage-logger`

Three tiny branches, three merges into `integration`, one clean "integration goes green" moment, then ship to `main`.

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

## Release Process

### Pre-Release Checklist

1. **Audit package versions** - Run `pnpm release:audit-versions` to check all package versions
2. **Review version changes** - Ensure all version bumps are appropriate (patch/minor/major)
3. **Update CHANGELOG.md** - Move `[Unreleased]` entries to versioned section with date
4. **Generate release notes** - Include package version summary from audit script
5. **Run quality gates** - `pnpm quality-gates:release`
6. **Create release tag** - Tag commit with version (e.g., `v1.0.0`)

### Package Version Audit

Before each release, audit all package versions:

```bash
# Audit versions against latest release tag
pnpm release:audit-versions

# Or audit against a specific git ref
pnpm release:audit-versions v1.0.0
```

**Include the generated summary in release notes** to document all package version changes.

---

## Pull Request Process

### Before Submitting

1. **Update CHANGELOG.md** - Document your changes
2. **Write tests** - Ensure all tests pass
3. **Run linting** - `pnpm lint:fix`
4. **Run type checking** - `pnpm typecheck`
5. **Verify build** - `pnpm build:ordered`
6. **Bump package version** - Use `pnpm version:bump` if you changed source code

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

## Package Versioning

### Versioning Policy

QuantBot uses **Semantic Versioning (Semver)** for all packages in the monorepo:

- **MAJOR** (x.0.0): Breaking changes (API changes, removed exports, incompatible changes)
- **MINOR** (x.y.0): New features (backward-compatible additions)
- **PATCH** (x.y.z): Bug fixes (backward-compatible fixes)

### Version Bump Requirements

**⚠️ CRITICAL: ALL packages MUST have a valid version number, including private packages.**

**Every PR that changes source code in a package MUST bump that package's version**, unless:

- Only documentation files are changed (`*.md`, `docs/**`)
- Only test files are changed (`*.test.ts`, `tests/**`)
- Only configuration files are changed (`*.config.ts`, `tsconfig.json`)

**Note**: Private packages (`"private": true`) and experimental packages still require versions. The `private` flag only prevents publishing to npm, it does not exempt packages from versioning requirements.

### How to Bump Versions

1. **Identify changed packages**: The CI will automatically detect which packages have changed
2. **Determine version increment**:
   - **PATCH**: Bug fixes, typo corrections, internal refactoring
   - **MINOR**: New features, new exports, new functionality
   - **MAJOR**: Breaking changes, removed APIs, incompatible changes
3. **Update package.json**: Edit the `version` field in the package's `package.json`
4. **Update CHANGELOG.md**: Add an entry for the version bump (see [CHANGELOG Enforcement](.cursor/rules/changelog-enforcement.mdc))

### Version Verification

The CI automatically verifies:

- ✅ All packages have valid semver versions
- ✅ Changed packages have version bumps
- ✅ No version regressions (versions don't decrease)
- ⚠️ Warns about duplicate versions (informational)

**Run locally**:

```bash
pnpm verify:package-versions
```

### Release Process

**Before each release**, audit all package versions:

```bash
# Audit versions against latest release tag
pnpm release:audit-versions

# Or audit against a specific git ref
pnpm release:audit-versions v1.0.0
```

This generates a summary of:

- New packages
- Major version updates (breaking changes)
- Minor version updates (new features)
- Patch version updates (bug fixes)
- Unchanged packages

**Include this summary in release notes** to document all package version changes.

### Version Bump Helper Script

A helper script is available to bump versions and automatically update CHANGELOG.md:

```bash
# Bump patch version for a package (automatically updates CHANGELOG.md)
pnpm version:bump @quantbot/utils patch

# Bump minor version
pnpm version:bump @quantbot/utils minor

# Bump major version
pnpm version:bump @quantbot/utils major

# Skip CHANGELOG update (if you want to write it manually)
pnpm version:bump @quantbot/utils patch --no-changelog
```

The script will:

1. ✅ Update `package.json` version field
2. ✅ Automatically add entry to `CHANGELOG.md` under `[Unreleased]` section
3. ✅ Place entry in appropriate section (Added/Changed/Fixed based on bump type)

### Examples

**Example 1: Bug Fix**

```json
// packages/utils/package.json
{
  "name": "@quantbot/utils",
  "version": "1.0.1" // ← Bumped from 1.0.0 (PATCH)
}
```

**Example 2: New Feature**

```json
// packages/storage/package.json
{
  "name": "@quantbot/storage",
  "version": "1.1.0" // ← Bumped from 1.0.5 (MINOR)
}
```

**Example 3: Breaking Change**

```json
// packages/core/package.json
{
  "name": "@quantbot/core",
  "version": "2.0.0" // ← Bumped from 1.5.0 (MAJOR)
}
```

### Internal/Experimental Packages

Packages marked as `"private": true` or `"experimental": true` are exempt from version bump requirements, but version bumps are still recommended for tracking purposes.

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

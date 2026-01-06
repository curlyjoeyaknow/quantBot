# QuantBot Architecture

## Handler Purity Rule

**The Rule:**

If a file can't be executed with:

- a fake clock
- in-memory stubs implementing ports (not mocks of everything)
- no filesystem
- no environment

...it is not a handler. It is an adapter.

**Handlers never read environment; env resolution happens in composition roots and is passed in as data.**

### Enforcement

This rule is:

- ✅ **Enforceable by ESLint** (handler purity rules in `eslint.config.mjs`)
- ✅ **Teachable to future contributors** (clear separation of concerns)
- ✅ **What keeps your hot path fast and your system sane** (deterministic, testable handlers)

### Handler vs Adapter

**Pure Handler** (`packages/core/src/handlers/`):

- ✅ No `process.env`
- ✅ No `Date.now()` (use `ClockPort`)
- ✅ No filesystem operations
- ✅ No `console.log`
- ✅ No path resolution
- ✅ Pure transformation: command + ports → result
- ✅ Deterministic with stubbed ports
- ✅ Replayable (same inputs → same outputs)
- ✅ **May only import from `@quantbot/core` domain/ports/commands. Everything else is an adapter.**
- ✅ **Handlers emit metrics/events as data (return value). Adapters decide how to log/export them.**

**Canonical Handler Contract:**

```typescript
export async function XHandler(
  cmd: XCommand,
  ports: XPorts,
  ctx: HandlerContext
): Promise<XOutput>
```

Where:

- `cmd` is data-only (validated input)
- `ports` are interfaces only (no implementations)
- `ctx` is correlation/trace metadata only (no business logic)

**Composition Root / Adapter** (`packages/cli/src/commands/`):

- ✅ Can read `process.env`
- ✅ Can touch filesystem (`path.resolve`, `process.cwd()`)
- ✅ Can log to console
- ✅ Can exit the process
- ✅ Wires real adapters
- ✅ Formats output for presentation

### Example: OHLCV Ingestion

**Pure Handler** (`packages/core/src/handlers/ingestOhlcvHandler.ts`):

```typescript
export async function ingestOhlcvHandler(
  cmd: IngestOhlcvCommand,
  ports: IngestOhlcvHandlerPorts,
  _ctx: HandlerContext = {}
): Promise<IngestOhlcvHandlerOutput> {
  // Pure validation (no env, no fs)
  // Uses ports.clock.nowMs() instead of Date.now()
  // Returns structured result
}
```

**CLI Adapter** (`packages/cli/src/commands/ingestion/ingest-ohlcv.ts`):

```typescript
export async function runIngestOhlcvCommand(
  args: IngestOhlcvArgs,
  _ctx: CommandContext
) {
  // ENV + FS LIVE HERE (and ONLY here)
  const duckdbPath = path.resolve(process.env.DUCKDB_PATH || args.duckdb);
  
  // Wire adapters
  const ports = {
    ohlcvIngestion: createOhlcvIngestionWorkflowAdapter(workflowCtx),
    clock: systemClock, // Uses Date.now() - allowed here
  };
  
  // Call pure handler
  const output = await ingestOhlcvHandler(cmd, ports);
  
  // Format output
  return buildSummary(output);
}
```

### Ports & Adapters Pattern

**Ports** (`packages/core/src/ports/`):

- Interfaces that handlers depend on
- Examples: `ClockPort`, `TelemetryPort`, `MarketDataPort`, `ExecutionPort`, `StatePort`
- All ports exported from `@quantbot/core` (public API)
- Handlers import ports, never implementations
- Ports can accept config values (data), but don't read env internally

**Adapters** (`packages/workflows/src/adapters/`):

- Implementations of ports
- Bridge between port interface and concrete implementations
- Examples:
  - `telemetryConsoleAdapter` - Implements `TelemetryPort` (console output)
  - `marketDataBirdeyeAdapter` - Implements `MarketDataPort` (wraps BirdeyeClient)
  - `stateDuckdbAdapter` - Implements `StatePort` (DuckDB-backed persistence)
  - `executionStubAdapter` - Implements `ExecutionPort` (safety-first stub with dry-run mode)
- Adapters isolate shape alignment between ports and clients

**ProductionPorts** (`packages/workflows/src/context/ports.ts`):

- Centralized collection of all production ports
- Single entry point: `createProductionPorts()` wires all adapters
- Structure:

  ```typescript
  type ProductionPorts = {
    marketData: MarketDataPort;
    execution: ExecutionPort;
    state: StatePort;
    telemetry: TelemetryPort;
    clock: ClockPort;
  };
  ```

**Composition Roots** (`packages/cli/src/commands/`):

- Wire adapters to ports via `createProductionPorts()`
- Handle I/O, env, paths (can read `process.env`)
- Call pure handlers with wired ports
- Resolve environment variables and pass as data to handlers

### Wiring Patterns

**CommandContext Pattern** (`packages/cli/src/core/command-context.ts`):

- Primary composition root for CLI commands
- Provides lazy service creation via `ctx.services.serviceName()`
- Handles storage initialization
- All CLI handlers receive `CommandContext` and use services from it

**Example - CLI Handler Using CommandContext**:

```typescript
export async function listStrategiesHandler(
  args: ListStrategiesArgs,
  ctx: CommandContext
) {
  // ✅ Use service from context (preferred)
  const repo = ctx.services.strategiesRepository();
  const strategies = await repo.list();
  return strategies;
}
```

**WorkflowContext Pattern** (`packages/workflows/src/context/`):

- Primary composition root for workflows
- Provides repositories, OHLCV access, simulation engine
- Created via context factories: `createProductionContext()`, `createProductionContextWithPorts()`
- Workflows receive `WorkflowContext` and use dependencies from it

**Example - Workflow Using WorkflowContext**:

```typescript
export async function runSimulation(
  spec: SimulationRunSpec,
  ctx: WorkflowContext = createDefaultRunSimulationContext()
): Promise<SimulationRunResult> {
  // ✅ Use repository from context
  const strategy = await ctx.repos.strategies.getByName(spec.strategyName);
  const calls = await ctx.repos.calls.list({
    callerName: spec.callerName,
    fromISO: spec.from.toISO(),
    toISO: spec.to.toISO(),
  });
  
  // ✅ Use OHLCV from context (causal accessor for Gate 2 compliance)
  const candles = await ctx.ohlcv.causalAccessor.getCandles({
    mint: call.mint,
    fromISO: windowStart.toISO(),
    toISO: currentTime.toISO(),
  });
  
  // ✅ Use simulation from context
  const result = await ctx.simulation.run({
    candleAccessor: ctx.ohlcv.causalAccessor,
    strategy: strategy.config,
    // ...
  });
  
  return result;
}
```

**Wiring Rules**:

1. **Composition Roots Only**: Direct instantiation only in composition roots (handlers, context factories, servers)
2. **Dependency Injection**: Services provided through contexts (`CommandContext`, `WorkflowContext`)
3. **No Direct Instantiation in Workflows**: Workflows must use `WorkflowContext`, never instantiate repositories directly
4. **No Direct Instantiation in Domain Logic**: Domain services must receive dependencies via constructor or context

**Anti-Patterns**:

```typescript
// ❌ BAD: Workflow directly instantiating repository
export async function badWorkflow(spec: Spec, ctx: WorkflowContext) {
  const repo = new StrategiesRepository(dbPath); // ❌ NO
  // ...
}

// ❌ BAD: Domain service directly instantiating repository
export class BadService {
  async doSomething() {
    const repo = new StrategiesRepository(dbPath); // ❌ NO
    // ...
  }
}
```

See [wiring-patterns.md](./wiring-patterns.md) and [wiring-exceptions.md](./wiring-exceptions.md) for complete wiring documentation.

### Benefits

1. **Testability**: Handlers can be tested with fake ports (no real I/O)
2. **Determinism**: Same inputs + stubbed ports → same outputs
3. **Replayability**: Can replay handler calls with recorded adapter outputs
4. **Hot Path Performance**: Pure handlers have no I/O overhead
5. **Maintainability**: Clear separation of concerns
6. **Swappability**: Easy to swap providers (Birdeye → Helius, console → OTEL) without changing handlers
7. **Architecture Enforcement**: Deep imports blocked, boundaries are physical

### Architecture Boundaries

**Deep Imports Blocked**:

- ESLint enforces: `@quantbot/*/src/**` imports are errors
- Only public API (`@quantbot/<pkg>`) allowed
- Tests still enforce boundaries (no architecture bypass)

**Workflow Ports Enforcement**:

- Workflows in `packages/workflows/src/**` must use `ctx.ports.*`, not raw clients
- ESLint blocks: `@quantbot/api-clients`, `@quantbot/storage/src/**`, direct HTTP clients
- Exceptions: `adapters/**` and `context/**` (composition layer)
- Temporary quarantine: `resolveEvmChains.ts`, `ingestTelegramJson.ts` (migration in progress)

**WorkflowContext Migration**:

- Workflows migrate from raw clients → ports incrementally
- `createProductionContextWithPorts()` provides `ctx.ports.*` access
- Existing `WorkflowContext` remains for backward compatibility during migration
- See `docs/WORKFLOW_CONTEXT_MIGRATION_PLAN.md` for migration strategy

### How to Verify Ports Migration Locally

Run these commands to verify architecture boundaries:

```bash
# Verify architecture boundaries (no deep imports, handler purity)
pnpm verify:architecture-boundaries

# Verify ESLint rules (no raw client imports in workflows)
pnpm lint

# Verify ports work end-to-end (smoke tests)
pnpm smoke:ports
```

All three must pass before merging ports migration PRs.

### ExecutionPort (Stub Only)

**⚠️ Note**: ExecutionPort is **simulation-only** in this repository. The stub adapter provides the interface contract without real execution.

**Safety patterns** (dry-run mode, circuit breaker, idempotency): See [EXECUTION_PORT_SAFETY.md](./EXECUTION_PORT_SAFETY.md) for operational details.

**Architecture**: Live trading runtime is isolated in executor app boundary (see below). ExecutionPort remains a stub-only interface in this research lab.

#### Executor App Boundary (Live Trading Runtime)

**Architecture Principle**: Live trading runtime concerns are isolated in a dedicated app boundary, separate from research/backtesting code.

**Why Separate Boundary**:

- **Safety**: Hard-walled separation between research and live execution
- **Access Control**: Different security posture for key material and real money
- **Deployment**: Can have different deployment cadence (trading ships daily, research ships hourly)
- **Compliance**: Executor can have stricter audit requirements

**Recommended Structure**:

```text
apps/executor/ (or packages/executor)
├── composition roots only
├── owns key management + signing + network submission
├── wires ExecutionPort + MarketDataPort + StatePort
├── has "real money" safety stuff (dry-run, circuit breaker, idempotency keys)
└── reuses:
    - @quantbot/core (handlers/commands/ports)
    - @quantbot/workflows (orchestration, deterministic where possible)
```

**What Lives in Executor Boundary**:

- Keypair/wallet management (secure key storage, signing)
- Transaction building (Solana transactions, Jito bundles)
- Network submission (RPC clients, Jito clients)
- Risk gates (position limits, daily loss limits, slippage protection)
- Monitoring (real-time position tracking, incident controls)
- Safety features (dry-run mode, circuit breakers, idempotency)

**What Stays in Core/Workflows**:

- Pure handlers (deterministic, testable)
- Port interfaces (ExecutionPort, MarketDataPort, StatePort)
- Workflow orchestration (reusable for both simulation and live)
- Strategy evaluation (same logic for backtesting and live)

**Current State**:

- ExecutionPort interface: ✅ Defined in `@quantbot/core`
- ExecutionPort stub adapter: ✅ Safety-first stub with dry-run mode
- Real execution adapter: ❌ Not implemented (lives in executor boundary)
- Executor app boundary: ❌ Not created yet (can be added when needed)

**Migration Path**:

**Option 1: Same Monorepo (Recommended Early)**:

1. Create `apps/executor/` or `packages/executor/`
2. Implement concrete ExecutionPort adapter (Jito/RPC)
3. Wire key management, signing, submission
4. Add risk gates and monitoring
5. Reuse existing handlers/workflows from `@quantbot/core` and `@quantbot/workflows`

**Option 2: Separate Repo (When Needed)**:

Split to separate codebase if you hit:

- Different access control (lock down trading runtime hard)
- Different deployment cadence (trading ships daily, research ships hourly)
- Different compliance/security posture (key material rules, audits)
- Want to open-source research but keep execution closed

**Until then, separate repo is mostly coordination tax.**

**Documentation Statement**:
> "This repo contains research/backtesting/ingestion + shared core. Live execution is implemented in executor app boundary (not enabled by default). Execution adapters exist only as stubs/dry-run unless explicitly enabled."

## DuckDB Operations via Python (Intentional)

### Architectural Decision

**Python is intentionally used as the database driver for DuckDB operations.**

This is an architectural decision, not a temporary workaround. The rationale:

1. **Better DuckDB Bindings**: Python's `duckdb` package provides mature, well-maintained bindings with full feature support
2. **Heavy Computation**: Python ecosystem (numpy, scipy, pandas, sklearn) is used for data plane operations
3. **Performance**: Python's DuckDB bindings are optimized for analytical workloads
4. **Ecosystem**: Leverages existing Python data science tooling for feature engineering and ML

### Implementation Pattern

**DuckDBClient** (`packages/storage/src/duckdb/duckdb-client.ts`):

- Wraps `PythonEngine` calls to Python scripts
- Provides TypeScript interface for DuckDB operations
- Maintains separation of concerns (TypeScript orchestration, Python data operations)

**Python Scripts** (`tools/storage/duckdb_*.py`):

- Pure DuckDB operations (no side effects outside DB)
- Accept JSON input, return JSON output
- Bridge pattern: Easy integration with TypeScript

### When to Use Python vs Node.js

**Use Python for:**

- ✅ DuckDB operations (schema, queries, data transformations)
- ✅ Heavy computation (numpy, scipy, sklearn)
- ✅ Data plane operations (feature engineering, ML)
- ✅ Offline batch jobs

**Use Node.js for:**

- ✅ Hot paths (latency-sensitive operations)
- ✅ Real-time trading execution
- ✅ API clients and network operations
- ✅ Orchestration and workflow management

### Isolation Strategy

**Python is isolated to offline jobs only:**

- DuckDB operations are async and non-blocking (via PythonEngine)
- Python scripts are pure functions (no side effects)
- TypeScript maintains control flow and error handling
- Hot paths (trading execution) use Node.js only

### Future Considerations

If performance becomes an issue:

1. **Option 1**: Keep Python for batch/offline, use Node.js DuckDB bindings for hot paths
2. **Option 2**: Optimize Python script execution (connection pooling, query batching)
3. **Option 3**: Move critical hot paths to Node.js DuckDB bindings while keeping Python for heavy computation

**Current Status**: Python as DB driver is intentional and documented. No immediate refactoring needed.

## Causal Candle Accessor (Gate 2 Compliance)

### Overview

The **Causal Candle Accessor** enforces causality in simulation candle access, ensuring that at simulation time `t`, it is impossible to fetch candles with `close_time > t`. This prevents "future leakage" bugs where simulations accidentally use future data.

### Architecture

**CausalCandleAccessor Interface** (`packages/core/src/types/causal-accessor.ts`):

- `getCandles(query)`: Returns candles up to (but not after) the current simulation time
- `getCandleAtTime(time)`: Returns the candle at a specific time
- Enforces temporal causality: no future data access

**CausalCandleWrapper** (`packages/simulation/src/types/causal-accessor.ts`):

- Wraps any candle accessor with causal filtering
- Filters out candles with `close_time > currentSimulationTime`
- Provides incremental indicator updates

**StorageCausalCandleAccessor** (`packages/workflows/src/context/causal-candle-accessor.ts`):

- Implements `CausalCandleAccessor` using `StorageEngine`
- Wraps ClickHouse/DuckDB queries with causal filtering
- Integrated into `WorkflowContext` via `ctx.ohlcv.causalAccessor`

### Usage in Workflows

```typescript
// Workflow uses causal accessor (primary method)
const candles = await ctx.ohlcv.causalAccessor.getCandles({
  mint: call.mint,
  fromISO: windowStart.toISO(),
  toISO: currentTime.toISO(), // Current simulation time
});

// Legacy method (deprecated, kept for backward compatibility)
const legacyCandles = await ctx.ohlcv.getCandles?.({
  mint: call.mint,
  fromISO: windowStart.toISO(),
  toISO: windowEnd.toISO(),
});
```

### Benefits

1. **Prevents Future Leakage**: Impossible to access future data in simulation
2. **Deterministic**: Same inputs → same outputs (no accidental future data)
3. **Testable**: Can test causality enforcement with time-based queries
4. **Incremental Updates**: Supports incremental indicator calculations

### Migration Status

- ✅ `CausalCandleAccessor` interface defined in `@quantbot/core`
- ✅ `CausalCandleWrapper` implementation complete
- ✅ `StorageCausalCandleAccessor` integrated into workflows
- ✅ Simulation workflows use `causalAccessor` (primary method)
- ⚠️ Legacy `getCandles()` method marked as optional (backward compatibility)

## Offline-Only Architecture Refactoring

### Overview

The codebase has been refactored to separate **offline** (data plane) and **online** (control plane) concerns:

- **Offline packages** (`@quantbot/ohlcv`, `@quantbot/ingestion`): Query storage, generate worklists, manage metadata (no API calls)
- **Online package** (`@quantbot/jobs`): Orchestrates API calls, rate limiting, metrics collection

### Package Responsibilities

**@quantbot/ohlcv** (Offline-Only):

- ✅ Query ClickHouse for candles
- ✅ Store candles in ClickHouse (idempotent upserts)
- ✅ Generate OHLCV worklists from DuckDB
- ❌ No API calls (moved to `@quantbot/jobs`)

**@quantbot/ingestion** (Offline-Only):

- ✅ Parse Telegram exports
- ✅ Generate ingestion worklists
- ✅ Manage metadata (callers, alerts, calls, tokens)
- ❌ No API calls (moved to `@quantbot/jobs`)

**@quantbot/jobs** (Online Orchestration):

- ✅ `OhlcvIngestionEngine`: Orchestrates OHLCV fetching with rate limiting
- ✅ `OhlcvFetchJob`: Fetches candles from Birdeye API and stores them
- ✅ Rate limiting and metrics collection
- ✅ API client coordination

### Dependency Boundaries

**Enforced via tests**:

- `@quantbot/ohlcv` must not depend on `@quantbot/api-clients`, `axios`, or `dotenv`
- `@quantbot/ingestion` must not depend on `@quantbot/api-clients`, `axios`, or `dotenv`
- Tests fail if forbidden dependencies are added

### Benefits

1. **Clear Separation**: Offline packages are pure data operations
2. **Testability**: Offline packages can be tested without network dependencies
3. **Reusability**: Offline packages can be used in different contexts (CLI, API, jobs)
4. **Rate Limiting**: Centralized in `@quantbot/jobs` (single point of control)

### Migration Status

- ✅ `OhlcvIngestionEngine` moved from `@quantbot/ohlcv` to `@quantbot/jobs`
- ✅ `OhlcvFetchJob` refactored to use `fetchBirdeyeCandles` from `@quantbot/api-clients`
- ✅ `storeCandles` remains in `@quantbot/ohlcv` (offline storage operation)
- ✅ Dependency boundary tests enforce offline-only constraints

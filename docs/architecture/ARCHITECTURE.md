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

### ExecutionPort Usage (Safety-First)

**⚠️ CRITICAL: ExecutionPort handles real money. Always use safety-first patterns.**

#### Dry-Run Mode (Required)

**Default behavior**: ExecutionPort is in dry-run mode by default (no real trades executed).

```typescript
// In workflow
const result = await ctx.ports.execution.execute({
  tokenAddress: createTokenAddress('...'),
  chain: 'solana',
  side: 'buy',
  amount: 0.1,
  slippageBps: 100, // 1% slippage
  priorityFee: 21_000, // µLAM per compute unit
});

// Dry-run mode returns simulated results (txSignature starts with "dry-run-")
if (result.txSignature?.startsWith('dry-run-')) {
  // This is a simulation, not a real trade
}
```

**To enable real execution** (NOT RECOMMENDED in development):

```bash
# Set environment variable (dangerous - only for production)
EXECUTION_DRY_RUN=false
```

**⚠️ WARNING**: Real execution is irreversible. Always test in dry-run mode first.

#### Circuit Breaker

ExecutionPort implements a circuit breaker pattern:

- **Max consecutive failures**: 5 (configurable)
- **Circuit opens**: After max failures, all execution requests are rejected
- **Auto-reset**: Circuit resets after 60 seconds of no failures
- **Check availability**: Use `ctx.ports.execution.isAvailable()` before executing

```typescript
// Check circuit breaker before execution
const available = await ctx.ports.execution.isAvailable();
if (!available) {
  // Circuit breaker is open - do not execute
  return { success: false, error: 'Execution unavailable (circuit breaker open)' };
}

// Execute trade
const result = await ctx.ports.execution.execute(request);
```

#### Idempotency Keys

ExecutionPort enforces idempotency to prevent double-execution:

- **Automatic**: Idempotency is enabled by default
- **Key generation**: Based on `tokenAddress + side + amount` (rounded)
- **Cached results**: Same request returns cached result (no duplicate execution)
- **Storage**: In-memory for stub adapter; real adapter should use `StatePort` for persistence

```typescript
// First execution
const result1 = await ctx.ports.execution.execute(request);

// Second execution (same request) - returns cached result
const result2 = await ctx.ports.execution.execute(request);

// result1.txSignature === result2.txSignature (idempotent)
```

#### Best Practices

1. **Always use dry-run mode in development/testing**
   - Default behavior is dry-run (safety-first)
   - Verify execution logic without risking real money

2. **Check circuit breaker before execution**
   - Use `isAvailable()` to verify execution is healthy
   - Handle circuit breaker failures gracefully

3. **Respect idempotency**
   - Never disable idempotency checks
   - Use unique idempotency keys for different requests

4. **Monitor execution metrics**
   - Track execution success/failure rates
   - Monitor circuit breaker state
   - Log all execution attempts (even dry-run)

5. **Handle errors gracefully**
   - Execution failures should not crash workflows
   - Return structured errors with context
   - Use telemetry to track execution failures

#### Example: Safe Execution in Workflow

```typescript
export async function executeTradeWorkflow(
  spec: ExecuteTradeSpec,
  ctx: WorkflowContextWithPorts
): Promise<ExecuteTradeResult> {
  // 1. Check circuit breaker
  const available = await ctx.ports.execution.isAvailable();
  if (!available) {
    ctx.ports.telemetry.emitEvent({
      name: 'execution.circuit_breaker_open',
      level: 'warn',
      message: 'Execution unavailable (circuit breaker open)',
    });
    return { success: false, error: 'Execution unavailable' };
  }

  // 2. Prepare execution request
  const request: ExecutionRequest = {
    tokenAddress: createTokenAddress(spec.tokenAddress),
    chain: spec.chain,
    side: spec.side,
    amount: spec.amount,
    slippageBps: spec.slippageBps ?? 100,
    priorityFee: spec.priorityFee ?? 21_000,
    maxRetries: 3,
  };

  // 3. Execute (dry-run by default)
  const result = await ctx.ports.execution.execute(request);

  // 4. Emit telemetry
  ctx.ports.telemetry.emitEvent({
    name: result.success ? 'execution.success' : 'execution.failed',
    level: result.success ? 'info' : 'error',
    message: result.success
      ? `Trade executed: ${result.txSignature}`
      : `Trade failed: ${result.error}`,
    context: {
      tokenAddress: spec.tokenAddress,
      side: spec.side,
      amount: spec.amount,
      dryRun: result.txSignature?.startsWith('dry-run-'),
    },
  });

  // 5. Return structured result
  return {
    success: result.success,
    txSignature: result.txSignature,
    executedPrice: result.executedPrice,
    fees: result.fees,
    error: result.error,
  };
}
```

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

## Python as Database Driver (DuckDB)

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

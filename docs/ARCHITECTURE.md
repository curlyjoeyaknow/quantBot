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

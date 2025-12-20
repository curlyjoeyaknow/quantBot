# QuantBot Architecture

> **Comprehensive system architecture documentation for QuantBot**

## Overview

QuantBot is a **modular monorepo** for Solana analytics and backtesting. The architecture follows strict separation of concerns with three primary layers:

1. **Pure Compute** - Deterministic simulation logic with no I/O
2. **Orchestration** - Workflows that coordinate I/O, storage, and services
3. **Adapters** - CLI/TUI/API that translate user intent to workflow specs

This separation is critical for trading/sniping strategies where you need to test and iterate logic without I/O chaos contaminating results.

---

## Package Dependency Graph

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                            APPLICATION LAYER                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │    cli      │  │     tui     │  │     api     │  │  (future packages)  │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                │                     │            │
│         └────────────────┴───────┬────────┴─────────────────────┘            │
│                                  ▼                                            │
│                         ┌─────────────────┐                                   │
│                         │    workflows    │  ← Orchestration Layer            │
│                         └────────┬────────┘                                   │
└──────────────────────────────────┼──────────────────────────────────────────┘
                                   │
┌──────────────────────────────────┼──────────────────────────────────────────┐
│                            SERVICE LAYER                                     │
│         ┌────────────────────────┼────────────────────────┐                  │
│         ▼                        ▼                        ▼                  │
│  ┌─────────────┐         ┌─────────────┐         ┌─────────────┐            │
│  │  simulation │         │  ingestion  │         │   analytics │            │
│  │ (pure/no IO)│         │             │         │             │            │
│  └─────────────┘         └──────┬──────┘         └─────────────┘            │
│                                 │                                            │
│                                 ▼                                            │
│                          ┌─────────────┐                                     │
│                          │    ohlcv    │                                     │
│                          └──────┬──────┘                                     │
└─────────────────────────────────┼───────────────────────────────────────────┘
                                  │
┌─────────────────────────────────┼───────────────────────────────────────────┐
│                         INFRASTRUCTURE LAYER                                 │
│    ┌────────────────────────────┼───────────────────────────┐                │
│    ▼                            ▼                           ▼                │
│  ┌─────────────┐         ┌─────────────┐         ┌───────────────────┐       │
│  │   storage   │         │ api-clients │         │   observability   │       │
│  │(DuckDB/CH)  │         │(Birdeye,etc)│         │  (logging,metrics)│       │
│  └─────────────┘         └─────────────┘         └───────────────────┘       │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
┌─────────────────────────────────┼───────────────────────────────────────────┐
│                          FOUNDATION LAYER                                    │
│    ┌────────────────────────────┼────────────────────────┐                   │
│    ▼                                                     ▼                   │
│  ┌─────────────┐                                  ┌─────────────┐            │
│  │    utils    │                                  │    core     │            │
│  │(EventBus,   │                                  │ (types,     │            │
│  │ PythonEngine│                                  │  interfaces)│            │
│  │ logger)     │                                  │             │            │
│  └─────────────┘                                  └─────────────┘            │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Build Order (Mandatory)

Packages **must** be built in dependency order. See `.cursor/rules/build-ordering.mdc` for enforcement.

| Position | Package                 | Dependencies                                              |
|----------|-------------------------|-----------------------------------------------------------|
| 1        | `@quantbot/core`        | None (foundation types)                                   |
| 2        | `@quantbot/utils`       | core                                                      |
| 3        | `@quantbot/storage`     | utils, core                                               |
| 4        | `@quantbot/observability` | utils, core                                             |
| 5        | `@quantbot/api-clients` | utils, core                                               |
| 6        | `@quantbot/ohlcv`       | api-clients, storage, utils, core                         |
| 7        | `@quantbot/analytics`   | storage, utils, core                                      |
| 8        | `@quantbot/ingestion`   | api-clients, ohlcv, storage, analytics, utils, core       |
| 9        | `@quantbot/simulation`  | utils, core (pure compute - no I/O dependencies)          |
| 10       | `@quantbot/workflows`   | simulation, ohlcv, ingestion, api-clients, storage, utils, core |
| 11+      | `@quantbot/cli`, `tui`, etc. | All packages                                         |

**Build command**: `pnpm build:ordered`

---

## Layer Responsibilities

### Foundation Layer (`@quantbot/core`, `@quantbot/utils`)

**Core** provides:
- Type definitions (`Candle`, `Chain`, `Token`, etc.)
- Interface contracts
- Zero runtime dependencies

**Utils** provides:
- Logging (`createLogger()`)
- Event system (`EventBus`)
- Python integration (`PythonEngine`)
- Validation utilities (Zod helpers)
- Configuration loading

### Infrastructure Layer (`@quantbot/storage`, `@quantbot/api-clients`, `@quantbot/observability`)

**Storage** provides:
- DuckDB integration (primary storage, OLAP)
- ClickHouse integration (time-series, OHLCV)
- Repository pattern for data access
- Parameterized queries (SQL injection prevention)

**API Clients** provides:
- Birdeye client (OHLCV, token metadata)
- Helius client (Solana WebSocket, RPC)
- Rate limiting, retry logic, caching

**Observability** provides:
- Structured logging
- Metrics collection
- Error tracking
- API usage monitoring

### Service Layer (`@quantbot/ohlcv`, `@quantbot/ingestion`, `@quantbot/analytics`, `@quantbot/simulation`)

**OHLCV** provides:
- Candle fetching with hybrid strategy (1m recent, 1h historical)
- ClickHouse caching layer
- Birdeye API integration with 52-period lookback

**Ingestion** provides:
- Telegram export parsing (HTML → structured data)
- Mint address extraction (case-preserved, never truncated)
- Caller/alert/token normalization
- Idempotent processing

**Analytics** provides:
- Performance metrics calculation
- PnL analysis
- Trade statistics
- Result aggregation

**Simulation** provides:
- **Pure compute engine** (no I/O, no clocks, no global config)
- Deterministic backtesting
- Strategy execution (take-profit, stop-loss, re-entry)
- Event traces for debugging

### Orchestration Layer (`@quantbot/workflows`)

**Workflows** coordinate:
- Multi-step business flows (ingest → fetch → simulate → persist)
- I/O operations via `WorkflowContext`
- Error collection and aggregation
- Structured, JSON-serializable results

**Critical Rule**: Workflows depend on interfaces, not implementations. All dependencies come through `WorkflowContext`.

### Adapter Layer (`@quantbot/cli`, `@quantbot/tui`, `@quantbot/api`)

**CLI** provides:
- Command-line interface (Commander.js)
- Handler pattern (pure functions)
- Output formatting (table, JSON, CSV)

**TUI** provides:
- Terminal UI (Ink)
- Interactive workflows

**API** (planned) provides:
- REST endpoints (Fastify)
- OpenAPI documentation
- Health checks

---

## Key Architectural Patterns

### 1. Workflow Pattern

```text
CLI Command → Handler (pure) → Workflow → Services → Storage
                  ↓
         CommandContext (DI)
```

**Rules**:
- CLI handlers are thin adapters (parse → call workflow → format)
- Workflows use `WorkflowContext` for all dependencies
- Workflow results are JSON-serializable
- Error policy is explicit in every workflow spec

### 2. Handler Pattern (CLI)

```typescript
// handlers/{package}/{command-name}.ts
export async function myHandler(
  args: MyArgs,
  ctx: CommandContext
): Promise<MyResult> {
  const service = ctx.services.myService();
  return service.doSomething(args);
}
```

**Handler rules**:
- ✅ Takes validated args + CommandContext
- ✅ Returns data (not formatted output)
- ❌ No console.log, no process.exit
- ❌ No try/catch (let errors bubble)
- ❌ No direct service instantiation

### 3. Python/DuckDB Integration

```text
Handler → Service → PythonEngine.run() → Python Script → Zod Validation → Typed Result
```

Services wrap `PythonEngine` calls and validate with Zod:

```typescript
// packages/simulation/src/duckdb-storage-service.ts
export class DuckDBStorageService {
  constructor(private readonly pythonEngine: PythonEngine) {}

  async storeStrategy(...): Promise<StrategyStorageResult> {
    const result = await this.pythonEngine.runDuckDBStorage({ ... });
    return StrategyStorageResultSchema.parse(result);
  }
}
```

### 4. Repository Pattern

All data access goes through typed repositories:

```typescript
interface CallsRepository {
  findByDateRange(from: DateTime, to: DateTime): Promise<Call[]>;
  save(call: Call): Promise<void>;
}
```

---

## Database Architecture

### Primary Storage: DuckDB

- OLAP-optimized for analytics
- Single-file database (portable)
- Python integration for complex queries
- Used for simulation results, calls, tokens

### Time-Series: ClickHouse

- High-performance OHLCV storage
- Time-based partitioning
- Query before API calls (reduce quota)
- Supports 1m, 5m, 15m, 1h intervals

### Schema Rules

- Mint addresses: `TEXT/VARCHAR(64+)` - **never truncate**
- Store full 32-44 char addresses, preserve exact case
- Use parameterized queries: `{param:Type}` syntax

---

## Testing Strategy

### Test Philosophy

> **Tests are the specification, not validation.**

- Write invariants BEFORE implementation
- Design tests to fail (push implementation to limits)
- Fix implementation, not tests

### Test Types

| Type | Location | Purpose |
|------|----------|---------|
| Unit | `tests/unit/` | Fast, isolated, 80%+ coverage |
| Integration | `tests/integration/` | API/DB boundaries |
| Property | `tests/properties/` | Math invariants, conservation laws |
| Fuzzing | `tests/fuzzing/` | Parser robustness |
| Stress | `tests/stress/` | Failure modes, limits |
| Golden | `tests/golden/` | Regression with fixtures |

### Crypto Backend Rules

1. **Mint addresses**: Never truncate in storage, preserve exact case
2. **Financial math**: Property tests with monotonicity, bounds checking
3. **Parsers**: Fuzz testing, never crash on garbage
4. **Serialization**: Roundtrip property tests
5. **Idempotency**: Insert same data twice → one record

---

## Critical Rules

### Mint Address Handling

⚠️ **NEVER MODIFY MINT ADDRESSES**

- No truncation, case changes, or string manipulation
- Store/pass full 32-44 char addresses
- Truncate ONLY for display/logging

### Dependency Injection

- Workflows depend on interfaces, not implementations
- All dependencies come through `WorkflowContext`
- No direct imports of Postgres/ClickHouse implementations

### Error Handling

- Workflows define error policy explicitly: `failFast` or `collect`
- Handlers let errors bubble up (no try/catch)
- Executor centralizes error handling and process.exit

### Result Serialization

All workflow results must be JSON-serializable:
- ❌ No Date objects (use ISO strings)
- ❌ No class instances (use plain objects)
- ❌ No functions, circular references, Maps, Sets

---

## Directory Structure

```text
quantBot/
├── packages/
│   ├── core/           # Foundation types and interfaces
│   ├── utils/          # Shared utilities (logger, EventBus, PythonEngine)
│   ├── storage/        # Storage layer (DuckDB, ClickHouse)
│   ├── observability/  # Logging, metrics, error tracking
│   ├── api-clients/    # External API clients (Birdeye, Helius)
│   ├── ohlcv/          # OHLCV data services
│   ├── analytics/      # Analytics engine
│   ├── ingestion/      # Data ingestion (Telegram parsing)
│   ├── simulation/     # Pure simulation engine (no I/O)
│   ├── workflows/      # Workflow orchestration
│   ├── cli/            # Command-line interface
│   ├── tui/            # Terminal UI
│   └── jobs/           # Background job processing
├── scripts/            # Standalone scripts and tools
├── tools/              # Python tools (DuckDB, analysis)
├── docs/               # Documentation
├── configs/            # Configuration files
└── .cursor/rules/      # Architectural rules (enforced)
```

---

## Enforcement

### Pre-Commit Checks

- Build order verification
- Circular dependency detection
- TypeScript project references
- Changelog enforcement

### Code Review Checklist

- [ ] Handlers are thin adapters
- [ ] No multi-step business logic in CLI
- [ ] Workflows use WorkflowContext
- [ ] Results are JSON-serializable
- [ ] Error policy is explicit
- [ ] Tests use independent math/constants

### AI Assistant Rules

See `.cursor/rules/` for:
- `build-ordering.mdc` - Build sequence enforcement
- `packages-workflows.mdc` - Workflow patterns
- `packages-cli-handlers.mdc` - Handler patterns
- `testing.mdc` - Testing philosophy
- `root.mdc` - Global rules

---

## Related Documentation

- [README.md](../README.md) - Project overview and quick start
- [WORKFLOW_ENFORCEMENT.md](WORKFLOW_ENFORCEMENT.md) - Workflow enforcement details
- [BUILD_SYSTEM.md](BUILD_SYSTEM.md) - Build system documentation
- [OHLCV_ARCHITECTURE.md](OHLCV_ARCHITECTURE.md) - OHLCV subsystem details
- [MIGRATION_POSTGRES_TO_DUCKDB.md](MIGRATION_POSTGRES_TO_DUCKDB.md) - Database migration

---

*Last updated: 2025-12-20*


# QuantBot — Caller-Centric Backtesting Lab

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-orange.svg)](https://pnpm.io/)

**Learn optimal post-alert trade management policies under explicit downside constraints, per caller.**

This is a **backtesting-only research lab** — no live trading. The architecture enforces a clean three-layer separation:

- **Truth Layer** — Compute path metrics from historical candle data
- **Policy Layer** — Simulate stop/exit strategies on those paths
- **Optimization Layer** — Search for optimal policies under constraints

**Note**: Live monitoring and real-time trading features are implemented in the `quantBot-signaloutbox` repository/worktree (separate from this backtesting-only repo).

---

## 🎯 Core Priority

**Caller-centric backtesting**: Quantify which callers are worth following, and learn optimal trade management (stops + exits) for each caller's signals.

### The Golden Path

```bash
# 1. Ingest caller alerts from Telegram export
pnpm quantbot ingestion telegram --file messages.html --caller-name Brook

# 2. Fetch OHLCV data for the alert windows
pnpm quantbot ingestion ohlcv --from 2024-01-01 --to 2024-02-01

# 3. Run simulation/backtesting
pnpm quantbot simulation run --strategy MyStrategy --from 2024-01-01

# 4. Analyze results
pnpm quantbot analytics performance --caller Brook
```

---

## 📁 Project Structure

```
quantBot/
├── apps/           # Runnable entrypoints only (CLI, daemons, servers)
├── packages/       # Libraries only (no process wiring, no direct I/O)
│   ├── core/           # Foundation types, port interfaces (zero deps)
│   ├── utils/          # Shared utilities (logger, EventBus, PythonEngine)
│   ├── storage/        # DuckDB, ClickHouse adapters
│   ├── observability/  # Logging, metrics, error tracking
│   ├── api-clients/    # External API clients (Birdeye, Helius)
│   ├── ohlcv/          # OHLCV data services (offline-only)
│   ├── ingestion/      # Data ingestion (parse exports, generate worklists)
│   ├── jobs/           # Online orchestration (API calls, rate limiting)
│   ├── simulation/     # Pure simulation engine (NO I/O, deterministic)
│   ├── backtest/       # Backtest handlers and policies
│   ├── analytics/      # Analytics engine and metrics
│   ├── workflows/      # Workflow orchestration (coordinates all I/O)
│   ├── cli/            # Command-line interface (thin adapters)
│   ├── api/            # REST API (Fastify-based)
│   ├── lab/            # Lab simulation presets and optimization
│   └── ...
├── docs/           # Architecture + status notes
├── tools/          # Developer-only tooling (Python scripts, analysis)
├── configs/        # Configuration files (sweep configs, presets)
├── strategies/     # Strategy definitions (JSON DSL)
└── tests/          # Root test setup
```

### Hard Rules

- **`apps/*`** = Composition roots and I/O boundaries only
- **`packages/*`** = Pure libraries (no process lifecycle, no env vars)
- **No runtime state in-repo** — no `logs/`, `data/`, `.pids/`, `backups/`
- **No root trophy files** — status docs go in `docs/`

---

## 🏗️ Architecture

### Three-Layer Design

```
┌─────────────────────────────────────────────────────────────┐
│  TRUTH LAYER: Compute path metrics from candles              │
│  - Peak multiple, drawdown, time-to-target, alert→activity  │
├─────────────────────────────────────────────────────────────┤
│  POLICY LAYER: Simulate trade management strategies          │
│  - Stops (fixed, trailing, time-based), exits, ladder logic │
├─────────────────────────────────────────────────────────────┤
│  OPTIMIZATION LAYER: Search for optimal policies             │
│  - Grid search, constraints, caller-specific tuning          │
└─────────────────────────────────────────────────────────────┘
```

### Key Patterns

- **Ports & Adapters** — Handlers depend on ports, not implementations
- **Deterministic Handlers** — Given identical inputs, outputs match exactly
- **Causal Candle Accessor** — Simulations can't access future data
- **Workflow Orchestration** — All multi-step I/O goes through `@quantbot/workflows`

### Package Layering

| Layer          | Packages                                   | Rules                          |
| -------------- | ------------------------------------------ | ------------------------------ |
| Foundation     | `core`, `utils`                            | Zero external deps, pure types |
| Infrastructure | `storage`, `api-clients`, `observability`  | Adapters, no business logic    |
| Services       | `ohlcv`, `ingestion`, `simulation`, `jobs` | Domain logic, offline/online   |
| Orchestration  | `workflows`                                | Coordinates I/O, returns data  |
| Application    | `cli`, `api`, `lab`                        | Thin adapters, parse → format  |

---

## 🚀 Quick Start

### Prerequisites

- **Node.js 18+** and pnpm
- **Docker** (for ClickHouse)
- **Python 3.9+** with `duckdb`, `pandas` (for analysis scripts)

### Installation

```bash
# Install dependencies
pnpm install

# Build all packages (in dependency order)
pnpm build:ordered

# Start ClickHouse
docker-compose up -d clickhouse

# Initialize schema
pnpm clickhouse:setup
```

### Environment

```bash
cp env.example .env
# Edit .env with your API keys:
# - BIRDEYE_API_KEY (required for OHLCV data)
# - CLICKHOUSE_HOST, CLICKHOUSE_PORT (default: localhost:18123)
```

### Run Tests

```bash
pnpm test              # All tests
pnpm test:coverage     # With coverage
pnpm quality-gates:pr  # PR quality checks
```

---

## 📖 Documentation

| Document                                                               | Purpose                       |
| ---------------------------------------------------------------------- | ----------------------------- |
| [docs/architecture/ARCHITECTURE.md](docs/architecture/ARCHITECTURE.md) | System architecture           |
| [docs/architecture/WORKFLOWS.md](docs/architecture/WORKFLOWS.md)       | Workflow reference            |
| [docs/api/API.md](docs/api/API.md)                                     | REST API documentation        |
| [docs/testing/](docs/testing/)                                         | Testing requirements & guides |
| [docs/guides/](docs/guides/)                                           | How-to guides                 |
| [CHANGELOG.md](CHANGELOG.md)                                           | Version history               |
| [TODO.md](TODO.md)                                                     | Roadmap and task tracking     |
| [CONTRIBUTING.md](CONTRIBUTING.md)                                     | Contribution guidelines       |

### Architecture Rules

Enforced via `.cursor/rules/`:

- `00-repo-shape.mdc` — Directory structure, apps vs packages
- `10-architecture-ports-adapters.mdc` — Ports & adapters pattern
- `40-testing-contracts.mdc` — Testing requirements (handler purity, regression tests)
- `packages-*.mdc` — Package-specific rules

---

## 🔧 Configuration

### Database Paths

DuckDB and ClickHouse paths are configurable via:

1. **`config.yaml`** (highest priority):

   ```yaml
   duckdb:
     path: /path/to/your/database.duckdb
   ```

2. **Environment variables**:

   ```bash
   export DUCKDB_PATH=/path/to/database.duckdb
   export CLICKHOUSE_HOST=localhost
   ```

3. **CLI flags**: `--duckdb-path`, `--state-dir`

### Default State Directory

When no explicit path is provided, state lives outside the repo:

- Linux: `$XDG_STATE_HOME/quantbot` or `~/.local/state/quantbot`
- macOS: `~/Library/Application Support/quantbot`

---

## 🧪 Testing

### Required Tests

- **Handler unit tests** — Deterministic, no I/O, in-memory ports only
- **Golden tests** — Synthetic candle streams for path metrics math
- **Adapter contract tests** — Recorded fixtures, no live dependencies in CI
- **Regression tests** — Mandatory for all bug fixes

### Quality Gates

```bash
pnpm quality-gates:pr       # All PR checks
pnpm verify:handler-tests   # Handler compliance
pnpm verify:property-tests  # Financial calculation tests
pnpm test:smoke            # Smoke tests
```

---

## 🛡️ Key Invariants

1. **Mint addresses** — Never truncate, preserve exact case (32-44 chars)
2. **Time units** — Domain logic uses milliseconds; normalize at boundaries
3. **Determinism** — No `Date.now()` outside ClockPort, no hidden randomness
4. **Handler purity** — No console.log, no process.exit, no try/catch in handlers
5. **Worktrees** — Don't rely on global `quantbot` command; use workspace exec

---

## 📊 Current Status

### Completed

- ✅ Monorepo structure with pnpm workspaces
- ✅ Pure simulation engine (no I/O, deterministic)
- ✅ Telegram export parsing and ingestion
- ✅ OHLCV data pipeline (Birdeye → ClickHouse)
- ✅ CLI with defineCommand pattern
- ✅ Workflow orchestration layer
- ✅ REST API (Fastify)
- ✅ Per-package version control with CI enforcement
- ✅ Slice export & analyze workflow

### In Progress

- 🔄 Slice export phase 4-7 (dataset expansion, analysis enhancements)
- 🔄 Strategy optimization tooling

### Planned

- 📋 Real-time monitoring (`@quantbot/monitoring`)
- 📋 Strategy optimization ML
- 📋 Web dashboard production deployment

See [TODO.md](TODO.md) for detailed roadmap.

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Versioning policy (semver, CI-enforced)
- Handler and workflow patterns
- Testing requirements
- PR checklist

**Key rules**:

1. Follow architectural rules in `.cursor/rules/`
2. Handlers are thin adapters — pure functions that return data
3. Simulation is pure — no I/O, no clocks, no global config
4. Regression tests are mandatory for bug fixes
5. Version bump required for any package code change

---

## 📝 License

ISC License — See LICENSE file for details.

---

Built for reproducible, caller-centric backtesting research.

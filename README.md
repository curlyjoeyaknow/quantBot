# QuantBot - Solana Analytics & Backtesting Pipeline

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-workspace-orange.svg)](https://pnpm.io/)
[![License](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

**A modular analytics and backtesting pipeline for Solana token trading strategies.**

This repository is primarily an **analytics & simulation engine** with a clean three-layer architecture:

- **Pure Compute** - Deterministic simulation with no I/O
- **Orchestration** - Workflows that coordinate storage, services, and I/O
- **Adapters** - CLI/TUI/API that translate user intent to workflow specs

## 🎯 Golden Path: Analytics Pipeline

The Golden Path is the core focus - a clean pipeline for:

1. **Telegram Export Ingestion** → Parse caller alerts and extract token addresses
2. **OHLCV Data Collection** → Fetch and store candle data from Birdeye
3. **Strategy Simulation** → Run pure, deterministic backtests on historical calls
4. **Performance Analytics** → Evaluate strategy performance with detailed metrics

### Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages (in correct dependency order)
pnpm build:ordered

# 1. Ingest Telegram export
pnpm quantbot ingestion telegram --file data/raw/messages.html --caller-name Brook

# 2. Fetch OHLCV for calls
pnpm quantbot ingestion ohlcv --from 2024-01-01 --to 2024-02-01

# 3. Run simulation
pnpm quantbot simulation run --strategy MyStrategy --from 2024-01-01 --to 2024-02-01
```

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for complete architecture documentation.

## 🎯 Overview

QuantBot's core capabilities:

- **Telegram Export Parsing** - Extract calls from Telegram HTML exports (case-preserved mint addresses)
- **OHLCV Ingestion** - Fetch and store candle data from Birdeye API with ClickHouse caching
- **Pure Simulation Engine** - Deterministic backtesting with no I/O, clocks, or global config
- **Workflow Orchestration** - Multi-step flows coordinated through typed WorkflowContext
- **DuckDB + ClickHouse** - OLAP-optimized storage for analytics and time-series data
- **Typed Repositories** - Type-safe database access layer with dependency injection

### Architecture Highlights

- **Simulation is pure compute** - No network, no database, no filesystem access
- **Workflows coordinate I/O** - All multi-step business logic lives in `@quantbot/workflows`
- **CLI handlers are thin adapters** - Parse args → call workflow → format output
- **Python integration via PythonEngine** - DuckDB queries, analysis scripts with Zod validation

### Secondary Features (Planned)

- **Backend REST API** - Fastify-based API (`@quantbot/api`)
- **Real-Time Monitoring** - Live CA drop detection (`@quantbot/monitoring`)
- **Web Dashboard** - Next.js analytics UI (`@quantbot/web`)
- **Telegram Bot** - Interactive command-driven bot (`@quantbot/bot`)

## 🚀 Golden Path Features

### 📥 Telegram Export Ingestion

- Parse HTML exports from Telegram
- Extract Solana addresses (full, case-preserved)
- Normalize into callers, alerts, calls, tokens
- Idempotent processing (no duplicates)

### 📈 OHLCV Data Management

- Fetch candles from Birdeye API
- Store in ClickHouse for fast queries
- Automatic caching and deduplication
- Support for 1m, 5m, 15m, 1h intervals

### 🎯 Strategy Simulation

- Pure simulation engine (deterministic, testable)
- Config-driven strategies
- Detailed event traces
- Comprehensive performance metrics

### 🔬 Research OS - Self-Evolving Trading Lab

**NEW**: Production-ready research services for reproducible experiments:

- **Data Snapshots** - Create reproducible data snapshots with content hashing

  ```bash
  quantbot research create-snapshot --from 2024-01-01T00:00:00Z --to 2024-01-02T00:00:00Z
  ```

- **Execution Models** - Realistic execution models with latency, slippage, and failure simulation

  ```bash
  quantbot research create-execution-model --latency-samples "100,200,300" --failure-rate 0.01
  ```

- **Cost Models** - Comprehensive cost models including fees, priority fees, and trading costs

  ```bash
  quantbot research create-cost-model --base-fee 5000 --trading-fee-percent 0.01
  ```

- **Risk Models** - Risk constraints and circuit breakers for safe trading
  ```bash
  quantbot research create-risk-model --max-drawdown-percent 20 --max-loss-per-day 1000
  ```

- **Leaderboard** - Rank and compare simulation runs by metrics
  ```bash
  quantbot research leaderboard --criteria return --limit 10
  quantbot research leaderboard --criteria winRate --strategy-name MyStrategy
  ```

See **[docs/guides/research-services-usage.md](docs/guides/research-services-usage.md)** for complete usage guide.

### 📊 Analytics & Reporting

- Simulation run tracking
- Aggregated performance metrics
- Event-level traces for debugging
- Strategy comparison tools

## Secondary Features (Not Golden Path)

### 📊 Trading Simulation Engine (Legacy)

- **Multi-Chain Support**: Solana, Ethereum, BSC, Base, Arbitrum
- **Hybrid Candle Fetching**: 5-minute recent + 1-hour historical data
- **Customizable Strategies**: Take-profit targets, stop-loss (initial + trailing), re-entry logic
- **Config-Driven**: JSON-based simulation configuration
- **Performance Metrics**: Detailed PNL, win rates, risk metrics
- **Strategy Optimization**: Built-in optimization tools and ML-based strategy finder
- **Batch Execution**: Run multiple scenarios in parallel

### 🎯 Real-Time CA Monitoring

- **Automatic Detection**: Detects CA drops in chat messages
- **Multi-Source Tracking**: Brook, CurlyJoe, and custom channels
- **Real-Time Alerts**: Profit targets (2x, 5x, 10x), stop-loss notifications
- **Ichimoku Cloud Analysis**: Advanced technical indicators with signal alerts
- **Price Tracking**: WebSocket-based real-time price updates via Helius
- **Performance Summaries**: Hourly and daily performance reports

### 💰 Live Execution Architecture

**Current State**: Live execution is intentionally isolated behind `ExecutionPort` and a dedicated executor app boundary. This repo currently focuses on ingestion, simulation, and deterministic strategy evaluation.

**Architecture**:

- **ExecutionPort Interface**: Defined in `@quantbot/core` - handlers depend on ports, not implementations
- **Stub Adapter**: Safety-first stub with dry-run mode, circuit breakers, and idempotency (default enabled)
- **Executor App Boundary**: Live trading runtime concerns (keys, signing, RPC/Jito submission, risk gates) live in a separate app boundary (`apps/executor` or `packages/executor`)
- **Reusability**: Pure logic (core handlers + ports + workflows) is reusable for live trading without modification

**Why This Design**:

- **Safety**: Hard-walled separation between research/backtesting and live execution
- **Reusability**: Same handlers/workflows work for both simulation and live trading
- **Flexibility**: Can enable live execution when ready without architectural changes
- **Compliance**: Executor boundary can have different access control, deployment cadence, and security posture

**Execution adapters exist only as stubs/dry-run unless explicitly enabled in the executor app boundary.**

### 💾 Data Storage & Analytics

- **DuckDB**: Primary OLAP database for analytics and simulation results
- **ClickHouse**: High-performance time-series database for OHLCV data
- **Python Integration**: DuckDB queries via PythonEngine with Zod validation
- **Comprehensive Analytics**: Historical analysis, caller performance, token scoring

#### Storage Rules

- **Mint addresses**: Never truncate, preserve exact case (32-44 chars)
- **Parameterized queries**: Always use `{param:Type}` syntax for ClickHouse
- **JSON-serializable results**: All workflow results must be serializable

### 🤖 Telegram Bot Commands

#### Core Commands

- `/backtest` - Start a new PNL simulation
- `/repeat` - Repeat previous simulation with new strategy
- `/strategy` - Manage custom trading strategies (save, use, delete, list)
- `/cancel` - Cancel current simulation session
- `/ichimoku` - Start Ichimoku Cloud analysis for a token

#### Analysis Commands

- `/analysis` - Run comprehensive historical analysis on CA drops
- `/calls <token>` - Show all historical calls for a token
- `/callers` - Show top callers statistics
- `/recent` - Show recent CA calls (last 15)
- `/backtest_call` - Backtest a specific historical call
- `/history` - View simulation history

#### Monitoring Commands

- `/alerts` - View active alerts and monitoring status
- `/alert` - Check specific alert status
- `/livetrade` - Manage live trade entry alerts
- `/watchlist` - View and manage monitored tokens
- `/addcurlyjoe` - Add recent CurlyJoe calls to monitoring

#### Utility Commands

- `/begin` - Welcome message and bot introduction
- `/options` - Show all available commands
- `/extract` - Extract CA drops from HTML chat messages

## 🏗️ Architecture

QuantBot follows a **modular monorepo architecture** with strict layering:

```text
┌─────────────────────────────────────────────────────────────┐
│  APPLICATION LAYER: cli, tui, api (thin adapters)           │
├─────────────────────────────────────────────────────────────┤
│  ORCHESTRATION LAYER: workflows (coordinate I/O)            │
├─────────────────────────────────────────────────────────────┤
│  SERVICE LAYER: simulation (pure), ohlcv, ingestion,        │
│                 analytics                                    │
├─────────────────────────────────────────────────────────────┤
│  INFRASTRUCTURE LAYER: storage, api-clients, observability  │
├─────────────────────────────────────────────────────────────┤
│  FOUNDATION LAYER: core (types), utils (EventBus, logger)   │
└─────────────────────────────────────────────────────────────┘
```

### Package Structure

```text
packages/
├── core/           # Foundation types (Candle, Chain, Token, etc.)
├── utils/          # Shared utilities (logger, EventBus, PythonEngine)
├── storage/        # Storage layer (DuckDB, ClickHouse)
├── observability/  # Logging, metrics, error tracking
├── api-clients/    # External API clients (Birdeye, Helius)
├── ohlcv/          # OHLCV data services with hybrid fetching
├── analytics/      # Analytics engine and metrics
├── ingestion/      # Data ingestion (Telegram parsing)
├── simulation/     # Pure simulation engine (NO I/O)
├── workflows/      # Workflow orchestration (coordinates all I/O)
├── cli/            # Command-line interface (Commander.js)
├── tui/            # Terminal UI (Ink)
└── jobs/           # Background job processing
```

### Build Order

Packages must be built in dependency order:

```bash
pnpm build:ordered
```

| Position | Package                             | Dependencies               |
| -------- | ----------------------------------- | -------------------------- |
| 1        | core                                | None                       |
| 2        | utils                               | core                       |
| 3-5      | storage, observability, api-clients | utils, core                |
| 6-8      | ohlcv, analytics, ingestion         | service deps               |
| 9        | simulation                          | utils, core (pure compute) |
| 10       | workflows                           | all services               |
| 11+      | cli, tui, etc.                      | all packages               |

See **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)** for detailed architecture documentation.

## 🔧 Setup & Installation

### Prerequisites

- **Node.js** 18+ and npm
- **Docker** and Docker Compose (for databases)
- **Telegram Bot Token** - Get from [@BotFather](https://t.me/botfather)
- **Birdeye API Keys** - Multiple keys recommended for rate limit handling
- **Helius API Key** - For Solana WebSocket monitoring
- **Shyft API Key** (optional) - For additional Solana data

### Installation & Quick Start

```bash
# Clone repository
git clone <repository-url>
cd quantBot

# Install dependencies
npm install

# Copy environment template
cp env.example .env

# Edit .env with your API keys and configuration
nano .env

# Start databases (PostgreSQL, ClickHouse, InfluxDB)
docker-compose up -d

# Initialize databases (first time only)
npm run clickhouse:setup

# Start the bot
npm run dev
```

### Environment Configuration

Create a `.env` file with the following variables:

```env
# DuckDB (Primary Database - file-based, no config needed)
DUCKDB_PATH=./data/quantbot.duckdb

# ClickHouse (Time-Series Database)
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=18123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=quantbot

# Birdeye API (Multiple keys for rate limit handling)
BIRDEYE_API_KEY=your_primary_key
BIRDEYE_API_KEY_1=your_first_key
BIRDEYE_API_KEY_2=your_second_key
# Add more as needed...

# Helius API
HELIUS_API_KEY=your_helius_key

# Logging
LOG_LEVEL=info  # error, warn, info, debug, trace
LOG_CONSOLE=true
LOG_FILE=true
LOG_DIR=./logs
LOG_MAX_FILES=14d
LOG_MAX_SIZE=20m

# Application
NODE_ENV=development
PORT=3000

# Optional: Telegram Bot (for future bot integration)
# BOT_TOKEN=your_telegram_bot_token
# TELEGRAM_CHAT_ID=your_chat_id
```

### Database Setup

#### DuckDB (Primary Storage)

DuckDB is the primary OLAP database for analytics and simulation results. No setup required - databases are created automatically as single files.

```bash
# Default database location
data/quantbot.duckdb
data/result.duckdb
```

#### ClickHouse (Time-Series)

```bash
# Start ClickHouse
docker-compose up -d clickhouse

# Initialize schema
pnpm clickhouse:setup
```

ClickHouse stores OHLCV candle data with time-based partitioning.

#### Python Tools (DuckDB Integration)

DuckDB queries are executed via Python scripts through `PythonEngine`:

```bash
# Ensure Python dependencies
pip install duckdb pandas

# Python scripts are in tools/
tools/simulation/duckdb_storage.py
tools/analysis/duckdb_query.py
```

See [docs/MIGRATION_POSTGRES_TO_DUCKDB.md](docs/MIGRATION_POSTGRES_TO_DUCKDB.md) for migration details.

## 📖 Usage

### Running the Bot

```bash
# Development mode (with hot reload)
npm run dev

# Production mode
npm start
```

### Running Simulations

#### Via Telegram Bot

1. Start a simulation: `/backtest`
2. Follow the interactive workflow:
   - Paste token address
   - Select chain (if EVM)
   - Enter start datetime
   - Configure strategy
   - Set stop-loss parameters

#### Via Config Files

```bash
# Run simulation from config
npm run simulate:config -- --config=configs/simulations/top-strategies.json
```

#### Programmatic API

```typescript
import { simulateStrategy } from '@quantbot/simulation';
import { fetchHybridCandles } from '@quantbot/ohlcv';

const candles = await fetchHybridCandles(tokenAddress, startTime, endTime, chain);
const result = await simulateStrategy(candles, strategy, stopLossConfig);
```

### Monitoring Services

```bash
# Start Brook channel monitoring
npm run monitor:brook

# Forward Brook channel messages
npm run forward:brook

# Monitor API credits
npm run monitor:credits
```

### Analysis Scripts

```bash
# Historical analysis
npm run analysis

# Caller statistics
npm run caller:stats

# Analyze callers
npm run analyze:callers

# Score and analyze unified calls
npm run score:unified-calls
```

## Strategy Configuration

### Take-Profit Strategy Format

```text
Simple: 50@2x,30@5x,20@10x
JSON: [{"percent":0.5,"target":2},{"percent":0.3,"target":5},{"percent":0.2,"target":10}]
```

### Stop-Loss Configuration

```text
Format: initial: -30%, trailing: 50%
Examples:
- initial: -20%, trailing: 30%
- initial: -50%, trailing: 100%
- initial: -30%, trailing: none
- default (uses system defaults)
```

### Entry Configuration

```text
initialEntry: none | immediate | trailing
trailingEntry: none | price | percent
maxWaitTime: 60 (minutes)
```

### Re-Entry Configuration

```text
trailingReEntry: none | price | percent
maxReEntries: 0-10
sizePercent: 0.5 (50% of original position)
```

## 📊 Supported Chains

- **◎ Solana** - Native support with Helius WebSockets
- **⟠ Ethereum** - EVM chain support
- **🟡 Binance Smart Chain (BSC)** - EVM chain support
- **🔵 Base** - EVM chain support
- **🔷 Arbitrum** - EVM chain support

## 🔌 API Integrations

### Birdeye API

- Multi-key rotation for rate limit handling
- Token metadata fetching
- OHLCV candle data
- Multi-chain support
- Intelligent caching (10-50x faster queries)

### Helius WebSockets

- Real-time price updates
- Automatic reconnection
- Efficient subscription management
- Solana-specific optimizations

### Shyft API (Optional)

- Additional Solana data sources
- WebSocket and gRPC support
- Enhanced monitoring capabilities

## 🛠️ Development

### Project Structure

```text
quantBot/
├── packages/              # Modular packages (see Architecture above)
├── scripts/               # Standalone scripts and tools
│   ├── ingest/           # Ingestion scripts
│   ├── migration/        # Database migrations
│   └── test/             # Test utilities
├── tools/                 # Python tools
│   ├── analysis/         # Analysis scripts (DuckDB)
│   ├── simulation/       # DuckDB storage scripts
│   └── telegram/         # Telegram parsing tools
├── docs/                  # Documentation
├── configs/               # Configuration files
├── .cursor/rules/         # Architectural rules (enforced)
└── tests/                 # Root test setup
```

### Building

```bash
# Build all packages (in correct dependency order)
pnpm build:ordered

# Build individual package (ensure deps are built first)
pnpm --filter @quantbot/utils build
pnpm --filter @quantbot/storage build
pnpm --filter @quantbot/ingestion build
```

### Workflow Pattern

All multi-step business logic goes through workflows:

```typescript
// CLI handler (thin adapter)
async function myHandler(args: Args, ctx: CommandContext) {
  const service = ctx.services.myService();
  return service.doSomething(args); // Returns data, not formatted output
}

// Workflow (orchestrates I/O)
async function runMyWorkflow(spec: Spec, ctx: WorkflowContext) {
  const data = await ctx.repos.calls.findByRange(spec.from, spec.to);
  const result = await ctx.simulation.run(data, spec.strategy);
  await ctx.repos.runs.save(result);
  return { success: true, runId: result.id }; // JSON-serializable
}
```

See `.cursor/rules/packages-workflows.mdc` for workflow patterns.

### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage

# Test specific package
npm run test --workspace=packages/cli
```

### Code Quality

```bash
# Lint code
npm run lint

# Fix linting issues
npm run lint:fix

# Format code
npm run format
```

## 📚 Documentation

### Core Documentation

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** - System architecture and layer responsibilities
- **[TODO.md](TODO.md)** - Project roadmap and task tracking
- **[CHANGELOG.md](CHANGELOG.md)** - Version history and changes

### Architecture Rules (`.cursor/rules/`)

- `build-ordering.mdc` - Package build order enforcement
- `packages-workflows.mdc` - Workflow orchestration patterns
- `packages-cli-handlers.mdc` - CLI handler patterns
- `packages-simulation.mdc` - Simulation rules (pure compute)
- `testing.mdc` - Testing philosophy and requirements

### Additional Guides

- **[docs/OHLCV_ARCHITECTURE.md](docs/OHLCV_ARCHITECTURE.md)** - OHLCV subsystem details
- **[docs/WORKFLOW_ENFORCEMENT.md](docs/WORKFLOW_ENFORCEMENT.md)** - Workflow patterns
- **[docs/MIGRATION_POSTGRES_TO_DUCKDB.md](docs/MIGRATION_POSTGRES_TO_DUCKDB.md)** - DuckDB migration
- **[docs/guides/](docs/guides/)** - How-to guides
  - **[Research Services Usage](docs/guides/research-services-usage.md)** - Complete guide to DataSnapshotService and ExecutionRealityService
  - **[Research Services Integration](docs/guides/research-services-integration.md)** - Integration patterns and best practices

## 🔒 Security

- Input validation and sanitization
- SQL injection prevention (parameterized queries)
- Rate limiting on commands
- Session expiration and cleanup
- Secure error handling (no sensitive data exposure)
- Path traversal protection

## 📈 Performance

- **Caching**: CSV-based OHLCV caching with 24-hour expiry
- **Connection Pooling**: Database connection management
- **Batch Operations**: Parallel processing where possible
- **WebSocket Efficiency**: Smart subscription management
- **Query Optimization**: Indexed database queries

## 🚨 Error Handling

- Graceful API failure handling with retries
- Automatic WebSocket reconnection
- Database transaction safety
- User-friendly error messages
- Comprehensive logging with context

## 🗂️ Backups

Create project backups (excludes build artifacts):

```bash
./scripts/backup-project.sh
```

Archives are stored in `backups/quantbot-backup-<timestamp>.tar.gz`

## 🤝 Contributing

### Code Guidelines

1. **Follow architectural rules** - See `.cursor/rules/` for enforced patterns
2. **Use package imports** - `@quantbot/utils`, `@quantbot/storage`, `@quantbot/workflows`, etc.
3. **No multi-step logic in CLI** - Move to `@quantbot/workflows`
4. **Handlers are thin adapters** - Parse args → call service → return data
5. **Simulation is pure** - No I/O, no clocks, no global config
6. **Never truncate mint addresses** - Store/pass full 32-44 char addresses

### Workflow Pattern

All multi-step business flows must go through `@quantbot/workflows`:

- ❌ CLI handler that fetches → simulates → persists
- ✅ CLI handler calls workflow, workflow coordinates all I/O

### Testing Requirements

- Write tests for all new functions (80%+ coverage target)
- Property tests for financial calculations
- Handler tests must be REPL-friendly (no CLI infrastructure)
- **Regression tests required for all bug fixes** - Tests must prevent bugs from reoccurring
- See `.cursor/rules/testing.mdc` for testing philosophy
- See `.cursor/rules/debugging-regression-test.mdc` for regression test requirements

### PR Checklist

- [ ] Unit tests for new functions
- [ ] **Regression tests for bug fixes** (mandatory per `.cursor/rules/debugging-regression-test.mdc`)
- [ ] No forbidden imports (workflows can't import CLI)
- [ ] CLI handlers are thin adapters
- [ ] Workflow results are JSON-serializable
- [ ] CHANGELOG.md updated
- [ ] Documentation updated

## 📝 License

ISC License - See LICENSE file for details

## 🙏 Acknowledgments

- Birdeye API for market data
- Helius for Solana WebSocket infrastructure
- Telegram for bot platform
- All contributors and users

## Support

For issues, questions, or contributions, please open an issue on GitHub.

---

Built with ❤️ for the crypto trading community

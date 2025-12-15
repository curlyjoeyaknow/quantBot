# QuantBot - Solana Analytics & Backtesting Pipeline

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/License-ISC-blue.svg)](LICENSE)

**A clean, focused analytics and backtesting pipeline for Solana token trading strategies.**

This repository is primarily an **analytics & simulation engine**. Live trading execution is handled elsewhere.

## 🎯 Golden Path: Analytics Pipeline

The Golden Path is the core focus of this repository - a clean pipeline for:

1. **Telegram Export Ingestion** → Parse caller alerts and extract token addresses
2. **OHLCV Data Collection** → Fetch and store candle data from Birdeye
3. **Strategy Simulation** → Run pure, deterministic backtests on historical calls
4. **Performance Analytics** → Evaluate strategy performance with detailed metrics

### Quick Start

**🚀 Get started in 5 minutes:** See **[docs/QUICK_START.md](docs/QUICK_START.md)**

**📖 Complete workflows:** See **[docs/WORKFLOWS.md](docs/WORKFLOWS.md)**

**CLI Commands:**

```bash
# 1. Ingest Telegram export
pnpm ingest:telegram --file data/raw/messages/brook7/messages.html --caller-name Brook

# 2. Fetch OHLCV for calls
pnpm ingest:ohlcv --from 2024-01-01 --to 2024-02-01

# 3. Run simulation
pnpm simulate:calls --strategy MyStrategy --caller Brook --from 2024-01-01 --to 2024-02-01
```

**Web Interface:**

- Start web server: `cd packages/web && pnpm dev`
- Open: `http://localhost:3000/golden-path`
- Use UI to run all workflows

**API Endpoints:**

The backend API (`@quantbot/api`) provides REST endpoints for all services:

- `GET /api/v1/health` - Health check
- `GET /api/v1/ohlcv/candles` - Fetch OHLCV candles
- `GET /api/v1/tokens` - Token metadata and management
- `GET /api/v1/calls` - Token call history
- `GET /api/v1/simulations/runs` - Simulation run management
- `POST /api/v1/ingestion/ohlcv` - Trigger OHLCV ingestion
- `GET /api/docs` - Interactive API documentation (Swagger UI)

**API Documentation:**

- Interactive Swagger UI: `http://localhost:3000/api/docs`
- OpenAPI JSON: `http://localhost:3000/api/docs/json`

See **[docs/GOLDEN_PATH.md](docs/GOLDEN_PATH.md)** for complete documentation.

## 🎯 Overview

QuantBot's Golden Path provides:

- **Telegram Export Parsing** - Extract calls from Telegram HTML exports
- **OHLCV Ingestion** - Fetch and store candle data from Birdeye API
- **Pure Simulation Engine** - Deterministic backtesting with no side effects
- **Postgres + ClickHouse** - Clean separation of OLTP and OLAP data
- **Typed Repositories** - Type-safe database access layer

### Secondary Features (Not Golden Path)

- **Backend REST API** - Fastify-based API exposing all services (see `packages/api/`)
- **Real-Time Monitoring** - Live CA drop detection (see `packages/monitoring/`)
- **Telegram Bot Interface** - Interactive command-driven bot (planned - `packages/bot/`)
- **Web Dashboard** - Next.js-based analytics UI (planned - `packages/web/`)
- **Live Trading** - Execution system (planned - `packages/trading/`)

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

### 💰 Live Trading System (Coming Soon) 🔥

- **Strategy-Based Execution**: Execute trades using user-defined strategies
- **Alert-Triggered Trading**: Automatic trade execution from alerts
- **Helius RPC Integration**: Optimized Amsterdam/mainnet endpoints
- **Relayer Support**: High-speed transaction sending via relayers
- **Position Management**: Real-time position tracking and PNL
- **Risk Controls**: Slippage protection, position limits, daily loss limits
- **Safety Features**: Dry-run mode, trade confirmation, comprehensive logging

### 💾 Data Storage & Analytics

- **PostgreSQL**: Primary OLTP database for transactions and metadata
- **ClickHouse**: High-performance time-series database for OHLCV and events
- **InfluxDB**: Optional real-time monitoring (legacy support)
- **SQLite**: Legacy support with migration tools
- **Comprehensive Analytics**: Historical analysis, caller performance, token scoring

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

QuantBot follows a **modular monorepo architecture** with clear separation of concerns:

```text
quantBot/
├── packages/
│   ├── @quantbot/core/          # Core types and interfaces (Candle, Chain, etc.)
│   ├── @quantbot/utils/         # Shared utilities (logger, errors, helpers, EventBus)
│   ├── @quantbot/storage/       # Unified storage layer (Postgres, ClickHouse, InfluxDB, SQLite, Cache)
│   ├── @quantbot/api-clients/   # External API clients (Birdeye, Helius)
│   ├── @quantbot/ohlcv/        # OHLCV data services (uses StorageEngine)
│   ├── @quantbot/simulation/    # Trading simulation engine
│   ├── @quantbot/token-analysis/# Token analysis services
│   ├── @quantbot/ingestion/    # Data ingestion (Telegram export, OHLCV)
│   ├── @quantbot/workflows/    # Workflow orchestration
│   ├── @quantbot/monitoring/    # Real-time monitoring services
│   └── @quantbot/api/          # Backend REST API (Fastify) - NEW
├── scripts/                     # Standalone scripts and tools
├── docs/                        # Documentation
└── configs/                     # Configuration files
```

See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture documentation.

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
# Telegram Bot
BOT_TOKEN=your_telegram_bot_token
TELEGRAM_BOT_TOKEN=your_telegram_bot_token  # Alternative name
TELEGRAM_CHAT_ID=your_chat_id

# PostgreSQL (Primary Database)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=quantbot
POSTGRES_PASSWORD=your_secure_password
POSTGRES_DATABASE=quantbot
POSTGRES_MAX_CONNECTIONS=10

# ClickHouse (Time-Series Database)
USE_CLICKHOUSE=true
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=18123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=quantbot

# InfluxDB (Optional - Legacy)
INFLUX_URL=http://localhost:8086
INFLUX_TOKEN=your-admin-token
INFLUX_ORG=quantbot
INFLUX_BUCKET=ohlcv_data

# Birdeye API (Multiple keys for rate limit handling)
BIRDEYE_API_KEY=your_primary_key
BIRDEYE_API_KEY_1=your_first_key
BIRDEYE_API_KEY_2=your_second_key
# Add more as needed...

# Helius API
HELIUS_API_KEY=your_helius_key

# Shyft API (Optional)
SHYFT_API_KEY=your_shyft_key
SHYFT_X_TOKEN=your_shyft_x_token
SHYFT_WS_URL=wss://your-shyft-ws-url
SHYFT_GRPC_URL=your-shyft-grpc-url

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
```

### Database Setup

#### PostgreSQL Setup

```bash
# Start PostgreSQL
docker-compose up -d postgres

# Initialize schema (auto-initializes on first run, or manually):
psql -U quantbot -d quantbot -f scripts/migration/postgres/001_init.sql
```

#### ClickHouse Setup

```bash
# Start ClickHouse
docker-compose up -d clickhouse

# Initialize schema
npm run clickhouse:setup
```

#### Migration from SQLite (If Upgrading)

```bash
# Backup existing data
./scripts/migration/backup-sqlite-dbs.sh

# Run migration
./scripts/migration/run-migration.sh

# Verify migration
tsx scripts/migration/verify-migration.ts
```

See [Migration Quick Start](scripts/migration/QUICKSTART.md) for detailed instructions.

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
import { SimulationEngine } from '@quantbot/simulation';
import { fetchHybridCandles } from '@quantbot/simulation/candles';

const engine = new SimulationEngine();
const candles = await fetchHybridCandles(tokenAddress, startTime, endTime, chain);
const result = await engine.simulate(candles, strategy, stopLossConfig);
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
├── packages/              # Modular packages
│   ├── core/             # Core types and interfaces
│   ├── utils/            # Shared utilities (logger, EventBus)
│   ├── storage/          # Unified storage (Postgres, ClickHouse, Cache)
│   ├── api-clients/      # External API clients (Birdeye, Helius)
│   ├── ohlcv/            # OHLCV data services
│   ├── simulation/       # Simulation engine
│   ├── token-analysis/   # Token analysis services
│   ├── ingestion/        # Data ingestion
│   ├── workflows/        # Workflow orchestration
│   ├── monitoring/       # Real-time monitoring
│   └── api/              # Backend REST API (Fastify)
├── scripts/              # Standalone scripts
│   ├── analysis/        # Analysis tools
│   ├── migration/       # Database migrations
│   └── monitoring/      # Monitoring scripts
├── docs/                # Documentation
├── configs/             # Configuration files
└── tests/               # Test suites
```

### Building

```bash
# Build all packages
npm run build:packages

# Build individual package
npm run build --workspace=packages/utils
```

### Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage
npm run test:coverage

# Test specific package
npm run test --workspace=packages/bot
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

- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** - Detailed architecture documentation
- **[TODO.md](docs/TODO.md)** - Roadmap and task tracking
- **[Migration Guide](docs/migration/)** - Database migration documentation
- **[Package Migration](docs/PACKAGE_MIGRATION_SUMMARY.md)** - Package structure guide
- **[Bot Improvements](docs/bot-improvements.md)** - Bot functionality enhancements

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

1. Follow TypeScript best practices (see `.cursorrules`)
2. Use package imports: `@quantbot/utils`, `@quantbot/storage`, `@quantbot/ohlcv`, etc.
3. **Storage operations**: Always use `StorageEngine` from `@quantbot/storage` - never direct DB calls
4. **OHLCV operations**: Use `OHLCVEngine` or `OHLCVService` from `@quantbot/ohlcv`
5. **API clients**: Use `@quantbot/api-clients` for external API interactions
6. Write tests for new features
7. Update documentation
8. Follow commit message conventions

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

# QuantBot Complete Architectural Map

**Generated:** 2025-12-14  
**Version:** 1.0.3

## Table of Contents

1. [Directory Tree](#directory-tree)
2. [Package Architecture](#package-architecture)
3. [Dependency Graph](#dependency-graph)
4. [Data Flow Diagrams](#data-flow-diagrams)
5. [Key Components](#key-components)
6. [File Structure Details](#file-structure-details)

---

## Directory Tree

```
quantBot/
├── .cursor/                          # Cursor IDE rules and configuration
│   └── rules/                        # Package-specific development rules
│       ├── git-hooks.mdc
│       ├── packages-api-clients.mdc
│       ├── packages-ingestion.mdc
│       ├── packages-monitoring.mdc
│       ├── packages-simulation.mdc
│       ├── packages-storage.mdc
│       ├── packages-utils.mdc
│       ├── scripts.mdc
│       ├── templates.mdc
│       └── testing.mdc
│
├── .husky/                           # Git hooks
│   ├── pre-commit                    # Pre-commit checks
│   └── pre-push                      # Pre-push checks
│
├── backups/                          # Backup files
│   └── test-backup.tar.gz
│
├── cache/                            # Build cache
│
├── configs/                         # Configuration files
│   └── config/
│       ├── default.json
│       └── simulations/
│           ├── *.json
│           └── *.md
│
├── data/                            # Data directory
│   ├── backups/                     # Database backups
│   ├── cache/                       # CSV/JSON cache files
│   ├── databases/                   # SQLite databases
│   │   ├── caller_alerts.db
│   │   ├── dashboard_metrics.db
│   │   ├── simulations.db
│   │   ├── strategy_results.db
│   │   └── tokens.db
│   ├── exports/                     # Exported data
│   ├── logs/                        # Application logs
│   ├── messages/                    # Telegram messages
│   ├── processed/                   # Processed data
│   │   ├── analyzed/
│   │   └── filtered/
│   └── raw/                         # Raw data
│       ├── brook_ohlcv/
│       ├── brook_simulations/
│       ├── ca_drops/
│       ├── messages/
│       └── ohlcv/
│
├── docs/                            # Documentation
│   ├── api/
│   │   └── API_DOCUMENTATION.md
│   ├── ARCHITECTURE.md              # Main architecture doc
│   ├── ARCHITECTURAL_MAP.md         # This file
│   ├── CLI_TUI_ARCHITECTURE_PLAN.md
│   ├── CLI_TUI_PLAN.md
│   ├── GOLDEN_PATH.md
│   ├── PROJECT_STRUCTURE.md
│   ├── QUICK_START.md
│   ├── SCHEMA.md
│   ├── TODO.md
│   └── WORKFLOWS.md
│
├── logs/                            # Root-level logs
│   ├── combined-*.log
│   └── error-*.log
│
├── packages/                        # Monorepo packages
│   │
│   ├── analytics/                   # Analytics engine
│   │   ├── src/
│   │   │   ├── aggregators/
│   │   │   │   └── MetricsAggregator.ts
│   │   │   ├── engine/
│   │   │   │   └── AnalyticsEngine.ts
│   │   │   ├── loaders/
│   │   │   │   └── CallDataLoader.ts
│   │   │   ├── utils/
│   │   │   │   ├── ath-calculator.ts
│   │   │   │   └── period-metrics.ts
│   │   │   ├── types.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   └── properties/
│   │   ├── docs/
│   │   │   └── PERIOD_METRICS.md
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   │
│   ├── api/                         # REST API server
│   │   ├── src/
│   │   │   ├── middleware/
│   │   │   │   ├── auth.ts
│   │   │   │   └── validation.ts
│   │   │   ├── routes/
│   │   │   │   ├── ohlcv.ts
│   │   │   │   ├── tokens.ts
│   │   │   │   ├── calls.ts
│   │   │   │   ├── simulations.ts
│   │   │   │   ├── ingestion.ts
│   │   │   │   └── health.ts
│   │   │   ├── types/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── api-clients/                 # External API clients
│   │   ├── src/
│   │   │   ├── base-client.ts      # Base API client with retry/rate limiting
│   │   │   ├── birdeye-client.ts   # Birdeye API client
│   │   │   ├── helius-client.ts     # Helius REST client
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   ├── integration/
│   │   │   ├── properties/
│   │   │   └── fuzzing/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── bot/                         # Telegram bot (minimal)
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── cli/                         # CLI package
│   │   ├── src/
│   │   │   ├── bin/
│   │   │   │   └── quantbot.ts     # CLI entry point
│   │   │   ├── core/               # Core CLI infrastructure
│   │   │   │   ├── command-registry.ts
│   │   │   │   ├── argument-parser.ts
│   │   │   │   ├── output-formatter.ts
│   │   │   │   ├── error-handler.ts
│   │   │   │   └── initialization-manager.ts
│   │   │   ├── commands/           # Command modules
│   │   │   │   ├── ohlcv.ts
│   │   │   │   ├── simulation.ts
│   │   │   │   ├── ingestion.ts
│   │   │   │   ├── monitoring.ts
│   │   │   │   ├── analytics.ts
│   │   │   │   ├── storage.ts
│   │   │   │   ├── observability.ts
│   │   │   │   └── api-clients.ts
│   │   │   ├── types/
│   │   │   │   └── index.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   ├── integration/
│   │   │   ├── properties/
│   │   │   └── fuzzing/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── core/                        # Core types and interfaces
│   │   ├── src/
│   │   │   └── index.ts             # Core type exports
│   │   ├── tests/
│   │   │   └── unit/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── data/                        # Data utilities (minimal)
│   │   ├── src/
│   │   │   └── index.ts
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── events/                      # Event definitions (minimal)
│   │   └── tsconfig.json
│   │
│   ├── ingestion/                   # Data ingestion services
│   │   ├── src/
│   │   │   ├── TelegramAlertIngestionService.ts
│   │   │   ├── OhlcvIngestionService.ts
│   │   │   ├── TelegramExportParser.ts
│   │   │   ├── extractSolanaAddresses.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   └── unit/
│   │   ├── package.json
│   │   ├── README.md
│   │   └── tsconfig.json
│   │
│   ├── monitoring/                  # Real-time monitoring
│   │   ├── src/
│   │   │   ├── aggregation/
│   │   │   │   └── ohlcv-aggregator.ts
│   │   │   ├── backfill/
│   │   │   │   └── helius-backfill-service.ts
│   │   │   ├── engine/
│   │   │   │   └── MonitoringEngine.ts
│   │   │   ├── metrics/
│   │   │   │   ├── metrics-engine.ts
│   │   │   │   ├── benchmark.ts
│   │   │   │   ├── loader.ts
│   │   │   │   └── types.ts
│   │   │   ├── pumpfun/
│   │   │   │   └── pumpfun-lifecycle-tracker.ts
│   │   │   ├── stream/
│   │   │   │   └── helius-recorder.ts
│   │   │   ├── CAMonitoringService.ts
│   │   │   ├── helius-monitor.ts
│   │   │   ├── live-trade-alert-service.ts
│   │   │   ├── tenkan-kijun-alert-service.ts
│   │   │   ├── dex-transaction-parser.ts
│   │   │   ├── pump-idl-decoder.ts
│   │   │   ├── brook-call-ingestion.ts
│   │   │   ├── curlyjoe-call-ingestion.ts
│   │   │   ├── logger.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   └── unit/
│   │   ├── package.json
│   │   ├── README.md
│   │   └── tsconfig.json
│   │
│   ├── observability/               # Observability and health checks
│   │   ├── src/
│   │   │   ├── quotas.ts           # API quota tracking
│   │   │   ├── system-metrics.ts   # System metrics
│   │   │   ├── health.ts           # Health checks
│   │   │   ├── database-health.ts  # Database health
│   │   │   ├── error-tracking.ts   # Error tracking
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   └── unit/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── ohlcv/                       # OHLCV data services
│   │   ├── src/
│   │   │   ├── ohlcv-engine.ts     # Main OHLCV engine
│   │   │   ├── ohlcv-service.ts    # Service layer
│   │   │   ├── ohlcv-ingestion-engine.ts
│   │   │   ├── ohlcv-query.ts     # Query utilities
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   └── unit/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── simulation/                  # Trading simulation engine
│   │   ├── src/
│   │   │   ├── engine.ts           # Core simulation logic
│   │   │   ├── candles.ts          # Candle data handling
│   │   │   ├── ichimoku.ts         # Ichimoku calculations
│   │   │   ├── config.ts           # Configuration schemas
│   │   │   ├── strategies/         # Strategy definitions
│   │   │   │   ├── builder.ts
│   │   │   │   └── *.ts            # Strategy implementations
│   │   │   ├── indicators/         # Technical indicators
│   │   │   ├── signals/           # Signal generation
│   │   │   ├── sinks/             # Output sinks
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   ├── integration/
│   │   │   └── properties/
│   │   ├── docs/
│   │   │   └── PERIOD_METRICS.md
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── storage/                     # Unified storage layer
│   │   ├── src/
│   │   │   ├── engine/
│   │   │   │   └── StorageEngine.ts # Unified storage interface
│   │   │   ├── cache/
│   │   │   │   └── ohlcv-cache.ts  # LRU cache for OHLCV
│   │   │   ├── clickhouse/
│   │   │   │   ├── clickhouse-client.ts
│   │   │   │   └── repositories/
│   │   │   │       ├── OhlcvRepository.ts
│   │   │   │       ├── IndicatorsRepository.ts
│   │   │   │       ├── TokenMetadataRepository.ts
│   │   │   │       └── SimulationEventsRepository.ts
│   │   │   ├── postgres/
│   │   │   │   ├── postgres-client.ts
│   │   │   │   └── repositories/
│   │   │   │       ├── TokensRepository.ts
│   │   │   │       ├── CallsRepository.ts
│   │   │   │       ├── StrategiesRepository.ts
│   │   │   │       ├── AlertsRepository.ts
│   │   │   │       ├── CallersRepository.ts
│   │   │   │       ├── SimulationResultsRepository.ts
│   │   │   │       ├── SimulationRunsRepository.ts
│   │   │   │       ├── ApiQuotaRepository.ts
│   │   │   │       └── ErrorRepository.ts
│   │   │   ├── influxdb-client.ts  # Legacy InfluxDB support
│   │   │   └── index.ts
│   │   ├── migrations/
│   │   │   └── *.sql
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   └── integration/
│   │   ├── docs/
│   │   │   └── *.md
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── tui/                         # Terminal UI package
│   │   ├── src/
│   │   │   ├── app.ts              # Main TUI app
│   │   │   ├── core/
│   │   │   │   ├── state-manager.ts
│   │   │   │   ├── screen-manager.ts
│   │   │   │   ├── event-bus.ts
│   │   │   │   ├── keyboard-manager.ts
│   │   │   │   └── cli-bridge.ts
│   │   │   ├── screens/
│   │   │   │   ├── dashboard.ts
│   │   │   │   ├── monitoring-panel.ts
│   │   │   │   ├── ohlcv-viewer.ts
│   │   │   │   ├── analytics-viewer.ts
│   │   │   │   ├── simulation-runner.ts
│   │   │   │   └── command-palette.ts
│   │   │   ├── components/
│   │   │   │   ├── table.ts
│   │   │   │   ├── chart.ts
│   │   │   │   ├── panel.ts
│   │   │   │   ├── form.ts
│   │   │   │   └── status-bar.ts
│   │   │   ├── types/
│   │   │   │   └── index.ts
│   │   │   ├── bin/
│   │   │   │   └── tui.ts
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   └── unit/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   ├── utils/                       # Shared utilities
│   │   ├── src/
│   │   │   ├── logger.ts           # Winston logger
│   │   │   ├── logging/            # Package-aware logging
│   │   │   ├── errors/             # Error handling
│   │   │   ├── events/             # EventBus
│   │   │   ├── config.ts           # Configuration
│   │   │   ├── types.ts            # Shared types
│   │   │   ├── pumpfun.ts          # Pump.fun utilities
│   │   │   ├── credit-monitor.ts   # Credit monitoring
│   │   │   └── index.ts
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   └── properties/
│   │   ├── package.json
│   │   └── tsconfig.json
│   │
│   └── workflows/                   # Workflow orchestration (minimal)
│       └── tsconfig.json
│
├── scripts/                         # Standalone scripts
│   ├── analysis/                   # Analysis scripts
│   │   ├── analyze-*.ts
│   │   └── *.ts
│   ├── data-processing/             # Data processing
│   │   └── *.ts
│   ├── git/                        # Git utilities
│   │   └── check-test-requirements.ts
│   ├── ingest/                     # Ingestion scripts
│   │   └── *.ts
│   ├── migration/                  # Database migrations
│   │   ├── *.sql
│   │   └── *.sh
│   ├── monitoring/                 # Monitoring scripts
│   │   └── *.ts
│   ├── ohlcv/                     # OHLCV scripts
│   │   └── run-backfill.ts
│   ├── simulation/                 # Simulation scripts
│   │   └── run-engine.ts
│   ├── test/                      # Test scripts
│   │   └── *.ts
│   └── workflows/                 # Workflow scripts
│       └── *.ts
│
├── templates/                      # Frontend templates (Next.js)
│   ├── app/                        # Next.js app directory
│   ├── components/                # React components
│   ├── hooks/                      # React hooks
│   ├── lib/                        # Utility libraries
│   ├── public/                     # Static assets
│   ├── styles/                     # CSS styles
│   ├── package.json
│   └── tsconfig.json
│
├── tests/                          # Root-level tests
│   └── setup.ts
│
├── .gitignore
├── docker-compose.yml              # Docker services (Postgres, ClickHouse)
├── env.example                     # Environment variables template
├── eslint.config.mjs               # ESLint configuration
├── package.json                    # Root package.json
├── pnpm-lock.yaml                  # pnpm lockfile
├── pnpm-workspace.yaml             # pnpm workspace config
├── README.md
├── tsconfig.base.json              # Base TypeScript config
├── tsconfig.json                   # Root TypeScript config
├── tsconfig.scripts.json           # Scripts TypeScript config
└── vitest.config.ts                # Vitest configuration
```

---

## Package Architecture

### Package Dependency Hierarchy

```
Level 0 (Foundation):
└── @quantbot/core
    └── No dependencies (base types only)

Level 1 (Base Utilities):
└── @quantbot/utils
    └── Depends on: @quantbot/core

Level 2 (Infrastructure):
├── @quantbot/storage
│   └── Depends on: @quantbot/utils, @quantbot/core
│
└── @quantbot/api-clients
    └── Depends on: @quantbot/utils

Level 3 (Domain Services):
├── @quantbot/ohlcv
│   └── Depends on: @quantbot/storage, @quantbot/api-clients, 
│                   @quantbot/simulation, @quantbot/utils
│
├── @quantbot/simulation
│   └── Depends on: @quantbot/storage, @quantbot/utils, @quantbot/core
│
├── @quantbot/monitoring
│   └── Depends on: @quantbot/storage, @quantbot/utils
│
└── @quantbot/observability
    └── Depends on: @quantbot/storage, @quantbot/utils

Level 4 (Application Services):
├── @quantbot/ingestion
│   └── Depends on: @quantbot/ohlcv, @quantbot/storage, @quantbot/utils
│
├── @quantbot/analytics
│   └── Depends on: @quantbot/storage, @quantbot/utils
│
└── @quantbot/api
    └── Depends on: @quantbot/storage, @quantbot/ohlcv, 
                    @quantbot/ingestion, @quantbot/utils

Level 5 (User Interfaces):
├── @quantbot/cli
│   └── Depends on: All packages (orchestrates commands)
│
└── @quantbot/tui
    └── Depends on: @quantbot/cli, all packages
```

### Package Responsibilities

| Package | Purpose | Key Exports |
|---------|---------|-------------|
| `@quantbot/core` | Core types and interfaces | `Candle`, `Chain`, type definitions |
| `@quantbot/utils` | Shared utilities | Logger, EventBus, error handling, config |
| `@quantbot/storage` | Unified storage layer | `StorageEngine`, repositories, cache |
| `@quantbot/api-clients` | External API clients | `BirdeyeClient`, `HeliusRestClient` |
| `@quantbot/ohlcv` | OHLCV data services | `OHLCVEngine`, `OHLCVService` |
| `@quantbot/simulation` | Trading simulation | `SimulationEngine`, strategies, indicators |
| `@quantbot/monitoring` | Real-time monitoring | `HeliusMonitor`, `CAMonitoringService` |
| `@quantbot/observability` | Health & metrics | Quota tracking, health checks |
| `@quantbot/ingestion` | Data ingestion | Telegram parsing, OHLCV ingestion |
| `@quantbot/analytics` | Analytics engine | `AnalyticsEngine`, metrics aggregation |
| `@quantbot/api` | REST API server | Fastify server, route handlers |
| `@quantbot/cli` | CLI interface | Command registry, argument parser |
| `@quantbot/tui` | Terminal UI | Interactive dashboard, screens |

---

## Dependency Graph

### Visual Dependency Flow

```
                    ┌─────────────┐
                    │    core     │ (no deps)
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │    utils    │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
┌───────▼───────┐  ┌───────▼───────┐  ┌───────▼───────┐
│   storage     │  │ api-clients    │  │ observability │
└───────┬───────┘  └───────┬───────┘  └───────────────┘
        │                  │
        │                  │
┌───────▼───────┐  ┌───────▼───────┐
│    ohlcv      │  │  monitoring   │
└───────┬───────┘  └───────────────┘
        │
        │
┌───────▼───────┐  ┌───────▼───────┐
│  simulation   │  │   ingestion   │
└───────┬───────┘  └───────┬───────┘
        │                  │
        └──────────┬───────┘
                   │
        ┌──────────▼───────┐
        │       api        │
        └──────────┬───────┘
                   │
        ┌──────────▼───────┐
        │       cli         │
        └──────────┬───────┘
                   │
        ┌──────────▼───────┐
        │       tui         │
        └───────────────────┘
```

---

## Data Flow Diagrams

### OHLCV Data Flow

```
External API (Birdeye)
    │
    ▼
@quantbot/api-clients (BirdeyeClient)
    │
    ▼
@quantbot/ohlcv (OHLCVEngine)
    │
    ├──► Check StorageEngine cache (LRU)
    │         │
    │         ├──► Cache Hit: Return cached data
    │         └──► Cache Miss: Continue
    │
    ├──► Check StorageEngine database (ClickHouse)
    │         │
    │         ├──► DB Hit: Return data, update cache
    │         └──► DB Miss: Continue
    │
    └──► Fetch from API
            │
            ▼
    StorageEngine.storeCandles()
            │
            ├──► Store in ClickHouse
            └──► Update cache
```

### Simulation Flow

```
User Request (CLI/API)
    │
    ▼
@quantbot/cli or @quantbot/api
    │
    ▼
@quantbot/simulation (SimulationEngine)
    │
    ├──► Fetch candles via StorageEngine
    │         │
    │         ▼
    │    @quantbot/ohlcv (OHLCVEngine)
    │         │
    │         ▼
    │    StorageEngine.getCandles()
    │
    ▼
SimulationEngine.simulate()
    │
    ├──► Strategy execution
    ├──► Stop-loss checks
    ├──► Target resolution
    └──► Event generation
    │
    ▼
StorageEngine.storeSimulationResults()
    │
    ├──► Store metadata in PostgreSQL
    └──► Store events in ClickHouse
```

### Ingestion Flow

```
Telegram Export / Alert
    │
    ▼
@quantbot/ingestion (TelegramAlertIngestionService)
    │
    ├──► Parse export/alert
    ├──► Extract token addresses
    └──► Store in StorageEngine
            │
            ▼
    StorageEngine.getOrCreateToken()
    StorageEngine.createCall()
            │
            ▼
    PostgreSQL (tokens, calls tables)
```

### Monitoring Flow

```
Helius WebSocket / Yellowstone gRPC
    │
    ▼
@quantbot/monitoring (HeliusMonitor)
    │
    ▼
CAMonitoringService
    │
    ├──► Price tracking
    ├──► Alert generation
    └──► Performance calculation
    │
    ▼
EventBus (from @quantbot/utils)
    │
    ├──► Alert handlers (send notifications)
    ├──► Data ingestion (save to ClickHouse)
    └──► Analytics (update dashboards)
```

---

## Key Components

### StorageEngine Pattern

**Location:** `packages/storage/src/engine/StorageEngine.ts`

**Purpose:** Unified interface for all storage operations

**Key Methods:**
- `getCandles()` - Fetch OHLCV candles (checks cache, then DB, then API)
- `storeCandles()` - Store candles (updates cache and DB)
- `getTokens()` - Fetch token metadata
- `getCalls()` - Fetch call history
- `getSimulationRuns()` - Fetch simulation runs
- `storeSimulationResults()` - Store simulation results

**Benefits:**
- Single point of access for all storage operations
- Automatic caching
- Consistent error handling
- Easy to test and mock

### OHLCV Engine

**Location:** `packages/ohlcv/src/ohlcv-engine.ts`

**Purpose:** Main interface for OHLCV operations

**Key Features:**
- Uses StorageEngine for all storage operations
- Automatic cache checking
- Fallback to API when needed
- Supports multiple intervals (1m, 5m, 15m, 1h)

### Simulation Engine

**Location:** `packages/simulation/src/engine.ts`

**Purpose:** Trading simulation with strategy execution

**Key Features:**
- Strategy builder pattern
- Technical indicators (Ichimoku, etc.)
- Stop-loss and target resolution
- Event generation

### CLI Command Registry

**Location:** `packages/cli/src/core/command-registry.ts`

**Purpose:** Centralized command registration and execution

**Key Features:**
- Package-based command modules
- Zod schema validation
- Output formatting (JSON, table, CSV)
- Error handling

### EventBus

**Location:** `packages/utils/src/events/EventBus.ts`

**Purpose:** Event-driven communication between packages

**Key Features:**
- Decoupled component communication
- Type-safe event handling
- Async event processing

---

## File Structure Details

### Package Structure Template

Each package follows this structure:

```
packages/<package-name>/
├── src/
│   ├── index.ts              # Public API exports
│   └── ...                    # Source files
├── tests/
│   ├── setup.ts              # Test setup
│   ├── unit/                 # Unit tests
│   ├── integration/          # Integration tests
│   ├── properties/           # Property-based tests
│   └── fuzzing/             # Fuzzing tests
├── docs/                     # Package-specific docs
├── package.json
├── tsconfig.json
└── vitest.config.ts
```

### Test Structure

Tests are organized by type:
- **Unit tests**: Test individual functions/classes
- **Integration tests**: Test package interactions
- **Property tests**: Test invariants with fast-check
- **Fuzzing tests**: Test with random inputs

### Configuration Files

- `tsconfig.json` - TypeScript configuration (extends base)
- `vitest.config.ts` - Test configuration
- `package.json` - Package metadata and dependencies
- `.cursor/rules/*.mdc` - Package-specific development rules

---

## Technology Stack

### Runtime
- **Node.js** 18+
- **TypeScript** 5.9

### Package Management
- **pnpm** - Fast, disk-efficient package manager
- **Workspaces** - Monorepo support

### Databases
- **PostgreSQL** - OLTP database (tokens, calls, strategies)
- **ClickHouse** - Time-series database (OHLCV, events)
- **InfluxDB** - Optional legacy support
- **SQLite** - Legacy support

### External APIs
- **Birdeye API** - Market data
- **Helius WebSocket/gRPC** - Solana real-time data
- **Yellowstone gRPC** - Solana transaction streams

### Testing
- **Vitest** - Test framework
- **fast-check** - Property-based testing

### Development Tools
- **ESLint** - Linting
- **Prettier** - Code formatting
- **Husky** - Git hooks
- **TypeScript** - Type checking

---

## Design Patterns

1. **StorageEngine Pattern** - Unified storage interface
2. **Repository Pattern** - Database abstraction
3. **Event-Driven Architecture** - Decoupled communication
4. **Strategy Pattern** - Trading strategies
5. **Builder Pattern** - Strategy configuration
6. **Factory Pattern** - Client creation

---

## Next Steps

For more detailed information:
- See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed architecture
- See [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md) for project organization
- See package-specific README files in each package directory

---

**Last Updated:** 2025-12-14  
**Maintained by:** QuantBot Team


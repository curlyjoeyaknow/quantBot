# QuantBot Architecture Documentation

## Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Package Architecture](#package-architecture)
4. [Data Flow](#data-flow)
5. [Component Details](#component-details)
6. [Design Patterns](#design-patterns)
7. [Technology Stack](#technology-stack)
8. [Deployment Architecture](#deployment-architecture)

## Overview

QuantBot is built as a **modular monorepo** using pnpm workspaces, following principles of:
- **Separation of Concerns**: Each package has a single, well-defined responsibility
- **StorageEngine Pattern**: Unified interface for all storage operations
- **Event-Driven Architecture**: Event bus for decoupled communication (via `@quantbot/utils`)
- **Type Safety**: Full TypeScript with strict mode
- **API-First Design**: Backend API (`@quantbot/api`) exposes services to bot/web/trading packages

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Client Applications                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │ Telegram Bot │  │ Web Dashboard│  │ Trading Bot  │       │
│  │ (planned)    │  │ (planned)    │  │ (planned)    │       │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘       │
└─────────┼──────────────────┼──────────────────┼──────────────┘
          │                  │                  │
          └──────────────────┼──────────────────┘
                             │
          ┌──────────────────▼──────────────────┐
          │      Backend REST API                 │
          │      (@quantbot/api)                  │
          │  ┌──────────────────────────────┐    │
          │  │ Fastify Server                │    │
          │  │ - OHLCV Routes                 │    │
          │  │ - Token Routes                │    │
          │  │ - Call Routes                 │    │
          │  │ - Simulation Routes           │    │
          │  │ - Ingestion Routes            │    │
          │  │ - Health Routes                │    │
          │  └──────────────────────────────┘    │
          └──────────────┬───────────────────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
┌─────────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐
│ Service Layer  │ │ OHLCV      │ │ Ingestion  │
│                │ │ Services   │ │ Services   │
│ - Simulation   │ │            │ │            │
│ - Token        │ │ - Engine   │ │ - Telegram │
│ - Workflows    │ │ - Service  │ │ - OHLCV    │
│ - Monitoring   │ │ - Query    │ │            │
└────────┬───────┘ └─────┬──────┘ └─────┬──────┘
         │               │              │
         └───────────────┼──────────────┘
                         │
          ┌──────────────▼──────────────┐
          │    StorageEngine            │
          │    (@quantbot/storage)      │
          │  ┌──────────────────────┐   │
          │  │ Unified Interface    │   │
          │  │ - getCandles()       │   │
          │  │ - storeCandles()     │   │
          │  │ - getTokens()        │   │
          │  │ - getCalls()         │   │
          │  │ - Cache Layer        │   │
          │  └──────────────────────┘   │
          └──────────────┬──────────────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
┌─────────▼──────┐ ┌─────▼──────┐ ┌─────▼──────┐
│  PostgreSQL    │ │ ClickHouse │ │  InfluxDB  │
│  (OLTP)        │ │(TimeSeries)│ │ (Optional) │
│                │ │            │ │            │
│ - Tokens       │ │ - OHLCV    │ │ - Legacy   │
│ - Calls        │ │ - Events   │ │   Support  │
│ - Strategies   │ │ - Metrics  │ │            │
│ - Simulations  │ │            │ │            │
└────────────────┘ └────────────┘ └────────────┘
```

## Package Architecture

### Package Dependency Graph

```
@quantbot/core (base types, no dependencies)
    │
@quantbot/utils (base utilities, depends on core)
    │
    ├── @quantbot/storage (depends on utils, core)
    │       │
    │       ├── @quantbot/api-clients (depends on utils)
    │       │       │
    │       ├── @quantbot/ohlcv (depends on storage, api-clients, simulation, utils)
    │       │       │
    │       ├── @quantbot/token-analysis (depends on storage, api-clients, utils)
    │       │       │
    │       ├── @quantbot/ingestion (depends on ohlcv, token-analysis, storage, utils)
    │       │       │
    │       ├── @quantbot/workflows (depends on ingestion, simulation, storage, utils)
    │       │       │
    │       ├── @quantbot/simulation (depends on storage, utils, core)
    │       │       │
    │       ├── @quantbot/monitoring (depends on storage, utils)
    │       │       │
    │       └── @quantbot/api (depends on storage, ohlcv, ingestion, utils)
    │
    └── (future: @quantbot/bot, @quantbot/web, @quantbot/trading)
```

### Package Details

#### `@quantbot/core`

**Purpose**: Core types and interfaces shared across all packages

**Exports**:
- `Candle` - OHLCV candle data structure
- `Chain` - Supported blockchain types
- Type definitions for strategies, simulations, etc.

**Dependencies**: 
- External: None
- Internal: None

**Key Files**:
- `src/index.ts` - Core type exports

#### `@quantbot/utils`

**Purpose**: Base utilities shared across all packages

**Exports**:
- Logger (Winston-based with daily rotation)
- Error handling (AppError, error handlers)
- EventBus (event-driven communication)
- Database utilities (SQLite, Postgres helpers)
- Caller database utilities
- Pump.fun utilities
- Credit monitoring

**Dependencies**: 
- External: `dotenv`, `luxon`, `winston`, `zod`, `sqlite3`, `pg`
- Internal: `@quantbot/core`

**Key Files**:
- `src/logger.ts` - Centralized logging
- `src/error-handler.ts` - Error handling utilities
- `src/events/EventBus.ts` - Event bus implementation (moved from @quantbot/events)
- `src/caller-database.ts` - Caller tracking utilities

#### `@quantbot/storage`

**Purpose**: Unified storage layer for all database operations

**Exports**:
- `StorageEngine` - Unified interface for all storage operations
- ClickHouse client (time-series data)
- Postgres client (OLTP data)
- InfluxDB client (optional, legacy)
- SQLite client (legacy support)
- `OHLCVCache` - In-memory LRU cache for OHLCV data
- All repositories (OhlcvRepository, TokensRepository, CallsRepository, etc.)

**Dependencies**:
- External: `@clickhouse/client`, `pg`, `sqlite3`, `@influxdata/influxdb-client`, `lru-cache`, `luxon`
- Internal: `@quantbot/utils`, `@quantbot/core`

**Key Files**:
- `src/engine/StorageEngine.ts` - Unified storage interface
- `src/clickhouse-client.ts` - ClickHouse operations
- `src/postgres/postgres-client.ts` - PostgreSQL operations
- `src/cache/ohlcv-cache.ts` - OHLCV caching (moved from @quantbot/data)
- `src/clickhouse/repositories/` - ClickHouse repositories
- `src/postgres/repositories/` - PostgreSQL repositories

**Architecture Pattern**: StorageEngine provides a single interface that abstracts all storage operations. All packages use StorageEngine instead of direct database calls.

#### `@quantbot/api-clients`

**Purpose**: External API client implementations

**Exports**:
- `BirdeyeClient` - Birdeye API client with multi-key rotation
- `HeliusRestClient` - Helius REST API client
- `BaseApiClient` - Base class with retry logic and rate limiting

**Dependencies**:
- External: `axios`
- Internal: `@quantbot/utils`

**Key Files**:
- `src/base-client.ts` - Base API client with retry/rate limiting
- `src/birdeye-client.ts` - Birdeye API client (moved from @quantbot/data)
- `src/helius-client.ts` - Helius REST client (moved from @quantbot/data)

#### `@quantbot/ohlcv`

**Purpose**: OHLCV candle data management and services

**Exports**:
- `OHLCVEngine` - Main OHLCV engine (uses StorageEngine)
- `OHLCVService` - OHLCV service layer (uses StorageEngine)
- `OhlcvIngestionEngine` - Ingestion engine for fetching and storing candles
- Query utilities
- Historical candles fetcher

**Dependencies**:
- External: `lru-cache`, `luxon`
- Internal: `@quantbot/utils`, `@quantbot/storage`, `@quantbot/api-clients`, `@quantbot/simulation`

**Key Files**:
- `src/ohlcv-engine.ts` - Main engine (uses StorageEngine)
- `src/ohlcv-service.ts` - Service layer (uses StorageEngine)
- `src/ohlcv-ingestion-engine.ts` - Ingestion engine (uses StorageEngine)
- `src/ohlcv-query.ts` - Query utilities

**Architecture Pattern**: All OHLCV operations use `StorageEngine` instead of direct database calls. This ensures consistent caching and data access patterns.

#### `@quantbot/simulation`

**Purpose**: Trading simulation engine with strategy definitions

**Exports**:
- `SimulationEngine` class
- Strategy builder and definitions
- Candle utilities
- Technical indicators (Ichimoku, etc.)
- Configuration schemas (Zod)
- Optimization tools
- Target resolver
- Signals and sinks

**Dependencies**:
- External: `luxon`, `zod`
- Internal: `@quantbot/utils`, `@quantbot/storage`, `@quantbot/core`

**Key Files**:
- `src/engine.ts` - Core simulation logic
- `src/candles.ts` - Candle data handling
- `src/ichimoku.ts` - Ichimoku calculations
- `src/config.ts` - Configuration schemas
- `src/strategies/` - Strategy definitions

#### `@quantbot/token-analysis`

**Purpose**: Token analysis and contract address detection services

**Exports**:
- `TokenService` - Token metadata and analysis
- `TokenFilterService` - Token filtering
- `CADetectionService` - Contract address detection
- `ChatExtractionEngine` - Extract tokens from chat messages

**Dependencies**:
- External: `cheerio`
- Internal: `@quantbot/utils`, `@quantbot/storage`, `@quantbot/api-clients`

**Key Files**:
- `src/token-service.ts` - Token service
- `src/token-filter-service.ts` - Token filtering
- `src/CADetectionService.ts` - CA detection
- `src/chat-extraction-engine.ts` - Chat extraction

#### `@quantbot/ingestion`

**Purpose**: Data ingestion services for Telegram alerts and OHLCV data

**Exports**:
- `TelegramAlertIngestionService` - Telegram alert ingestion
- `OhlcvIngestionService` - OHLCV data ingestion
- `TelegramExportParser` - Telegram export parsing
- `ExtractSolanaAddresses` - Address extraction utilities

**Dependencies**:
- External: None
- Internal: `@quantbot/utils`, `@quantbot/storage`, `@quantbot/ohlcv`, `@quantbot/token-analysis`

**Key Files**:
- `src/TelegramAlertIngestionService.ts` - Telegram ingestion
- `src/OhlcvIngestionService.ts` - OHLCV ingestion
- `src/TelegramExportParser.ts` - Export parser
- `src/extractSolanaAddresses.ts` - Address extraction

#### `@quantbot/workflows`

**Purpose**: Workflow orchestration services

**Exports**:
- `IchimokuWorkflowService` - Ichimoku analysis workflow
- `TextWorkflowHandler` - Bot text workflow handler
- `CallerTracking` - Caller tracking service
- `ResultsService` - Results service

**Dependencies**:
- External: `pg`
- Internal: `@quantbot/utils`, `@quantbot/storage`, `@quantbot/ohlcv`, `@quantbot/token-analysis`, `@quantbot/ingestion`, `@quantbot/simulation`

**Key Files**:
- `src/IchimokuWorkflowService.ts` - Ichimoku workflow
- `src/TextWorkflowHandler.ts` - Text workflow handler
- `src/caller-tracking.ts` - Caller tracking
- `src/results-service.ts` - Results service

#### `@quantbot/monitoring`

**Purpose**: Real-time monitoring and stream services

**Exports**:
- `HeliusMonitor` - Helius WebSocket client
- `StreamRecorder` - Stream recording
- `BackfillService` - Backfill service
- `CAMonitoringService` - CA monitoring service
- `LiveTradeAlertService` - Live trade alerts
- `TenkanKijunAlertService` - Technical analysis alerts

**Dependencies**:
- External: `@solana/web3.js`, `@triton-one/yellowstone-grpc`, `axios`, `telegraf`, `ws`
- Internal: `@quantbot/utils`, `@quantbot/storage`

**Key Files**:
- `src/helius-monitor.ts` - Helius WebSocket client
- `src/CAMonitoringService.ts` - CA monitoring service
- `src/live-trade-alert-service.ts` - Live trade alerts
- `src/tenkan-kijun-alert-service.ts` - Technical analysis alerts

#### `@quantbot/api` ⚠️ ARCHIVED

**Status**: Archived (2025-12-14) - Not needed in current stack

**Purpose**: Backend REST API exposing all services (Fastify-based)

**Note**: This package has been archived. See `archive/api/` for the code and `archive/docs-api/` for documentation.

## Data Flow

### OHLCV Data Flow

```
External API (Birdeye)
    │
    ▼
@quantbot/api-clients (BirdeyeClient)
    │
    ▼
@quantbot/ohlcv (OHLCVEngine/Service)
    │
    ├──► Check StorageEngine cache
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
User Request (via API)
    │
    ▼
@quantbot/api (Simulation Routes)
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
Helius WebSocket
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

## Component Details

### StorageEngine Pattern

**Location**: `packages/storage/src/engine/StorageEngine.ts`

**Purpose**: Unified interface for all storage operations

**Key Methods**:
- `getCandles()` - Fetch OHLCV candles (checks cache, then DB, then API)
- `storeCandles()` - Store candles (updates cache and DB)
- `getTokens()` - Fetch token metadata
- `getCalls()` - Fetch call history
- `getSimulationRuns()` - Fetch simulation runs
- `storeSimulationResults()` - Store simulation results

**Benefits**:
- Single point of access for all storage operations
- Automatic caching
- Consistent error handling
- Easy to test and mock

**Usage**:
```typescript
import { getStorageEngine } from '@quantbot/storage';

const storage = getStorageEngine();
const candles = await storage.getCandles(mint, chain, startTime, endTime, { interval: '5m' });
```

### OHLCV Engine

**Location**: `packages/ohlcv/src/ohlcv-engine.ts`

**Purpose**: Main interface for OHLCV operations

**Key Features**:
- Uses StorageEngine for all storage operations
- Automatic cache checking
- Fallback to API when needed
- Supports multiple intervals (1m, 5m, 15m, 1h)

**Usage**:
```typescript
import { OHLCVEngine } from '@quantbot/ohlcv';

const engine = new OHLCVEngine();
const result = await engine.fetch(mint, startTime, endTime, chain, {
  interval: '5m',
  cacheOnly: false,
  ensureIngestion: true,
});
```

### API Server

**Location**: `packages/api/src/index.ts`

**Purpose**: Fastify-based REST API server

**Features**:
- CORS support
- Helmet security headers
- Rate limiting
- Request validation (Zod)
- Authentication middleware
- Health checks

**Note**: The API package has been archived. See `archive/api/` for implementation details.

## Design Patterns

### 1. StorageEngine Pattern

**Implementation**: `StorageEngine` class in `@quantbot/storage`

**Benefits**:
- Single interface for all storage operations
- Automatic caching
- Easy to test (mock StorageEngine)
- Consistent error handling

### 2. Repository Pattern

**Implementation**: Repositories in `@quantbot/storage/src/*/repositories/`

**Benefits**:
- Database abstraction
- Easy to swap implementations
- Testable data access

### 3. Event-Driven Architecture

**Implementation**: `EventBus` in `@quantbot/utils/src/events/`

**Benefits**:
- Decoupled components
- Scalable event handling
- Easy to add new handlers

### 4. Strategy Pattern

**Implementation**: Trading strategies in `@quantbot/simulation/src/strategies/`

**Benefits**:
- Flexible strategy definitions
- Easy to add new strategies
- Strategy optimization

### 5. Builder Pattern

**Implementation**: Strategy builder in `@quantbot/simulation/src/strategies/builder.ts`

**Benefits**:
- Fluent API for strategy creation
- Validation during building
- Type-safe configuration

## Technology Stack

### Runtime
- **Node.js** 18+ - JavaScript runtime
- **TypeScript** 5.9 - Type-safe development

### Frameworks & Libraries
- **Fastify** - High-performance web framework (API server)
- **Luxon** - Date/time handling
- **Winston** - Logging
- **Zod** - Schema validation

### Databases
- **PostgreSQL** - Primary OLTP database
- **ClickHouse** - Time-series database
- **InfluxDB** - Optional real-time monitoring (legacy)
- **SQLite** - Legacy support

### APIs & Services
- **Birdeye API** - Market data
- **Helius WebSockets** - Solana real-time data
- **Shyft API** - Additional Solana data (optional)

### Development Tools
- **Vitest** - Testing framework
- **pnpm** - Package manager
- **Docker** - Containerization

## Deployment Architecture

### Development

```
Local Machine
├── Node.js Process (API Server)
├── Docker Containers
│   ├── PostgreSQL
│   ├── ClickHouse
│   └── InfluxDB (optional)
└── File System
    ├── Logs
    ├── Cache (CSV files)
    └── Data exports
```

### Production (Recommended)

```
┌─────────────────────────────────────────┐
│         Load Balancer / Reverse Proxy   │
└──────────────┬──────────────────────────┘
               │
    ┌──────────┴──────────┐
    │                     │
┌───▼────┐          ┌─────▼────┐
│  API   │          │   API    │
│ Server │          │ Server   │
│ (Pod 1)│          │ (Pod 2)  │
└───┬────┘          └─────┬────┘
    │                      │
    └──────────┬───────────┘
               │
    ┌──────────▼──────────┐
    │   Database Cluster  │
    ├─────────────────────┤
    │  PostgreSQL (Primary)│
    │  ClickHouse (Replica)│
    │  Redis (Cache)      │
    └─────────────────────┘
```

### Scaling Considerations

1. **API Scaling**: Multiple API server instances behind load balancer
2. **Database Scaling**: Read replicas for ClickHouse, connection pooling
3. **Cache Layer**: Redis for session and API response caching
4. **Monitoring**: Centralized logging and metrics collection

## Security Architecture

### Input Validation
- Zod schemas for all inputs
- Sanitization utilities
- Token address validation

### Error Handling
- No sensitive data in error messages
- Structured error logging
- User-friendly error responses

### Rate Limiting
- Per-endpoint rate limiting
- API rate limit handling
- Request throttling

### Authentication
- API key authentication (configurable)
- JWT support (planned)
- Role-based access control (planned)

## Performance Optimizations

### Caching Strategy
- **LRU Cache**: OHLCV data cached in-memory (OHLCVCache)
- **Database Query Cache**: Frequently accessed data
- **CSV Cache**: Legacy CSV-based caching (being phased out)

### Database Optimization
- **Indexes**: On frequently queried columns
- **Connection Pooling**: Managed connection pools
- **Batch Operations**: Bulk inserts and updates

### API Optimization
- **Multi-Key Rotation**: Birdeye API key rotation
- **Retry Logic**: Exponential backoff
- **Request Batching**: Batch API calls where possible

## Monitoring & Observability

### Logging
- Structured logging (Winston)
- Daily log rotation
- Log levels (error, warn, info, debug, trace)
- Contextual information (requestId, userId, etc.)

### Metrics
- API endpoint metrics
- Database query metrics
- Error rates
- Performance metrics

### Health Checks
- Service health endpoints (`/api/v1/health`)
- Database connectivity checks
- API availability checks

## Future Architecture Considerations

1. **Bot Package** - Telegram bot implementation (planned)
2. **Web Package** - Next.js web dashboard (planned)
3. **Trading Package** - Live trading execution (planned)
4. **Microservices**: Split into separate services if needed
5. **Message Queue**: Add message queue for async processing
6. **Redis**: Add Redis for session storage and caching
7. **Kubernetes**: Container orchestration for scaling

---

For more details on specific components, see:
- [Storage Engine Documentation](STORAGE_ENGINE.md)
- [OHLCV Ingestion Engine](OHLCV_INGESTION_ENGINE.md)
- [Package Migration Summary](PACKAGE_MIGRATION_SUMMARY.md)

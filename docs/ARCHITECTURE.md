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

QuantBot is built as a **modular monorepo** using npm workspaces, following principles of:
- **Separation of Concerns**: Each package has a single, well-defined responsibility
- **Dependency Injection**: Services are injected via ServiceContainer
- **Event-Driven Architecture**: Event bus for decoupled communication
- **Type Safety**: Full TypeScript with strict mode
- **Scalability**: Designed for horizontal scaling

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      User Interfaces                         │
├──────────────────────┬──────────────────────────────────────┤
│   Telegram Bot       │         Web Dashboard                │
│   (@quantbot/bot)    │      (@quantbot/web)                 │
└──────────┬───────────┴──────────────┬───────────────────────┘
           │                          │
           │                          │
┌──────────▼──────────────────────────▼───────────────────────┐
│                    Service Layer                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ Session  │ │Simulation│ │ Strategy │ │Workflows │        │
│  │ Service  │ │ Service  │ │ Service  │ │(@quantbot│        │
│  │(@quantbot│ │(@quantbot│ │(@quantbot│ │/workflows│        │
│  │/services)│ │/services)│ │/services)│ │)         │        │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│                                                               │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│  │ Token    │ │  OHLCV   │ │Ingestion │ │   API    │        │
│  │Analysis  │ │ Services │ │ Services │ │ Clients  │        │
│  │(@quantbot│ │(@quantbot│ │(@quantbot│ │(@quantbot│        │
│  │/token-   │ │/ohlcv)   │ │/ingestion│ │/api-     │        │
│  │analysis) │ │          │ │)         │ │clients)  │        │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│                                                               │
│  ┌──────────┐                                                │
│  │  Events  │                                                │
│  │(@quantbot│                                                │
│  │/events)  │                                                │
│  └──────────┘                                                │
└──────────┬──────────────────────────┬───────────────────────┘
           │                          │
           │                          │
┌──────────▼──────────────────────────▼───────────────────────┐
│              Core Engine & Utilities                          │
│  ┌──────────────────┐  ┌──────────────────┐                  │
│  │ Simulation       │  │  Monitoring      │                  │
│  │ Engine           │  │  Services        │                  │
│  │ (@quantbot/      │  │  (@quantbot/     │                  │
│  │  simulation)     │  │  monitoring)     │                  │
│  └──────────────────┘  └──────────────────┘                  │
│                                                               │
│  ┌──────────────────┐  ┌──────────────────┐                  │
│  │  Storage Layer   │  │  Utilities       │                  │
│  │  (@quantbot/     │  │  (@quantbot/     │                  │
│  │   storage)       │  │   utils)         │                  │
│  └──────────────────┘  └──────────────────┘                  │
└──────────┬──────────────────────────┬───────────────────────┘
           │                          │
           │                          │
┌──────────▼──────────────────────────▼───────────────────────┐
│                    External Services                         │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │ Birdeye  │ │  Helius  │ │  Shyft   │ │Telegram  │       │
│  │   API    │ │WebSocket │ │   API    │ │   API    │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────────────────────────────────────┘
           │                          │
           │                          │
┌──────────▼──────────────────────────▼───────────────────────┐
│                    Data Storage                              │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐                   │
│  │PostgreSQL│ │ClickHouse│ │ InfluxDB │                   │
│  │  (OLTP)  │ │(TimeSeries│ │(Optional)│                   │
│  └──────────┘ └──────────┘ └──────────┘                   │
└─────────────────────────────────────────────────────────────┘
```

## Package Architecture

### Package Dependency Graph

```
@quantbot/utils (base package, no internal dependencies)
    │
    ├── @quantbot/storage
    │       │
    │       ├── @quantbot/api-clients (depends on @quantbot/utils)
    │       │       │
    │       ├── @quantbot/events (depends on @quantbot/utils)
    │       │       │
    │       ├── @quantbot/token-analysis (depends on @quantbot/api-clients, @quantbot/storage)
    │       │       │
    │       ├── @quantbot/ohlcv (depends on @quantbot/api-clients, @quantbot/events, @quantbot/storage)
    │       │       │
    │       ├── @quantbot/ingestion (depends on @quantbot/ohlcv, @quantbot/token-analysis, @quantbot/events)
    │       │       │
    │       ├── @quantbot/workflows (depends on @quantbot/ingestion, @quantbot/simulation)
    │       │       │
    │       ├── @quantbot/simulation
    │       │       │
    │       │       ├── @quantbot/services (core services: Session, Simulation, Strategy)
    │       │       │       │
    │       │       │       ├── @quantbot/bot
    │       │       │       └── @quantbot/monitoring
    │       │       │
    │       │       └── @quantbot/monitoring
    │       │
    │       └── @quantbot/monitoring
    │
    └── @quantbot/web (Next.js, independent)
```

### Package Details

#### `@quantbot/utils`

**Purpose**: Base utilities shared across all packages

**Exports**:
- Logger (Winston-based with daily rotation)
- Error handling (AppError, error handlers)
- Database utilities (SQLite, Postgres helpers)
- Caller database utilities
- Repeat simulation helper
- Monitored tokens database
- Historical candles fetcher
- Pump.fun utilities
- Credit monitoring

**Dependencies**: 
- External: `dotenv`, `luxon`, `winston`, `zod`, `sqlite3`, `pg`
- Internal: None

**Key Files**:
- `src/logger.ts` - Centralized logging
- `src/error-handler.ts` - Error handling utilities
- `src/caller-database.ts` - Caller tracking utilities
- `src/database.ts` - Database helpers

#### `@quantbot/storage`

**Purpose**: Storage abstraction layer for all database operations

**Exports**:
- ClickHouse client (time-series data)
- Postgres client (OLTP data)
- InfluxDB client (optional, legacy)
- Caller database
- Repository pattern

**Dependencies**:
- External: `@clickhouse/client`, `pg`, `sqlite3`, `@influxdata/influxdb-client`
- Internal: `@quantbot/utils`

**Key Files**:
- `src/clickhouse-client.ts` - ClickHouse operations
- `src/postgres-client.ts` - PostgreSQL operations
- `src/caller-database.ts` - Caller data management
- `src/repository.ts` - Repository pattern implementation

#### `@quantbot/simulation`

**Purpose**: Trading simulation engine with strategy definitions

**Exports**:
- SimulationEngine class
- Strategy builder and definitions
- Candle utilities
- Technical indicators (Ichimoku, etc.)
- Configuration schemas (Zod)
- Optimization tools
- Target resolver
- Signals and sinks

**Dependencies**:
- External: `luxon`, `zod`
- Internal: `@quantbot/utils`, `@quantbot/storage`

**Key Files**:
- `src/engine.ts` - Core simulation logic
- `src/candles.ts` - Candle data handling
- `src/ichimoku.ts` - Ichimoku calculations
- `src/config.ts` - Configuration schemas
- `src/strategies/` - Strategy definitions

#### `@quantbot/monitoring`

**Purpose**: Real-time monitoring and stream services

**Exports**:
- Helius monitor (WebSocket client)
- Stream recorder
- Backfill service
- Pump.fun lifecycle tracker
- OHLCV aggregator
- Monitoring services (Brook, CurlyJoe, CA, live trade, Tenkan-Kijun)

**Dependencies**:
- External: `@solana/web3.js`, `@triton-one/yellowstone-grpc`, `axios`, `telegraf`, `ws`
- Internal: `@quantbot/utils`, `@quantbot/storage`

**Key Files**:
- `src/helius-monitor.ts` - Helius WebSocket client
- `src/CAMonitoringService.ts` - CA monitoring service
- `src/live-trade-alert-service.ts` - Live trade alerts
- `src/tenkan-kijun-alert-service.ts` - Technical analysis alerts

#### `@quantbot/services`

**Purpose**: Core application services (Session, Simulation, Strategy management)

**Status**: This package has been refactored. Most services have been moved to specialized packages. This package now primarily contains core application services and re-exports from modular packages for backward compatibility.

**Exports**:
- SessionService (user session management)
- SimulationService (simulation operations)
- StrategyService (strategy management)
- Re-exports from `@quantbot/workflows`, `@quantbot/token-analysis`, `@quantbot/ohlcv`, `@quantbot/ingestion`, `@quantbot/api-clients`

**Dependencies**:
- External: `axios`, `cheerio`, `luxon`, `telegraf`
- Internal: `@quantbot/utils`, `@quantbot/storage`, `@quantbot/simulation`, `@quantbot/api-clients`, `@quantbot/events`, `@quantbot/token-analysis`, `@quantbot/ohlcv`, `@quantbot/ingestion`, `@quantbot/workflows`

**Key Files**:
- `src/SessionService.ts` - Session management
- `src/SimulationService.ts` - Simulation operations
- `src/StrategyService.ts` - Strategy management
- `src/index.ts` - Re-exports from modular packages

#### `@quantbot/api-clients`

**Purpose**: API client implementations for external services

**Exports**:
- BaseApiClient (base class with retry logic and rate limiting)
- BirdeyeClient (Birdeye API client)
- HeliusRestClient (Helius REST API client)

**Dependencies**:
- External: `axios`
- Internal: `@quantbot/utils`

**Key Files**:
- `src/base-client.ts` - Base API client with retry/rate limiting
- `src/birdeye-client.ts` - Birdeye API client
- `src/helius-client.ts` - Helius REST client

#### `@quantbot/events`

**Purpose**: Event bus and event system for decoupled communication

**Exports**:
- EventBus (centralized event bus)
- EventTypes (type definitions)
- EventHandlers (event handler implementations)
- EventMiddleware (middleware for event processing)

**Dependencies**:
- External: None
- Internal: `@quantbot/utils`

**Key Files**:
- `src/EventBus.ts` - Event bus implementation
- `src/EventTypes.ts` - Event type definitions
- `src/EventHandlers.ts` - Event handlers
- `src/EventMiddleware.ts` - Event middleware

#### `@quantbot/token-analysis`

**Purpose**: Token analysis and contract address detection services

**Exports**:
- TokenService (token metadata and analysis)
- TokenFilterService (token filtering)
- CADetectionService (contract address detection)
- ChatExtractionEngine (extract tokens from chat messages)

**Dependencies**:
- External: `cheerio`
- Internal: `@quantbot/utils`, `@quantbot/storage`, `@quantbot/api-clients`

**Key Files**:
- `src/token-service.ts` - Token service
- `src/token-filter-service.ts` - Token filtering
- `src/CADetectionService.ts` - CA detection
- `src/chat-extraction-engine.ts` - Chat extraction

#### `@quantbot/ohlcv`

**Purpose**: OHLCV candle data management and services

**Exports**:
- OHLCVService (OHLCV data service)
- OHLCVEngine (OHLCV engine)
- OHLCVQuery (query utilities)
- OHLCVIngestion (ingestion utilities)
- HistoricalCandles (historical data fetching)

**Dependencies**:
- External: None
- Internal: `@quantbot/utils`, `@quantbot/storage`, `@quantbot/api-clients`, `@quantbot/events`

**Key Files**:
- `src/ohlcv-service.ts` - OHLCV service
- `src/ohlcv-engine.ts` - OHLCV engine
- `src/ohlcv-query.ts` - Query utilities
- `src/ohlcv-ingestion.ts` - Ingestion utilities
- `src/historical-candles.ts` - Historical data

#### `@quantbot/ingestion`

**Purpose**: Data ingestion services for Telegram alerts and OHLCV data

**Exports**:
- TelegramAlertIngestionService (Telegram alert ingestion)
- OhlcvIngestionService (OHLCV data ingestion)
- TelegramExportParser (Telegram export parsing)
- ExtractSolanaAddresses (address extraction utilities)

**Dependencies**:
- External: None
- Internal: `@quantbot/utils`, `@quantbot/storage`, `@quantbot/ohlcv`, `@quantbot/token-analysis`, `@quantbot/events`

**Key Files**:
- `src/TelegramAlertIngestionService.ts` - Telegram ingestion
- `src/OhlcvIngestionService.ts` - OHLCV ingestion
- `src/TelegramExportParser.ts` - Export parser
- `src/extractSolanaAddresses.ts` - Address extraction

#### `@quantbot/workflows`

**Purpose**: Workflow orchestration services

**Exports**:
- IchimokuWorkflowService (Ichimoku analysis workflow)
- TextWorkflowHandler (bot text workflow handler)
- CallerTracking (caller tracking service)
- ResultsService (results service)

**Dependencies**:
- External: None
- Internal: `@quantbot/utils`, `@quantbot/storage`, `@quantbot/ohlcv`, `@quantbot/token-analysis`, `@quantbot/ingestion`, `@quantbot/events`, `@quantbot/simulation`, `@quantbot/services`

**Key Files**:
- `src/IchimokuWorkflowService.ts` - Ichimoku workflow
- `src/TextWorkflowHandler.ts` - Text workflow handler
- `src/caller-tracking.ts` - Caller tracking
- `src/results-service.ts` - Results service

#### `@quantbot/bot`

**Purpose**: Telegram bot implementation

**Exports**:
- Bot instance (Telegraf)
- ServiceContainer (dependency injection)
- CommandRegistry (command management)
- Command handlers (all bot commands)
- Event bus and handlers
- Health check
- Configuration

**Dependencies**:
- External: `telegraf`, `dotenv`
- Internal: All other packages

**Key Files**:
- `src/main.ts` - Bot entry point
- `src/container/ServiceContainer.ts` - DI container
- `src/commands/CommandRegistry.ts` - Command registration
- `src/commands/*.ts` - Individual command handlers
- `src/events/EventBus.ts` - Event system

#### `@quantbot/web`

**Purpose**: Next.js web dashboard

**Exports**:
- Next.js application
- API routes
- Dashboard components
- Analytics and visualization

**Dependencies**:
- External: Next.js, React, Tailwind CSS
- Internal: `@quantbot/utils`, `@quantbot/storage`, `@quantbot/simulation`

## Data Flow

### Simulation Flow

```
User Input (Telegram)
    │
    ▼
Command Handler
    │
    ▼
SessionService (create/update session)
    │
    ▼
TextWorkflowHandler (process workflow steps)
    │
    ▼
SimulationService
    │
    ├──► fetchHybridCandles (Birdeye API)
    │         │
    │         ▼
    │    Candle Cache (CSV/ClickHouse)
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
Results Service
    │
    ├──► Save to PostgreSQL (metadata)
    ├──► Save to ClickHouse (events)
    └──► Return to user
```

### Monitoring Flow

```
Helius WebSocket
    │
    ▼
HeliusMonitor (receive updates)
    │
    ▼
CAMonitoringService
    │
    ├──► Price tracking
    ├──► Alert generation
    └──► Performance calculation
    │
    ▼
Event Bus
    │
    ├──► Alert handlers (send Telegram messages)
    ├──► Data ingestion (save to ClickHouse)
    └──► Analytics (update dashboards)
```

### CA Detection Flow

```
Chat Message (Telegram)
    │
    ▼
TextWorkflowHandler
    │
    ▼
CADetectionService
    │
    ├──► Pattern matching (addresses, keywords)
    ├──► Token validation
    └──► Metadata fetching (Birdeye)
    │
    ▼
Save to Database
    │
    ▼
Start Monitoring (CAMonitoringService)
```

## Component Details

### Service Container (Dependency Injection)

**Location**: `packages/bot/src/container/ServiceContainer.ts`

**Purpose**: Centralized dependency injection and service lifecycle management

**Features**:
- Singleton pattern for services
- Lazy initialization
- Health checks
- Service status tracking

**Usage**:
```typescript
const container = ServiceContainer.getInstance({ bot });
const sessionService = container.getService<SessionService>('sessionService');
```

### Command Registry

**Location**: `packages/bot/src/commands/CommandRegistry.ts`

**Purpose**: Centralized command registration and execution

**Features**:
- Automatic handler registration
- Validation wrapper (executeWithValidation)
- Error handling
- Rate limiting integration

**Command Handler Pattern**:
```typescript
export class MyCommandHandler extends BaseCommandHandler {
  readonly command = 'mycommand';
  
  protected defaultOptions = {
    timeout: COMMAND_TIMEOUTS.STANDARD,
    requirePrivateChat: true,
    rateLimit: true,
    showTyping: true,
  };
  
  async execute(ctx: Context, session?: Session): Promise<void> {
    // Command logic
  }
}
```

### Event Bus

**Location**: `packages/bot/src/events/EventBus.ts`

**Purpose**: Decoupled event-driven communication

**Features**:
- Pub/sub pattern
- Event middleware (metrics, rate limiting)
- Type-safe events
- Event handlers

**Usage**:
```typescript
// Publish event
await eventBus.publish(EventFactory.createUserEvent(
  'user.command.executed',
  { command: 'backtest', success: true },
  'BacktestCommandHandler',
  userId
));

// Subscribe to events
eventBus.subscribe('user.command.executed', async (event) => {
  // Handle event
});
```

### Session Management

**Location**: `packages/services/src/SessionService.ts`

**Purpose**: User session state management

**Features**:
- In-memory session storage
- Session expiration (30 minutes default)
- Automatic cleanup
- Session metadata tracking

**Session Lifecycle**:
1. Creation: User starts workflow
2. Updates: User provides input
3. Activity tracking: Last activity timestamp
4. Expiration: 30 minutes of inactivity
5. Cleanup: Automatic removal

### Simulation Engine

**Location**: `packages/simulation/src/engine.ts`

**Purpose**: Core trading simulation logic

**Features**:
- Strategy execution
- Stop-loss management (initial + trailing)
- Target resolution
- Event generation
- Performance metrics

**Simulation Process**:
1. Load candles (from cache or API)
2. Initialize position tracking
3. Iterate through candles
4. Check entry conditions
5. Execute strategy (targets, stop-loss)
6. Generate events
7. Calculate final PNL

## Design Patterns

### 1. Dependency Injection

**Implementation**: ServiceContainer

**Benefits**:
- Testability (easy mocking)
- Loose coupling
- Centralized service management

### 2. Command Pattern

**Implementation**: CommandHandler interface

**Benefits**:
- Consistent command structure
- Easy to add new commands
- Centralized validation and error handling

### 3. Repository Pattern

**Implementation**: Storage layer abstractions

**Benefits**:
- Database abstraction
- Easy to swap implementations
- Testable data access

### 4. Event-Driven Architecture

**Implementation**: EventBus

**Benefits**:
- Decoupled components
- Scalable event handling
- Easy to add new handlers

### 5. Strategy Pattern

**Implementation**: Trading strategies

**Benefits**:
- Flexible strategy definitions
- Easy to add new strategies
- Strategy optimization

### 6. Builder Pattern

**Implementation**: Strategy builder

**Benefits**:
- Fluent API for strategy creation
- Validation during building
- Type-safe configuration

## Technology Stack

### Runtime
- **Node.js** 18+ - JavaScript runtime
- **TypeScript** 5.9 - Type-safe development

### Frameworks & Libraries
- **Telegraf** - Telegram bot framework
- **Next.js** - Web dashboard framework
- **Luxon** - Date/time handling
- **Winston** - Logging
- **Zod** - Schema validation

### Databases
- **PostgreSQL** - Primary OLTP database
- **ClickHouse** - Time-series database
- **InfluxDB** - Optional real-time monitoring
- **SQLite** - Legacy support

### APIs & Services
- **Birdeye API** - Market data
- **Helius WebSockets** - Solana real-time data
- **Shyft API** - Additional Solana data
- **Telegram Bot API** - Bot platform

### Development Tools
- **Vitest** - Testing framework
- **ESLint** - Linting
- **Prettier** - Code formatting
- **Docker** - Containerization

## Deployment Architecture

### Development

```
Local Machine
├── Node.js Process (Bot)
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
│  Bot   │          │   Web    │
│ Server │          │ Dashboard │
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

1. **Bot Scaling**: Multiple bot instances with shared session storage (Redis)
2. **Database Scaling**: Read replicas for ClickHouse, connection pooling
3. **Cache Layer**: Redis for session and API response caching
4. **Monitoring**: Centralized logging and metrics collection

## Security Architecture

### Input Validation
- Zod schemas for all inputs
- Sanitization utilities
- Token address validation
- Command argument parsing

### Error Handling
- No sensitive data in error messages
- Structured error logging
- User-friendly error responses
- Error recovery mechanisms

### Rate Limiting
- Per-user command rate limiting
- API rate limit handling
- WebSocket connection limits
- Request throttling

### Session Security
- Session expiration
- Automatic cleanup
- Activity tracking
- No sensitive data in sessions

## Performance Optimizations

### Caching Strategy
- **CSV Cache**: OHLCV data cached locally (24-hour TTL)
- **In-Memory Cache**: API responses, metadata
- **Database Query Cache**: Frequently accessed data

### Database Optimization
- **Indexes**: On frequently queried columns
- **Connection Pooling**: Managed connection pools
- **Batch Operations**: Bulk inserts and updates
- **Query Optimization**: N+1 query prevention

### API Optimization
- **Multi-Key Rotation**: Birdeye API key rotation
- **Retry Logic**: Exponential backoff
- **Request Batching**: Batch API calls where possible
- **WebSocket Efficiency**: Smart subscription management

## Monitoring & Observability

### Logging
- Structured logging (Winston)
- Daily log rotation
- Log levels (error, warn, info, debug, trace)
- Contextual information (userId, command, etc.)

### Metrics
- Command execution metrics
- API call metrics
- Database query metrics
- Error rates
- Performance metrics

### Health Checks
- Service health endpoints
- Database connectivity checks
- API availability checks
- Resource usage monitoring

## Future Architecture Considerations

1. **Live Trading System** 🔥 - Execute trades based on strategies and alerts
   - Helius RPC integration (Amsterdam/mainnet optimized endpoints)
   - Relayer pattern for high-speed transaction sending
   - Strategy-based trade execution
   - Alert-triggered trading
   - Position management and tracking
   - Risk controls and safety mechanisms

2. **Microservices**: Split into separate services (bot, web, monitoring, trading)
3. **Message Queue**: Add message queue for async processing
4. **Redis**: Add Redis for session storage and caching
5. **Kubernetes**: Container orchestration for scaling
6. **Service Mesh**: For inter-service communication
7. **GraphQL**: Alternative API layer for web dashboard

---

For more details on specific components, see:
- [Package Migration Summary](PACKAGE_MIGRATION_SUMMARY.md)
- [Storage Architecture](storage-architecture.md)
- [Bot Improvements](bot-improvements.md)


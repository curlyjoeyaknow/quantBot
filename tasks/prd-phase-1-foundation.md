# PRD: Phase 1 - Foundation & Data Access Layer

## Overview

Phase 1 establishes the foundational infrastructure for the backtesting platform, including core types, port interfaces, and data access adapters for ClickHouse (OHLCV) and DuckDB (alerts). This phase creates the abstraction layer that enables the rest of the platform to work with existing data sources without tight coupling.

## Goals

1. **Establish Core Types**: Define domain types (Alert, Candle, BacktestRun, etc.) that will be used throughout the platform
2. **Create Port Interfaces**: Define clean abstractions for data access (ports) that handlers will depend on
3. **Implement Data Adapters**: Build adapters that connect to ClickHouse and DuckDB, implementing the port interfaces
4. **Enable Data Loading**: Provide functionality to load alerts from DuckDB and OHLCV data from ClickHouse
5. **Set Up Project Structure**: Create monorepo structure with proper package organization

## Scope

### In Scope

- Core domain types and interfaces
- Port interfaces for data access
- ClickHouse adapter for OHLCV data
- DuckDB adapter for alerts
- Basic data loading functionality
- Project structure and build system
- Type definitions and schemas

### Out of Scope

- Backtest execution logic
- Strategy plugins
- Result calculation
- CLI interface
- Python integration

## User Stories

### US-1.1: Load Alerts from DuckDB

**As a** developer  
**I want to** load alerts from DuckDB using filters  
**So that** I can retrieve relevant alerts for backtesting

**Acceptance Criteria:**

- Can filter alerts by date range (from/to timestamps)
- Can filter alerts by caller name
- Can filter alerts by token mint address
- Returns standardized Alert objects
- Handles missing data gracefully
- Validates input parameters

### US-1.2: Load OHLCV Data from ClickHouse

**As a** developer  
**I want to** load OHLCV candle data from ClickHouse  
**So that** I can retrieve historical price data for backtesting

**Acceptance Criteria:**

- Can query candles by token address, date range, and interval
- Supports multiple intervals (1m, 5m, 15m, 1h, etc.)
- Returns standardized Candle objects
- Handles missing data and gaps
- Validates data quality (no future data, valid OHLCV values)
- Efficient querying with proper indexing

### US-1.3: Abstract Data Access

**As a** developer  
**I want to** use port interfaces instead of direct database access  
**So that** I can swap implementations and test easily

**Acceptance Criteria:**

- Port interfaces defined in core package
- Adapters implement port interfaces
- Handlers depend on ports, not adapters
- Can create mock adapters for testing
- Clear separation between ports and adapters

## Functional Requirements

### FR-1.1: Core Domain Types

**Description**: Define core domain types used throughout the platform

**Types Required:**

```typescript
// Alert (from DuckDB)
interface Alert {
  id: string;
  callerName: string;
  mint: string; // Token address
  alertTimestamp: DateTime;
  side: 'buy' | 'sell';
  rawPayload?: Record<string, unknown>;
}

// Candle (from ClickHouse)
interface Candle {
  timestamp: DateTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  tokenAddress: string;
  chain: 'sol' | 'eth' | 'base' | 'bsc';
  interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
}

// Date range
interface DateRange {
  from: DateTime;
  to: DateTime;
}
```

**Source**: Borrow from `@quantbot/core/src/domain/` and `@quantbot/core/src/index.ts`

### FR-1.2: Alert Port Interface

**Description**: Define port interface for alert data access

**Interface:**

```typescript
interface AlertPort {
  getAlerts(filters: AlertFilters): Promise<Alert[]>;
  getAlertById(id: string): Promise<Alert | null>;
  getAlertsByCaller(callerName: string, dateRange: DateRange): Promise<Alert[]>;
  getAlertsByToken(mint: string, dateRange: DateRange): Promise<Alert[]>;
}

interface AlertFilters {
  dateRange?: DateRange;
  callerName?: string;
  mint?: string;
  limit?: number;
}
```

**Source**: Create new, inspired by `@quantbot/core/src/ports/queryPort.ts`

### FR-1.3: OHLCV Port Interface

**Description**: Define port interface for OHLCV data access

**Interface:**

```typescript
interface OhlcvPort {
  getCandles(request: OhlcvRequest): Promise<Candle[]>;
  getCandlesForTokens(tokens: string[], request: OhlcvRequest): Promise<Map<string, Candle[]>>;
  checkDataCoverage(tokens: string[], dateRange: DateRange, interval: string): Promise<CoverageReport>;
}

interface OhlcvRequest {
  tokenAddress: string;
  chain: string;
  interval: string;
  dateRange: DateRange;
}

interface CoverageReport {
  tokenAddress: string;
  coveragePercent: number;
  gaps: Array<{ from: DateTime; to: DateTime }>;
  earliestTimestamp: DateTime | null;
  latestTimestamp: DateTime | null;
}
```

**Source**: Borrow from `@quantbot/core/src/ports/marketDataPort.ts` and adapt

### FR-1.4: DuckDB Alert Adapter

**Description**: Implement DuckDB adapter for alert data access

**Implementation Requirements:**

- Use DuckDB client to query alerts table
- Map database rows to Alert domain objects
- Handle date range filtering efficiently
- Support caller and token filtering
- Error handling and validation

**Source Files to Borrow:**

- `@quantbot/storage/src/duckdb/duckdb-client.ts` - DuckDB client wrapper
- `@quantbot/storage/src/duckdb/repositories/TokenDataRepository.ts` - Example repository pattern
- Database schema from DuckDB migrations

**Key Functions:**

```typescript
class DuckDBAlertAdapter implements AlertPort {
  constructor(private dbPath: string, private client: DuckDBClient) {}
  
  async getAlerts(filters: AlertFilters): Promise<Alert[]> {
    // Query DuckDB alerts table
    // Apply filters
    // Map to Alert objects
    // Return results
  }
}
```

### FR-1.5: ClickHouse OHLCV Adapter

**Description**: Implement ClickHouse adapter for OHLCV data access

**Implementation Requirements:**

- Use ClickHouse client to query candle tables
- Support multiple intervals (1m, 5m, etc.)
- Efficient querying with proper WHERE clauses
- Handle large result sets
- Data validation (no future data, valid OHLCV)

**Source Files to Borrow:**

- `@quantbot/storage/src/clickhouse/repositories/OhlcvRepository.ts` - OHLCV repository
- `@quantbot/storage/src/clickhouse-client.ts` - ClickHouse client setup
- `@quantbot/storage/src/adapters/clickhouse/CandleSliceExporter.ts` - Candle export logic

**Key Functions:**

```typescript
class ClickHouseOhlcvAdapter implements OhlcvPort {
  constructor(private client: ClickHouseClient) {}
  
  async getCandles(request: OhlcvRequest): Promise<Candle[]> {
    // Query ClickHouse candles table
    // Apply date range and filters
    // Map to Candle objects
    // Validate data
    // Return results
  }
}
```

### FR-1.6: Project Structure

**Description**: Set up monorepo structure with proper package organization

**Structure:**

```
backtesting-platform/
├── packages/
│   ├── core/              # Core types and ports (zero deps)
│   │   ├── src/
│   │   │   ├── domain/    # Domain types
│   │   │   ├── ports/     # Port interfaces
│   │   │   └── index.ts
│   │   └── package.json
│   ├── storage/           # Data access adapters
│   │   ├── src/
│   │   │   ├── adapters/
│   │   │   │   ├── duckdb/
│   │   │   │   │   └── AlertAdapter.ts
│   │   │   │   └── clickhouse/
│   │   │   │       └── OhlcvAdapter.ts
│   │   │   └── index.ts
│   │   └── package.json
│   └── utils/            # Shared utilities
│       ├── src/
│       └── package.json
├── package.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

**Source**: Borrow structure from `../quantBot-consolidation-work/`

### FR-1.7: Build System

**Description**: Set up TypeScript build system with proper dependencies

**Requirements:**

- TypeScript compilation
- Package dependency management (pnpm workspaces)
- Build ordering (core → storage → ...)
- Type checking across packages

**Source**: Borrow from `../quantBot-consolidation-work/tsconfig.base.json` and build scripts

## Technical Specifications

### Technology Stack

- **TypeScript**: 5.9+
- **pnpm**: Workspace management
- **DuckDB**: File-based database for alerts
- **ClickHouse**: Time-series database for OHLCV
- **luxon**: Date/time handling
- **zod**: Schema validation

### Dependencies

**Core Package:**

- `luxon` - Date/time
- `zod` - Validation

**Storage Package:**

- `@backtesting-platform/core` - Core types
- `@clickhouse/client` - ClickHouse client
- `duckdb` - DuckDB bindings (or Python integration)

### Database Schemas

**DuckDB Alerts Table** (assumed to exist):

```sql
CREATE TABLE alerts (
  id TEXT PRIMARY KEY,
  caller_name TEXT,
  mint TEXT,
  alert_timestamp TIMESTAMP,
  side TEXT,
  raw_payload JSON
);
```

**ClickHouse OHLCV Tables** (assumed to exist):

```sql
CREATE TABLE candles_1m (
  chain String,
  mint String,
  timestamp DateTime,
  open Float64,
  high Float64,
  low Float64,
  close Float64,
  volume Float64
) ENGINE = MergeTree()
ORDER BY (chain, mint, timestamp);
```

### Code to Borrow from QuantBot

#### Core Types

- `@quantbot/core/src/domain/calls/CallSignal.ts` - Call/Alert types
- `@quantbot/core/src/index.ts` - Alert interface (lines 185-201)
- `@quantbot/core/src/domain/chain/index.ts` - Chain types

#### Port Interfaces

- `@quantbot/core/src/ports/marketDataPort.ts` - Market data port (adapt for OHLCV)
- `@quantbot/core/src/ports/queryPort.ts` - Query port pattern
- `@quantbot/core/src/ports/clockPort.ts` - Clock port (for deterministic time)

#### DuckDB Adapters

- `@quantbot/storage/src/duckdb/duckdb-client.ts` - DuckDB client wrapper
- `@quantbot/storage/src/duckdb/repositories/TokenDataRepository.ts` - Repository pattern
- `@quantbot/storage/src/duckdb/connection-utils.ts` - Connection utilities

#### ClickHouse Adapters

- `@quantbot/storage/src/clickhouse/repositories/OhlcvRepository.ts` - OHLCV repository
- `@quantbot/storage/src/clickhouse-client.ts` - ClickHouse client setup
- `@quantbot/storage/src/adapters/clickhouse/CandleSliceExporter.ts` - Candle export logic

#### Utilities

- `@quantbot/storage/src/utils/interval-converter.ts` - Interval conversion utilities
- `@quantbot/core/src/determinism.ts` - Determinism utilities

## Implementation Tasks

### Task 1.1: Set Up Project Structure

- Create monorepo with pnpm workspaces
- Set up TypeScript configs
- Create package.json files
- Set up build scripts

### Task 1.2: Create Core Package

- Define domain types (Alert, Candle, DateRange)
- Create port interfaces (AlertPort, OhlcvPort)
- Export types and interfaces
- Add validation schemas (zod)

### Task 1.3: Create Storage Package

- Set up DuckDB client wrapper
- Set up ClickHouse client wrapper
- Implement DuckDBAlertAdapter
- Implement ClickHouseOhlcvAdapter
- Add error handling

### Task 1.4: Integration Tests

- Test alert loading from DuckDB
- Test OHLCV loading from ClickHouse
- Test filtering and date ranges
- Test error cases

## Success Criteria

1. ✅ Can load alerts from DuckDB with filters
2. ✅ Can load OHLCV data from ClickHouse
3. ✅ Port interfaces are clean and testable
4. ✅ Adapters implement ports correctly
5. ✅ All types are properly defined
6. ✅ Build system works correctly
7. ✅ Integration tests pass

## Dependencies

- Existing DuckDB database with alerts table
- Existing ClickHouse database with OHLCV tables
- Database connection credentials/config

## Risks & Mitigations

**Risk**: Database schema differences  
**Mitigation**: Document expected schemas, create migration scripts if needed

**Risk**: Performance issues with large datasets  
**Mitigation**: Implement pagination, caching, query optimization

**Risk**: Data quality issues  
**Mitigation**: Add validation layers, data quality checks

## Open Questions

1. Should we use Python for DuckDB operations (like quantbot) or Node.js bindings?
2. What level of data validation should be performed at this layer?
3. Should we implement caching for frequently accessed data?
4. How should we handle database connection pooling?

## Next Phase

Phase 2 will build the core backtesting engine that uses these data access layers to execute strategies against historical data.

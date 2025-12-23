# OHLCV Architecture - Package Boundaries

**Status**: 📋 ARCHITECTURE  
**Priority**: High  
**Created**: 2025-01-19

## Overview

This document defines the architectural boundaries for OHLCV data management, ensuring clean separation between offline query services and online fetch jobs.

## Package Boundaries

### Boundary 1: OHLCV Domain (Offline, Read-First)

**Package**: `@quantbot/ohlcv`

**Purpose**: Everything simulation and analytics need to consume candles.

**Allowed**:
- Query candles (from ClickHouse or local Parquet)
- Gap/coverage checks (against stored data)
- Resampling, alignment, normalization
- Caching (LRU)
- Pure transformations (candles → indicators inputs)

**Forbidden (Hard)**:
- Birdeye / any HTTP
- API keys / dotenv
- Anything that can fetch new data online

**Interface**:
```typescript
getCandles(mint, interval, start, end)
getCoverage(mint, interval, start, end) // or hasCoverage(...)
listIntervals(mint) // optional
```

**Why**: Simulation imports this package and remains repeatable.

### Boundary 2: OHLCV Work Planning (Offline, Selection Logic)

**Package**: `@quantbot/ingestion-ohlcv` (or keep `@quantbot/ingestion` as this)

**Purpose**: Decide what needs candles.

**Allowed**:
- Read DuckDB calls/tokens
- Produce a worklist: `(mint, chain, interval, start, end, priority)`
- Write OHLCV metadata/exclusions back to DuckDB (still offline)

**Forbidden**:
- Any HTTP / Birdeye
- ClickHouse writes (optional, but keep it out)
- "fetch" logic

**Output Contract**:
```typescript
OhlcvWorkItem[] // or a Parquet artifact + manifest
```

**Why**: This is where you prevent survivorship bias by making selection reproducible and inspectable.

### Boundary 3: OHLCV Fetch + Store (Online Boundary)

**Package**: `@quantbot/jobs` (or `@quantbot/ohlcv-fetch`, `@quantbot/ingestion-online`)

**Purpose**: Take the worklist and actually acquire candles.

**Allowed**:
- Call `@quantbot/api-clients` (Birdeye)
- Enforce rate limits + circuit breakers
- Write candles to ClickHouse (idempotent upsert)
- Emit metrics (Prometheus) + write per-request events to DuckDB (optional)

**Forbidden**:
- Being imported by simulation or `@quantbot/ohlcv`

**Why**: This is the ONLY place network is allowed.

## ClickHouse Access

ClickHouse access is part of the storage boundary, but it's used in two modes:

### Read Mode (Safe for Simulation)
- Lives behind `@quantbot/ohlcv` via something like `CandleStore` / `ClickHouseCandleRepository`

### Write Mode (Online Fetch Job)
- Used by `@quantbot/jobs` to insert candles
- Must be idempotent on `(mint, interval, ts)`

So ClickHouse is shared, but read vs write is separated by package boundaries.

## Dependency Enforcement

### "No Accidental Nudge" Enforcement

To make this real, not aspirational:

**`@quantbot/ohlcv` must not depend on**:
- `@quantbot/api-clients`
- `axios`
- `dotenv`
- `node:http` / `node:https`

**`@quantbot/simulation` must not depend on**:
- `@quantbot/jobs`
- `@quantbot/api-clients`
- Anything network

**`@quantbot/jobs` is the only package that can depend on `@quantbot/api-clients`**

### Enforcement Methods

This can be enforced with:
1. **ESLint `no-restricted-imports` rules**, or
2. **A simple test** that parses `package.json` dependencies and fails if forbidden deps exist

## Package Responsibilities Summary

| Package | Responsibility | Network? | Can Import |
|---------|---------------|----------|------------|
| `@quantbot/ohlcv` | Query candles, gaps, resampling | ❌ No | core, utils, storage |
| `@quantbot/ingestion-ohlcv` | Work planning (DuckDB → worklist) | ❌ No | core, utils, storage |
| `@quantbot/jobs` | Fetch + store (worklist → Birdeye → ClickHouse) | ✅ Yes | api-clients, ohlcv, storage |
| `@quantbot/simulation` | Backtesting (uses ohlcv) | ❌ No | ohlcv, core, utils |

## Migration Path

1. **Phase 1**: Extract Birdeye fetching to `@quantbot/api-clients` ✅
2. **Phase 2**: Create offline storage service in `@quantbot/ohlcv` ✅
3. **Phase 3**: Refactor `@quantbot/ohlcv` to be offline-only ✅
4. **Phase 4**: Create `@quantbot/jobs` for online orchestration ✅
5. **Phase 5**: Move ingestion engine to `@quantbot/jobs` (in progress)
6. **Phase 6**: Add dependency enforcement rules (pending)
7. **Phase 7**: Clean up dependencies (pending)

## Related Documents

- [OHLCV Offline Refactoring Plan](./OHLCV_OFFLINE_REFACTORING_PLAN.md)
- [Ingestion Architecture Violation](./INGESTION_ARCHITECTURE_VIOLATION.md)
- [Architectural Issues](./ARCHITECTURAL_ISSUES.md)


# Raw Data Immutability - Implementation Status

**Status**: 📋 IN PROGRESS  
**Priority**: P1 (Enables Phase IV)  
**Created**: 2025-01-24

## Overview

This document tracks the implementation of raw data immutability as specified in Phase II Task 2.1 of the Quant Research Lab Roadmap.

## Current State

### Raw Data Storage

**Telegram Exports**:
- Raw JSON export files are parsed but **not stored as raw data**
- Normalized messages stored in `tg_norm` table (SQLite/DuckDB)
- Quarantined messages stored in `tg_quarantine` table
- Raw payload stored in `rawPayload` field of alerts (processed data, not raw)

**API Responses**:
- API responses are not currently stored as raw data
- Only processed/transformed data is stored (candles, metadata)

### Mutable Operations

**Current Violations**:
- `tg_norm` table uses `PRIMARY KEY (chat_id, message_id)` - allows updates via INSERT OR REPLACE
- No hash tracking for raw inputs
- No run_id/timestamp tracking for raw data

## Implementation Plan

### 1. Audit Current Raw Data Storage ✅

**Status**: Complete

**Findings**:
- Telegram exports: Parsed but raw JSON not stored
- API responses: Not stored as raw data
- Normalized data: Stored in `tg_norm` table (allows updates)

**Files Audited**:
- `packages/ingestion/src/telegram/TelegramJsonExportParser.ts`
- `packages/ingestion/src/TelegramCallIngestionService.ts`
- `tools/telegram/schema.sql`
- `packages/storage/src/clickhouse/repositories/OhlcvRepository.ts`

### 2. Implement Append-Only Pattern ⏳

**Status**: In Progress

**Required Changes**:
- Create `raw_data` table with append-only schema
- Add `run_id` and `ingested_at` to all raw data tables
- Remove UPDATE/DELETE operations on raw data
- Refactor ingestion to store raw data before processing

**Files**:
- `tools/storage/raw_data_schema.sql` (to be created)
- `packages/ingestion/src/telegram/ingestTelegramJson.ts` (to be refactored)

### 3. Add Raw Data Hash Tracking ⏳

**Status**: In Progress

**Required Changes**:
- Store SHA256 hash of raw inputs (files, API responses)
- Use hash to detect duplicates (idempotency)
- Add hash index for fast lookups

**Files**:
- `packages/ingestion/src/telegram/ingestTelegramJson.ts` (to be updated)

### 4. Create Raw Data Access Interface ✅

**Status**: Complete

**Implementation**:
- `RawDataRepository` port exists: `packages/core/src/ports/raw-data-repository-port.ts`
- Interface supports querying by time range, source, hash

### 5. Add Raw Data CLI ⏳

**Status**: In Progress

**Required Commands**:
- `quantbot data raw list` - List raw data sources
- `quantbot data raw query --from <date> --to <date>` - Query raw data

**Files**:
- `packages/cli/src/commands/data/raw.ts` (to be created)
- `packages/cli/src/handlers/data/raw.ts` (to be created)

## Next Steps

1. Create DuckDB adapter for RawDataRepository
2. Create raw_data table schema
3. Refactor ingestion to store raw data
4. Implement CLI commands
5. Add hash tracking to ingestion

## Success Criteria

- ✅ Raw data repository interface defined
- ⏳ Raw data is append-only (no updates/deletes)
- ⏳ Hash tracking prevents duplicates
- ⏳ Repository adapter implemented
- ⏳ CLI commands work


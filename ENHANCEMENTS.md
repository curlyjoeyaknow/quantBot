# Lab API Optional Enhancements

This worktree is dedicated to implementing the remaining optional enhancements for the lab API.

## Current Status

✅ **Completed:**
- Resource model API refactoring
- Real backtest execution using `runSimulation` workflow
- Cursor-based pagination
- Run-scoped logging (in-memory)
- Comprehensive endpoint coverage

## Optional Enhancements (To Do)

### 1. Persist Run Status/Logs to Database
**Priority:** High  
**Status:** Not Started

Currently, run status and logs are stored in-memory. This should be persisted to:
- DuckDB for run metadata
- ClickHouse for logs (time-series data)

**Tasks:**
- [ ] Create `RunStatusRepository` in DuckDB
- [ ] Create `RunLogRepository` in ClickHouse
- [ ] Update `POST /backtest` to persist initial status
- [ ] Update run execution to persist status changes
- [ ] Update `GET /runs/:runId` to read from database
- [ ] Update `GET /runs/:runId/logs` to read from ClickHouse
- [ ] Migrate existing in-memory data (if any)

### 2. Implement Artifact Storage and Retrieval
**Priority:** Medium  
**Status:** Not Started

Currently, `GET /runs/:runId/artifacts` returns stub data. Should query actual artifacts from storage.

**Tasks:**
- [ ] Define artifact storage schema (Parquet, CSV, JSON paths)
- [ ] Implement artifact storage during simulation runs
- [ ] Update `GET /runs/:runId/artifacts` to query real artifacts
- [ ] Add artifact download endpoints (if needed)
- [ ] Implement artifact cleanup/retention policies

### 3. Implement Metrics Time-Series Queries
**Priority:** Medium  
**Status:** Not Started

Currently, `GET /runs/:runId/metrics` returns stub data. Should query actual metrics from ClickHouse/events.

**Tasks:**
- [ ] Define metrics schema (drawdown, exposure, fills)
- [ ] Implement metrics collection during simulation
- [ ] Update `GET /runs/:runId/metrics` to query ClickHouse
- [ ] Add time-range filtering
- [ ] Add aggregation options (1m, 5m, 1h intervals)

### 4. Complete Statistics Endpoints
**Priority:** Low  
**Status:** Not Started

Statistics endpoints are stubbed. Should implement real aggregations.

**Tasks:**
- [ ] Implement `GET /statistics/overview` with real totals
- [ ] Implement `GET /statistics/pnl` with grouped aggregations
- [ ] Implement `GET /statistics/distribution` histograms
- [ ] Implement `GET /statistics/correlation` feature correlations
- [ ] Add caching for expensive aggregations

### 5. Add Job Queue for Backtest Execution
**Priority:** Low  
**Status:** Not Started

Currently, backtests run in `setImmediate`. Should use a proper job queue.

**Tasks:**
- [ ] Choose job queue library (BullMQ, Bull, etc.)
- [ ] Implement job queue adapter
- [ ] Update `POST /backtest` to enqueue jobs
- [ ] Implement job workers
- [ ] Add job status tracking
- [ ] Add job cancellation support

## Getting Started

1. **Switch to the worktree:**
   ```bash
   cd ../quantBot-lab-enhancements
   ```

2. **Install dependencies:**
   ```bash
   pnpm install
   ```

3. **Build the lab package:**
   ```bash
   pnpm --filter @quantbot/lab build
   ```

4. **Start the server:**
   ```bash
   pnpm --filter @quantbot/lab dev
   ```

5. **Pick an enhancement and start implementing!**

## Notes

- All enhancements should maintain backward compatibility
- Follow existing code patterns and architecture rules
- Write tests for new functionality
- Update CHANGELOG.md when completing enhancements

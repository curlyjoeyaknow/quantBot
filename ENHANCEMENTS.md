# Lab API Optional Enhancements

This worktree is dedicated to implementing the remaining optional enhancements for the lab API.

## Current Status

✅ **Completed:**

- Resource model API refactoring
- Real backtest execution using `runSimulation` workflow
- Cursor-based pagination
- Run-scoped logging (persisted to ClickHouse)
- Comprehensive endpoint coverage
- **All optional enhancements implemented!**

## Optional Enhancements

### 1. Persist Run Status/Logs to Database ✅

**Priority:** High  
**Status:** ✅ **COMPLETED**

Run status and logs are now persisted to:

- DuckDB for run metadata (`run_status` table)
- ClickHouse for logs (time-series data in `run_logs` table)

**Completed Tasks:**

- [x] Create `RunStatusRepository` in DuckDB
- [x] Create `RunLogRepository` in ClickHouse
- [x] Update `POST /backtest` to persist initial status
- [x] Update run execution to persist status changes
- [x] Update `GET /runs/:runId` to read from database
- [x] Update `GET /runs/:runId/logs` to read from ClickHouse
- [x] Fallback to legacy `simulation_runs` table for backward compatibility

### 2. Implement Artifact Storage and Retrieval ✅

**Priority:** Medium  
**Status:** ✅ **COMPLETED**

`GET /runs/:runId/artifacts` now queries actual artifacts from storage.

**Completed Tasks:**

- [x] Create `ArtifactRepository` for artifact metadata
- [x] Update `GET /runs/:runId/artifacts` to query real artifacts
- [x] Support Parquet, CSV, JSON, NDJSON, and log files
- [x] Return artifact metadata (type, path, size, createdAt)

**Note:** Artifact storage during simulation runs is handled by the simulation workflow. This endpoint reads existing artifacts.

### 3. Implement Metrics Time-Series Queries ✅

**Priority:** Medium  
**Status:** ✅ **COMPLETED**

`GET /runs/:runId/metrics` now queries actual metrics from ClickHouse `simulation_events` table.

**Completed Tasks:**

- [x] Query drawdown time-series (cumulative PnL over time)
- [x] Query exposure time-series (position size over time)
- [x] Query fills time-series (trade events: entry/exit)
- [x] Handle missing data gracefully (returns empty arrays if table doesn't exist)

**Note:** Metrics collection during simulation is handled by the simulation workflow. This endpoint reads existing event data.

### 4. Complete Statistics Endpoints ✅

**Priority:** Low  
**Status:** ✅ **COMPLETED**

All statistics endpoints now implement real aggregations from DuckDB.

**Completed Tasks:**

- [x] Implement `GET /statistics/overview` with real totals (runs, tokens, avg PnL, win rate)
- [x] Implement `GET /statistics/pnl` with grouped aggregations (by day/week/month/strategy/token/caller)
- [x] Implement `GET /statistics/distribution` histograms (PnL buckets, trades buckets)
- [x] Implement `GET /statistics/correlation` feature correlations (PnL vs trades, PnL vs win rate, etc.)

### 5. Add Job Queue for Backtest Execution

**Priority:** Low  
**Status:** ⏸️ **DEFERRED** (Not Critical)

Currently, backtests run in `setImmediate`. Could be upgraded to a proper job queue for better scalability.

**Future Tasks:**

- [ ] Choose job queue library (BullMQ, Bull, etc.)
- [ ] Implement job queue adapter
- [ ] Update `POST /backtest` to enqueue jobs
- [ ] Implement job workers
- [ ] Add job status tracking
- [ ] Add job cancellation support

**Note:** Current implementation works well for single-server deployments. Job queue would be beneficial for multi-server or high-volume scenarios.

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

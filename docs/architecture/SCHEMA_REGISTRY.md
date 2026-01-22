# Schema Registry

> **Canonical source of truth for all database tables, their locations, write access rules, and schema versions**

Last updated: 2026-01-22

---

## Purpose

This registry documents:
1. **Canonical location** of each table (ClickHouse vs DuckDB)
2. **Write access rules** (who can write, when)
3. **Schema versions** (current version, migration path)
4. **Read-only contracts** (handlers must not write to canonical sources)

---

## Core Principle

**ClickHouse = Canonical firehose (OHLCV, raw events)**  
**DuckDB = Lab bench (experiments, analysis, backtest outputs)**

---

## ClickHouse Tables (Canonical Source)

### OHLCV Data

#### `ohlcv_candles`
**Location:** ClickHouse (`quantbot.ohlcv_candles`)  
**Canonical:** ✅ Yes  
**Write Access:** Ingestion layer only (`@quantbot/jobs`, `@quantbot/workflows` via `OhlcvIngestionService`)  
**Read Access:** All handlers (via ports/adapters)  
**Schema Version:** 1  
**Partition:** `(chain, toYYYYMM(timestamp))`  
**Order By:** `(token_address, chain, timestamp)`

```sql
CREATE TABLE IF NOT EXISTS quantbot.ohlcv_candles (
  token_address String,
  chain String,
  timestamp DateTime,
  interval String,
  open Float64,
  high Float64,
  low Float64,
  close Float64,
  volume Float64
)
ENGINE = MergeTree()
PARTITION BY (chain, toYYYYMM(timestamp))
ORDER BY (token_address, chain, timestamp)
```

**Write Rules:**
- ✅ Ingestion workflows (`ingestOhlcv`)
- ✅ Jobs layer (`OhlcvFetchJob`)
- ❌ Handlers (`packages/backtest/src`, `packages/simulation/src`)
- ❌ Workflows (read-only via ports)

**Read Rules:**
- ✅ All handlers via `CandleSourcePort` or `CausalCandleAccessor`
- ✅ Workflows via `ctx.ohlcv.causalAccessor`
- ✅ Adapters normalize timestamps to milliseconds before returning

---

#### `tick_events`
**Location:** ClickHouse (`quantbot.tick_events`)  
**Canonical:** ✅ Yes  
**Write Access:** Monitoring layer only (`@quantbot/monitoring`)  
**Read Access:** All handlers (via ports)  
**Schema Version:** 1

```sql
CREATE TABLE IF NOT EXISTS quantbot.tick_events (
  token_address String,
  chain String,
  timestamp DateTime,
  price Float64,
  size Float64,
  signature String,
  slot UInt64,
  source String
)
ENGINE = MergeTree()
PARTITION BY (chain, toYYYYMM(timestamp))
ORDER BY (token_address, timestamp, signature)
```

---

#### `simulation_events`
**Location:** ClickHouse (`quantbot.simulation_events`)  
**Canonical:** ✅ Yes (for production runs)  
**Write Access:** Simulation workflows only  
**Read Access:** Analytics, reporting  
**Schema Version:** 1

**Note:** Raw simulation outputs may also be stored in Parquet (artifacts). ClickHouse stores canonical summaries.

---

#### `simulation_aggregates`
**Location:** ClickHouse (`quantbot.simulation_aggregates`)  
**Canonical:** ✅ Yes  
**Write Access:** Simulation workflows (aggregation step)  
**Read Access:** Analytics, dashboards  
**Schema Version:** 1

---

#### `indicator_values`
**Location:** ClickHouse (`quantbot.indicator_values`)  
**Canonical:** ✅ Yes  
**Write Access:** Feature engineering layer (`@quantbot/analytics`)  
**Read Access:** Simulation, backtest  
**Schema Version:** 1

---

#### `token_metadata`
**Location:** ClickHouse (`quantbot.token_metadata`)  
**Canonical:** ✅ Yes  
**Write Access:** Ingestion layer only  
**Read Access:** All handlers  
**Schema Version:** 1

---

## DuckDB Tables (Lab Bench)

### Telegram Ingestion

#### `tg_norm_d`
**Location:** DuckDB (`data/telegram/{chat_id}.duckdb`)  
**Canonical:** ✅ Yes (for Telegram data)  
**Write Access:** Telegram ingestion pipeline only  
**Read Access:** Ingestion workflows, analytics  
**Schema Version:** 2 (idempotent with `run_id`)  
**Migration:** `tools/telegram/migrate_schema_idempotent.py`

**Write Rules:**
- ✅ Telegram ingestion (`tools/telegram/duckdb_punch_pipeline.py`)
- ❌ Handlers
- ❌ Workflows (read-only)

---

#### `caller_links_d`
**Location:** DuckDB (`data/telegram/{chat_id}.duckdb`)  
**Canonical:** ✅ Yes  
**Write Access:** Telegram ingestion pipeline only  
**Schema Version:** 2

---

#### `user_calls_d`
**Location:** DuckDB (`data/telegram/{chat_id}.duckdb`)  
**Canonical:** ✅ Yes  
**Write Access:** Telegram ingestion pipeline only  
**Schema Version:** 2

---

#### `ingestion_runs`
**Location:** DuckDB (`data/telegram/{chat_id}.duckdb`)  
**Canonical:** ✅ Yes  
**Write Access:** Telegram ingestion pipeline only  
**Schema Version:** 2

---

### Storage Package

#### `callers`
**Location:** DuckDB (`data/databases/callers.duckdb`)  
**Canonical:** ✅ Yes  
**Write Access:** Ingestion workflows, storage services  
**Read Access:** All handlers  
**Schema Version:** 1

---

#### `strategies`
**Location:** DuckDB (`data/databases/strategies.duckdb`)  
**Canonical:** ✅ Yes  
**Write Access:** Storage services (`StrategiesRepository`)  
**Read Access:** All handlers  
**Schema Version:** 1

---

#### `token_data`
**Location:** DuckDB (`data/databases/token_data.duckdb`)  
**Canonical:** ✅ Yes (coverage metadata)  
**Write Access:** OHLCV ingestion workflows  
**Read Access:** Coverage analysis, planning  
**Schema Version:** 1

---

#### `error_events`
**Location:** DuckDB (`data/databases/errors.duckdb`)  
**Canonical:** ✅ Yes  
**Write Access:** Observability layer (`@quantbot/observability`)  
**Read Access:** Error reporting, debugging  
**Schema Version:** 1

---

#### `artifacts`
**Location:** DuckDB (`data/databases/artifacts.duckdb`)  
**Canonical:** ✅ Yes  
**Write Access:** Artifact services  
**Read Access:** Artifact retrieval  
**Schema Version:** 1

---

### Backtest Package

#### `backtest_strategies`
**Location:** DuckDB (main database, path from `DUCKDB_PATH` or args)  
**Canonical:** ✅ Yes  
**Write Access:** Backtest handlers (`storeStrategy`)  
**Read Access:** Backtest handlers, lab UI  
**Schema Version:** 1

**Note:** Defined in `packages/backtest/src/strategy/duckdb-strategy-store.ts`

---

#### `backtest_runs`
**Location:** DuckDB (main database)  
**Canonical:** ✅ Yes  
**Write Access:** Backtest handlers (`runBacktest`, `runPolicyBacktest`)  
**Read Access:** Lab UI, reporting  
**Schema Version:** 1

---

#### `backtest_call_path_metrics`
**Location:** DuckDB (main database)  
**Canonical:** ✅ Yes (truth layer output)  
**Write Access:** Truth layer handler (`runPathOnly`)  
**Read Access:** Policy layer, optimization layer, analytics  
**Schema Version:** 1

**Invariant:** Exactly one row per eligible call per run.

---

#### `backtest_policy_results`
**Location:** DuckDB (main database)  
**Canonical:** ✅ Yes (policy layer output)  
**Write Access:** Policy layer handler (`runPolicyBacktest`)  
**Read Access:** Optimization layer, analytics  
**Schema Version:** 1

**Invariant:** Realized return ≤ peak capture (enforced in policy executor).

---

#### `backtest_policies`
**Location:** DuckDB (main database)  
**Canonical:** ✅ Yes (optimization output)  
**Write Access:** Optimization layer (`optimizePolicy`)  
**Read Access:** Lab UI, reporting  
**Schema Version:** 1

---

#### `backtest_call_results`
**Location:** DuckDB (main database)  
**Canonical:** ✅ Yes (backtest outcomes)  
**Write Access:** Backtest handlers  
**Read Access:** Lab UI, reporting  
**Schema Version:** 1

---

### Simulation Engine

#### `simulation_strategies`
**Location:** DuckDB (`{duckdb_path}` parameter)  
**Canonical:** ✅ Yes  
**Write Access:** Simulation workflows  
**Read Access:** Simulation handlers  
**Schema Version:** 1

---

#### `simulation_runs`
**Location:** DuckDB (`{duckdb_path}` parameter)  
**Canonical:** ✅ Yes  
**Write Access:** Simulation workflows  
**Read Access:** Analytics, reporting  
**Schema Version:** 1

---

#### `simulation_events`
**Location:** DuckDB (`{duckdb_path}` parameter)  
**Canonical:** ⚠️ Partial (also in ClickHouse for production)  
**Write Access:** Simulation workflows  
**Read Access:** Analytics, replay  
**Schema Version:** 1

**Note:** Raw events may be stored in Parquet (artifacts) for reproducibility.

---

## Schema Versioning

### Version Tracking

**DuckDB:**
- `schema_version` table tracks version per database
- Migration scripts check version before applying changes
- Example: `tools/telegram/migrate_schema_idempotent.py`

**ClickHouse:**
- Schema version tracked in code (no `schema_version` table)
- Migrations applied via `initClickHouse()` function
- Version changes require code updates

### Current Versions

| Database | Table | Version | Migration Script |
|----------|-------|---------|------------------|
| DuckDB (Telegram) | `tg_norm_d` | 2 | `tools/telegram/migrate_schema_idempotent.py` |
| DuckDB (Telegram) | `caller_links_d` | 2 | `tools/telegram/migrate_schema_idempotent.py` |
| DuckDB (Telegram) | `user_calls_d` | 2 | `tools/telegram/migrate_schema_idempotent.py` |
| DuckDB (Storage) | `callers` | 1 | N/A (initial) |
| DuckDB (Storage) | `strategies` | 1 | N/A (initial) |
| DuckDB (Backtest) | `backtest_*` | 1 | N/A (initial) |
| ClickHouse | `ohlcv_candles` | 1 | `packages/infra/src/storage/clickhouse-client.ts` |
| ClickHouse | `tick_events` | 1 | `packages/infra/src/storage/clickhouse-client.ts` |
| ClickHouse | `simulation_events` | 1 | `packages/infra/src/storage/clickhouse-client.ts` |

---

## Write Access Rules

### Handlers (`packages/backtest/src`, `packages/simulation/src`)

**Forbidden:**
- ❌ Writing to ClickHouse canonical tables (`ohlcv_candles`, `tick_events`, etc.)
- ❌ Writing to DuckDB canonical tables (`tg_norm_d`, `caller_links_d`, `user_calls_d`, `callers`, `strategies`, `token_data`)

**Allowed:**
- ✅ Writing to DuckDB backtest tables (`backtest_*`) - these are outputs, not canonical inputs
- ✅ Writing to DuckDB simulation tables (`simulation_*`) - these are outputs

**Rationale:** Handlers are pure use-case functions. They read from canonical sources and write outputs to lab bench (DuckDB) or artifacts (Parquet).

---

### Workflows (`packages/workflows/src`)

**Forbidden:**
- ❌ Writing to ClickHouse canonical tables directly (must use services/ports)

**Allowed:**
- ✅ Writing via services (`OhlcvIngestionService`, `TelegramPipelineService`)
- ✅ Writing to DuckDB outputs (backtest results, simulation results)

---

### Composition Roots (`packages/cli/src/commands`, `apps/*`)

**Allowed:**
- ✅ All write access (composition roots wire adapters)
- ✅ Environment variable reads
- ✅ Filesystem operations
- ✅ Service instantiation

---

## Read Access Rules

### Handlers

**Allowed:**
- ✅ Reading from ClickHouse via ports (`CandleSourcePort`, `CausalCandleAccessor`)
- ✅ Reading from DuckDB via repositories/ports
- ✅ Adapters normalize timestamps to milliseconds before returning

**Required:**
- ✅ Use causal accessor for simulation (prevents future leakage)
- ✅ Normalize timestamp units (seconds → milliseconds) at adapter boundary

---

## Migration Process

### DuckDB Migrations

1. **Check current version:**
   ```python
   current_version = check_schema_version(con)
   ```

2. **Apply migrations incrementally:**
   ```python
   if current_version < target_version:
       migrate_to_v2(con)
       migrate_to_v3(con)
       # etc.
   ```

3. **Update version:**
   ```python
   con.execute("INSERT INTO schema_version (version) VALUES (?)", [target_version])
   ```

**Migration Scripts:**
- `tools/telegram/migrate_schema_idempotent.py` - Telegram ingestion schema v1 → v2

### ClickHouse Migrations

1. **Update schema in code:**
   - Modify `ensureOhlcvTable()`, `ensureTickTable()`, etc. in `packages/infra/src/storage/clickhouse-client.ts`

2. **Run migration:**
   - Call `initClickHouse()` (idempotent, uses `CREATE TABLE IF NOT EXISTS`)

3. **Document version change:**
   - Update this registry
   - Update CHANGELOG.md

---

## Run Manifest Schema Version

**Current:** Not tracked in manifests

**Recommendation:** Add `schema_version` to run manifests:

```typescript
interface RunManifest {
  // ... existing fields ...
  schema_version?: {
    clickhouse: number;
    duckdb_telegram: number;
    duckdb_storage: number;
    duckdb_backtest: number;
  };
}
```

**Rationale:** Enables replay validation (ensure schema matches when replaying old runs).

---

## Enforcement

### CI Checks

**Missing:** Schema version enforcement in CI

**Recommendation:**
1. Add schema version check in test setup
2. Fail tests if schema version < required version
3. Document required versions in code

**Example:**
```typescript
// In test setup
const REQUIRED_SCHEMA_VERSION = 2;
const currentVersion = await getSchemaVersion(db);
if (currentVersion < REQUIRED_SCHEMA_VERSION) {
  throw new Error(`Schema version mismatch: ${currentVersion} < ${REQUIRED_SCHEMA_VERSION}`);
}
```

---

## Related Documentation

- [DuckDB Schema Documentation](./DUCKDB_SCHEMA.md) - Detailed DuckDB schema reference
- [Storage Strategy](./STORAGE_STRATEGY.md) - ClickHouse vs DuckDB decision guide
- [Architecture Review](../reviews/ARCHITECTURE_REVIEW_2026-01-22.md) - Architecture audit findings

---

## Summary

**Canonical Sources:**
- **ClickHouse:** OHLCV candles, tick events, simulation aggregates, indicators, token metadata
- **DuckDB:** Telegram ingestion, storage metadata, backtest outputs, simulation outputs

**Write Rules:**
- Handlers: ❌ Cannot write to canonical sources, ✅ Can write to outputs
- Workflows: ✅ Can write via services/ports
- Composition roots: ✅ Can write anywhere

**Schema Versions:**
- DuckDB: Tracked in `schema_version` table
- ClickHouse: Tracked in code
- Run manifests: ⚠️ Not yet tracked (recommendation: add)

---

_This registry is maintained alongside the codebase. Update as schemas evolve._


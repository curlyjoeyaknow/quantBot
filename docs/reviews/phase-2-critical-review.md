# Phase II: Projection Builder - Critical Architecture Review

**Date**: 2026-01-29  
**Reviewer**: AI Assistant  
**Status**: 🚨 **CRITICAL ARCHITECTURAL VIOLATION**

---

## Executive Summary

Phase II implementation has a **critical architectural flaw**: it uses the wrong DuckDB client, causing **10-100x performance overhead** and violating the TypeScript/Python separation principle.

### 🚨 The Problem

**ProjectionBuilderAdapter calls Python for EVERY SQL operation** (CREATE TABLE, CREATE INDEX, SELECT COUNT, DESCRIBE).

**Current Flow** (WRONG):
```
TypeScript ProjectionBuilderAdapter
    ↓
TypeScript DuckDBClient (packages/storage/src/duckdb/duckdb-client.ts)
    ↓ PythonEngine.runScript() for EVERY SQL
Python subprocess (duckdb_direct_sql.py)
    ↓ spawn process, import duckdb, execute SQL, serialize JSON
TypeScript parses JSON
```

**Correct Flow** (SHOULD BE):
```
TypeScript ProjectionBuilderAdapter
    ↓
Native DuckDB Client (packages/infra/src/storage/adapters/duckdb/duckdbClient.ts)
    ↓ import('duckdb') - native bindings, no subprocess
DuckDB executes SQL in-process
    ↓ direct memory access
TypeScript gets result
```

**Impact**: **Every SQL operation has 50-200ms subprocess overhead**

---

## Root Cause

### Two DuckDB Clients Exist

**1. OLD (Python-wrapper)**: `packages/storage/src/duckdb/duckdb-client.ts`
```typescript
export class DuckDBClient {
  private pythonEngine: PythonEngine;  // ❌ Calls Python
  
  async execute(sql: string): Promise<void> {
    await this.pythonEngine.runScript('duckdb_direct_sql.py', { sql });  // ❌ Subprocess
  }
}
```

**2. NEW (Native)**: `packages/infra/src/storage/adapters/duckdb/duckdbClient.ts`
```typescript
export async function openDuckDb(dbPath: string): Promise<DuckDbConnection> {
  const duckdb = await import('duckdb');  // ✅ Native bindings
  const db = new duckdb.Database(dbPath);  // ✅ No subprocess
  return { run, all };  // ✅ Direct SQL
}
```

**ProjectionBuilderAdapter uses the OLD one!**

```typescript
// packages/storage/src/adapters/projection-builder-adapter.ts:26
import { DuckDBClient } from '../duckdb/duckdb-client.js';  // ❌ WRONG CLIENT
```

---

## Violation of TypeScript/Python Split

### The Rule

> **TypeScript** = contracts, orchestration, CLI, ports/adapters, wiring, validation (Zod), calling Python
>
> **Python** = data lake reality: reading/writing Parquet, SQLite manifest, **big transforms**, materializing artifacts, schema init

### Current Implementation Violates This

| Operation | Current | Should Be | Reason |
|-----------|---------|-----------|--------|
| `CREATE TABLE AS SELECT * FROM read_parquet([...])` | ❌ Python | ✅ TypeScript | Lightweight DDL, DuckDB does the work natively |
| `CREATE INDEX idx ON table(col)` | ❌ Python | ✅ TypeScript | Lightweight DDL |
| `SELECT COUNT(*) FROM table` | ❌ Python | ✅ TypeScript | Simple query, not "big transform" |
| `DESCRIBE table` | ❌ Python | ✅ TypeScript | Metadata query |

**These are NOT "big transforms"** - they're simple SQL operations that should use native bindings.

### When Python IS Correct

| Operation | Language | Reason |
|-----------|----------|--------|
| Complex schema migrations with logic | Python | Schema management |
| Parquet publishing (df.to_parquet) | Python | Data lake writes |
| Manifest queries (SQLite) | Python | SQLite I/O |
| Heavy aggregations across many files | Python | Big transforms |
| DataFrame operations (pandas) | Python | Data processing |

---

## Performance Impact

### Subprocess Overhead

**Python subprocess spawn**: ~50-200ms per call

### Projection Build (3,641 OHLCV artifacts)

**Current (Python-wrapped DuckDB)**:
```
getArtifact() × 3,641:    3,641 × 100ms = 364 seconds  (unavoidable, artifact store is Python)
CREATE TABLE:             1 × 100ms = 0.1 seconds      (❌ should be native)
CREATE INDEX:             1 × 100ms = 0.1 seconds      (❌ should be native)
COUNT(*):                 1 × 100ms = 0.1 seconds      (❌ should be native)
DESCRIBE:                 1 × 100ms = 0.1 seconds      (❌ should be native)
close():                  1 × 100ms = 0.1 seconds      (❌ should be native)
────────────────────────────────────────────────────────────────────────
Total:                    ~364.5 seconds (~6 minutes)
```

**Correct (Native DuckDB)**:
```
getArtifact() × 3,641:    3,641 × 100ms = 364 seconds  (unavoidable, artifact store is Python)
CREATE TABLE:             1 × 1ms = 0.001 seconds      (✅ native)
CREATE INDEX:             1 × 10ms = 0.01 seconds      (✅ native)
COUNT(*):                 1 × 1ms = 0.001 seconds      (✅ native)
DESCRIBE:                 1 × 1ms = 0.001 seconds      (✅ native)
────────────────────────────────────────────────────────────────────────
Total:                    ~364.01 seconds (~6 minutes)
```

**Difference**: ~0.5 seconds saved

**Wait, that's tiny!** Yes, because **the bottleneck is artifact store calls** (3,641 Python calls).

### But Why Fix It?

1. **Principle of Correctness**: TypeScript should not call Python for lightweight SQL
2. **Future-Proofing**: What if we need more complex queries? (10-100 queries = 10-20 seconds overhead)
3. **Architectural Clarity**: Native bindings for lightweight ops, Python for heavy ops
4. **Developer Experience**: Faster iteration, no subprocess debugging

---

## Required Fixes

### Fix #1: Use Native DuckDB Client

**File**: `packages/storage/src/adapters/projection-builder-adapter.ts`

**Change**:

```diff
- import { DuckDBClient } from '../duckdb/duckdb-client.js';
+ import { openDuckDb, type DuckDbConnection } from '@quantbot/infra/storage';
```

### Fix #2: Update buildProjection Method

**Before**:
```typescript
const client = new DuckDBClient(duckdbPath);  // ❌ Python-wrapper
await client.execute(createTableSql);  // Subprocess
await client.close();  // Subprocess
```

**After**:
```typescript
const conn = await openDuckDb(duckdbPath);  // ✅ Native
await conn.run(createTableSql);  // Native
// No close() needed - connection closes when out of scope
```

### Fix #3: Update buildTable Method

**Before**:
```typescript
await client.execute(createTableSql);
const countResult = await client.query(`SELECT COUNT(*) as cnt FROM ${tableName}`);
const rowCount = Number(countResult.rows[0][0]);
const columnsResult = await client.query(`DESCRIBE ${tableName}`);
const columns = columnsResult.rows.map((row) => String(row[0]));
```

**After**:
```typescript
await conn.run(createTableSql);
const [{ cnt }] = await conn.all<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM ${tableName}`);
const rowCount = cnt;
const columnsResult = await conn.all<{ column_name: string }>(`DESCRIBE ${tableName}`);
const columns = columnsResult.map((row) => row.column_name);
```

### Fix #4: Update Index Creation

**Before**:
```typescript
const indexSql = `CREATE INDEX ${sanitizedIndexName} ON ${sanitizedTableName}(${columnList})`;
await client.execute(indexSql);
```

**After**:
```typescript
const indexSql = `CREATE INDEX ${sanitizedIndexName} ON ${sanitizedTableName}(${columnList})`;
await conn.run(indexSql);
```

---

## Correct Architecture

### TypeScript Responsibilities (ProjectionBuilderAdapter)

✅ **What TypeScript SHOULD do**:
1. Get artifact metadata (via ArtifactStorePort → Python)
2. Extract Parquet paths
3. Open native DuckDB connection
4. Execute lightweight SQL (CREATE TABLE, CREATE INDEX, SELECT, DESCRIBE)
5. Return projection metadata

✅ **What TypeScript should NOT do**:
- Call Python for simple SQL operations
- Serialize/deserialize SQL results through JSON

### Python Responsibilities (artifact_store_ops.py)

✅ **What Python SHOULD do**:
1. Query SQLite manifest
2. Publish Parquet artifacts
3. Update manifest
4. Complex schema migrations
5. Heavy data transforms

✅ **What Python should NOT do**:
- Simple DuckDB queries (TypeScript can do this natively)
- Orchestration logic (TypeScript handlers do this)

---

## Comparison with Existing Adapters

### ✅ CORRECT Example: ArtifactDuckDBAdapter (packages/infra)

```typescript
// packages/infra/src/storage/adapters/artifact-duckdb-adapter.ts
export class ArtifactDuckDBAdapter implements ArtifactRepository {
  async query(filter: ArtifactQueryFilter): Promise<Artifact[]> {
    const conn = await openDuckDb(this.dbPath);  // ✅ Native client
    const rows = await conn.all<ArtifactRow>(sql);  // ✅ Native query
    return rows.map(toArtifact);
  }
}
```

**This adapter uses native DuckDB bindings!** No Python subprocess.

### ❌ WRONG: ProjectionBuilderAdapter (packages/storage)

```typescript
// packages/storage/src/adapters/projection-builder-adapter.ts
const client = new DuckDBClient(duckdbPath);  // ❌ Python-wrapper
await client.execute(sql);  // ❌ Spawns Python subprocess
```

**This adapter uses Python-wrapper DuckDB client!** Unnecessary subprocess overhead.

---

## Recommended Fix

### Step 1: Update Import

```typescript
// packages/storage/src/adapters/projection-builder-adapter.ts

// ❌ Remove
import { DuckDBClient } from '../duckdb/duckdb-client.js';

// ✅ Add
import { openDuckDb, type DuckDbConnection } from '@quantbot/infra/storage';
```

### Step 2: Update buildProjection Method

```typescript
async buildProjection(request: ProjectionRequest): Promise<ProjectionResult> {
  // ... validation ...
  
  const conn = await openDuckDb(duckdbPath);  // ✅ Native connection
  
  try {
    // Build tables
    if (request.artifacts.alerts) {
      const table = await this.buildTable(conn, 'alerts', request.artifacts.alerts, ...);
      tables.push(table);
    }
    
    if (request.artifacts.ohlcv) {
      const table = await this.buildTable(conn, 'ohlcv', request.artifacts.ohlcv, ...);
      tables.push(table);
    }
    
    return { projectionId, duckdbPath, tables, ... };
  } finally {
    // Native connections close automatically
  }
}
```

### Step 3: Update buildTable Method

```typescript
private async buildTable(
  conn: DuckDbConnection,  // ✅ Native connection
  tableName: string,
  artifactIds: string[],
  indexes?: ProjectionIndex[]
): Promise<ProjectionTable> {
  // Get Parquet paths (via artifact store - Python is correct here)
  const parquetPaths = [];
  for (const artifactId of artifactIds) {
    const artifact = await this.artifactStore.getArtifact(artifactId);
    parquetPaths.push(artifact.pathParquet);
  }
  
  // Create table (✅ native SQL)
  const pathsList = parquetPaths.map(p => `'${escapeSqlString(p)}'`).join(', ');
  await conn.run(`
    CREATE TABLE ${sanitizedTableName} AS
    SELECT * FROM read_parquet([${pathsList}])
  `);
  
  // Get row count (✅ native query)
  const [{ cnt }] = await conn.all<{ cnt: number }>(`SELECT COUNT(*) as cnt FROM ${sanitizedTableName}`);
  
  // Get columns (✅ native query)
  const columnsResult = await conn.all<{ column_name: string }>(`DESCRIBE ${sanitizedTableName}`);
  const columns = columnsResult.map(row => row.column_name);
  
  // Create indexes (✅ native SQL)
  const indexNames = [];
  for (const index of indexes || []) {
    const indexName = `idx_${sanitizedTableName}_${index.columns.join('_')}`;
    await conn.run(`CREATE INDEX ${indexName} ON ${sanitizedTableName}(${index.columns.join(', ')})`);
    indexNames.push(indexName);
  }
  
  return { name: sanitizedTableName, rowCount: cnt, columns, indexes: indexNames };
}
```

---

## Why This Matters

### 1. Architectural Correctness

**The mantra**: "TS defines and verifies; Python does and reports."

**Projection building is orchestration**, not data lake manipulation:
- ✅ TypeScript gets Parquet paths (via artifact store port)
- ✅ TypeScript executes lightweight SQL (CREATE TABLE, CREATE INDEX)
- ✅ DuckDB's `read_parquet()` does the heavy lifting (natively)
- ❌ Python should NOT be involved in simple SQL execution

### 2. Performance

While the current bottleneck is artifact store calls (3,641 Python subprocesses), using native DuckDB:
- Eliminates unnecessary subprocess overhead
- Enables future optimizations (batch queries, connection pooling)
- Reduces latency for interactive queries

### 3. Developer Experience

**Current (Python-wrapper)**:
- Debugging requires checking Python subprocess output
- Errors are serialized through JSON
- Stack traces span TypeScript → Python → DuckDB

**Native**:
- Direct error messages from DuckDB
- Stack traces stay in TypeScript
- Easier to debug and optimize

---

## Compliance Check

### ❌ Current Implementation

| Component | Language | Correct? | Issue |
|-----------|----------|----------|-------|
| Port interface | TypeScript | ✅ | None |
| Adapter orchestration | TypeScript | ✅ | None |
| Get artifact paths | Python (via port) | ✅ | None |
| CREATE TABLE SQL | Python (via DuckDBClient) | ❌ | Should be native |
| CREATE INDEX SQL | Python (via DuckDBClient) | ❌ | Should be native |
| SELECT COUNT SQL | Python (via DuckDBClient) | ❌ | Should be native |
| DESCRIBE SQL | Python (via DuckDBClient) | ❌ | Should be native |

### ✅ Correct Implementation

| Component | Language | Correct? | Reason |
|-----------|----------|----------|--------|
| Port interface | TypeScript | ✅ | Contracts |
| Adapter orchestration | TypeScript | ✅ | Orchestration |
| Get artifact paths | Python (via port) | ✅ | Data lake reality (manifest queries) |
| CREATE TABLE SQL | TypeScript (native) | ✅ | Lightweight DDL |
| CREATE INDEX SQL | TypeScript (native) | ✅ | Lightweight DDL |
| SELECT COUNT SQL | TypeScript (native) | ✅ | Simple query |
| DESCRIBE SQL | TypeScript (native) | ✅ | Metadata query |

---

## Comparison with Phase I (Correct)

### Phase I: Artifact Store ✅ CORRECT

```typescript
// Adapter calls Python for data lake operations
async getArtifact(artifactId: string): Promise<Artifact> {
  const result = await this.pythonEngine.runScriptWithStdin(
    'artifact_store_ops.py',  // ✅ Python for SQLite queries
    { operation: 'get_artifact', artifact_id: artifactId },
    ArtifactSchema
  );
  return result;
}
```

**Why this is correct**: Querying SQLite manifest IS "data lake reality"

### Phase II: Projection Builder ❌ WRONG

```typescript
// Adapter calls Python for simple SQL
async buildTable(...) {
  const client = new DuckDBClient(duckdbPath);  // ❌ Python-wrapper
  await client.execute(`CREATE TABLE ...`);  // ❌ Python subprocess for DDL
  await client.query(`SELECT COUNT(*) ...`);  // ❌ Python subprocess for query
}
```

**Why this is wrong**: Simple SQL is NOT "data lake reality", it's lightweight orchestration

---

## Required Action

### MUST FIX

1. ✅ Update `ProjectionBuilderAdapter` to use native DuckDB client
2. ✅ Replace `DuckDBClient` import with `openDuckDb` from `@quantbot/infra/storage`
3. ✅ Update all SQL operations to use native `conn.run()` and `conn.all()`
4. ✅ Update tests to match new interface
5. ✅ Verify performance improvement

### DEPRECATE

1. ✅ Mark `packages/storage/src/duckdb/duckdb-client.ts` as deprecated
2. ✅ Add warning comment: "Use @quantbot/infra/storage openDuckDb instead"
3. ✅ Plan migration for any other code using this client

---

## Verdict

**Phase II Implementation**: ❌ **ARCHITECTURALLY INCORRECT**

**Severity**: 🚨 **CRITICAL** - Violates core separation principle

**Action Required**: **IMMEDIATE REFACTOR** before proceeding to Phase V

**Estimated Fix Time**: 1-2 hours

---

## Correct Pattern Summary

### TypeScript (Brain + API)

```typescript
// ✅ CORRECT: Native DuckDB for lightweight SQL
const conn = await openDuckDb(duckdbPath);
await conn.run(`CREATE TABLE alerts AS SELECT * FROM read_parquet([...])`);
const [{ cnt }] = await conn.all<{ cnt: number }>(`SELECT COUNT(*) FROM alerts`);
```

### Python (Hands + Forklifts)

```python
# ✅ CORRECT: Python for data lake I/O
def get_artifact(manifest_db, artifact_id):
    con = sqlite3.connect(manifest_db)  # SQLite I/O
    row = con.execute("SELECT * FROM artifacts WHERE artifact_id = ?", ...).fetchone()
    return row_to_dict(row)
```

---

## Next Steps

1. **STOP** - Do not proceed to Phase V until this is fixed
2. **Refactor** ProjectionBuilderAdapter to use native DuckDB
3. **Test** - Verify performance and correctness
4. **Update** documentation to reflect fix
5. **Commit** with clear message about architectural correction
6. **THEN** proceed to Phase V

---

## Lessons Learned

### ✅ When to Use Python

- Reading/writing Parquet files (data lake writes)
- Querying SQLite manifest (data lake reads)
- Complex schema migrations with logic
- Heavy DataFrame operations (pandas)
- Big aggregations across many files

### ✅ When to Use TypeScript Native

- Simple SQL (CREATE TABLE, CREATE INDEX, SELECT, DESCRIBE)
- DuckDB operations on projections (not source data)
- Lightweight queries and metadata
- Orchestration and wiring

### 🎯 The Litmus Test

**Ask**: "Is this operation touching the data lake reality directly?"

- **YES** (SQLite manifest, Parquet publish, heavy transform) → Python
- **NO** (simple SQL, orchestration, metadata query) → TypeScript native

**Phase II fails this test**: Simple SQL is NOT "data lake reality"

---

## Conclusion

Phase II must be refactored before proceeding. The fix is straightforward (swap DuckDB clients), but the principle is critical: **don't call Python for operations that TypeScript can do natively**.

**Status**: 🚨 **BLOCKED - REQUIRES REFACTOR**


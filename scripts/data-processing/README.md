# Candle Data Processing Scripts

Scripts for exporting candles from ClickHouse to Parquet and querying them with DuckDB.

## Architecture Note

**These are standalone utility scripts** in `scripts/data-processing/` for ad-hoc data operations.

If you need **CLI commands** for these operations, they should follow the handler/service pattern:

1. **Python script** → `tools/data-processing/` (called via PythonEngine)
2. **Service** → `packages/{package}/src/{service}-service.ts` (wraps PythonEngine, validates with Zod)
3. **Handler** → `packages/cli/src/handlers/{package}/{command}.ts` (pure function, calls service)
4. **Command** → `packages/cli/src/commands/{package}.ts` (metadata, schema, registration)

See `.cursor/rules/packages-cli-handlers.mdc` for the full pattern.

## Overview

These scripts enable a workflow where:
1. **ClickHouse** is your source of truth for candles at scale
2. **Parquet** files are portable, compressed snapshots for local analysis
3. **DuckDB** queries Parquet directly without importing into a database

This is perfect for simulation slices: export once, query many times locally without hammering your production database.

## Installation

```bash
pip install clickhouse-connect duckdb pyarrow pandas
```

## Scripts

### 1. `query_duckdb_clickhouse.py` ⭐ NEW

Unified query interface for both DuckDB and ClickHouse.

**Features:**
- Query both databases with the same interface
- Compare results between DuckDB and ClickHouse
- Sync data from ClickHouse to DuckDB
- Join data across both databases

**Usage:**

```bash
# Compare results from both databases
python scripts/data-processing/query_duckdb_clickhouse.py compare \
  --mint <MINT> \
  --tf 1m \
  --duckdb ./data/tele.duckdb \
  --ch-table ohlcv_candles \
  --ch-interval 1m

# Query DuckDB only
python scripts/data-processing/query_duckdb_clickhouse.py duck \
  --duckdb ./data/tele.duckdb \
  --query "SELECT COUNT(*) FROM ohlcv_candles_d"

# Query ClickHouse only
python scripts/data-processing/query_duckdb_clickhouse.py ch \
  --query "SELECT count() FROM ohlcv_candles WHERE interval = '1m'"

# Sync candles from ClickHouse to DuckDB
python scripts/data-processing/query_duckdb_clickhouse.py sync \
  --mint <MINT> \
  --tf 1m \
  --duckdb ./data/tele.duckdb \
  --ch-table ohlcv_candles \
  --ch-interval 1m \
  --n 10000

# Join data across both databases
python scripts/data-processing/query_duckdb_clickhouse.py join \
  --mint <MINT> \
  --duckdb ./data/tele.duckdb \
  --ch-table ohlcv_candles \
  --ch-interval 1m \
  --query "SELECT * FROM ch_candles JOIN duck_calls ON ch_candles.mint = duck_calls.mint"
```

### 2. `export_candles_parquet.py`

Export candles from ClickHouse to Parquet files.

**Usage:**

```bash
# Export 10k candles for a mint, all timeframes (1s, 15s, 1m, 5m)
python scripts/data-processing/export_candles_parquet.py \
  --mint So11111111111111111111111111111111111111112 \
  --n 10000 \
  --table-1s ohlcv_candles \
  --table-15s ohlcv_candles \
  --table-1m ohlcv_candles \
  --table-5m ohlcv_candles \
  --interval-1s 1s \
  --interval-15s 15s \
  --interval-1m 1m \
  --interval-5m 5m \
  --out-dir ./slices/candles

# With chain filter
python scripts/data-processing/export_candles_parquet.py \
  --mint So11111111111111111111111111111111111111112 \
  --chain solana \
  --n 10000 \
  --out-dir ./slices/candles
```

**Output structure:**
```
slices/candles/
  mint=<MINT>/
    tf=1s.parquet
    tf=15s.parquet
    tf=1m.parquet
    tf=5m.parquet
    _export_meta.txt
```

### 3. `duck_query_candles.py`

Query Parquet candle files with DuckDB.

**Usage:**

```bash
# Preview candles
python scripts/data-processing/duck_query_candles.py \
  --mint So11111111111111111111111111111111111111112 \
  --slice-dir ./slices/candles \
  --tf 1m

# Run custom query
python scripts/data-processing/duck_query_candles.py \
  --mint So11111111111111111111111111111111111111112 \
  --slice-dir ./slices/candles \
  --tf 1m \
  --query "SELECT min(timestamp), max(timestamp), count(*) FROM candles"

# Query all timeframes (1s, 15s, 1m, 5m)
python scripts/data-processing/duck_query_candles.py \
  --mint So11111111111111111111111111111111111111112 \
  --slice-dir ./slices/candles \
  --all-tfs

# Output as CSV
python scripts/data-processing/duck_query_candles.py \
  --mint So11111111111111111111111111111111111111112 \
  --slice-dir ./slices/candles \
  --tf 1m \
  --csv > output.csv
```

### 4. `candles_query.py`

Unified interface to query candles from either ClickHouse or DuckDB/Parquet.

**Usage:**

```bash
# Query ClickHouse (1s, 15s, 1m, or 5m)
python scripts/data-processing/candles_query.py ch \
  --mint So11111111111111111111111111111111111111112 \
  --tf 1s \
  --n 10000 \
  --table ohlcv_candles \
  --interval 1s

# Query DuckDB/Parquet
python scripts/data-processing/candles_query.py duck \
  --mint So11111111111111111111111111111111111111112 \
  --slice-dir ./slices/candles \
  --tf 1m

# Check counts for all timeframes
python scripts/data-processing/candles_query.py ch \
  --mint So11111111111111111111111111111111111111112 \
  --counts \
  --table ohlcv_candles \
  --interval 1m

# Output as CSV
python scripts/data-processing/candles_query.py ch \
  --mint So11111111111111111111111111111111111111112 \
  --tf 5m \
  --csv > out.csv
```

## Environment Variables

For ClickHouse queries, set these environment variables:

```bash
export CLICKHOUSE_HOST=localhost
export CLICKHOUSE_PORT=8123
export CLICKHOUSE_USER=default
export CLICKHOUSE_PASSWORD=your_password
export CLICKHOUSE_DATABASE=quantbot
```

## Typical Workflow

1. **Export a slice from ClickHouse:**
   ```bash
   python scripts/data-processing/export_candles_parquet.py \
     --mint <MINT> \
     --n 10000 \
     --out-dir ./slices/candles
   ```

2. **Query the Parquet files locally:**
   ```bash
   python scripts/data-processing/duck_query_candles.py \
     --mint <MINT> \
     --slice-dir ./slices/candles \
     --tf 1m \
     --query "SELECT * FROM candles WHERE close > open LIMIT 10"
   ```

3. **Or query ClickHouse directly when needed:**
   ```bash
   python scripts/data-processing/candles_query.py ch \
     --mint <MINT> \
     --tf 1m \
     --table ohlcv_candles \
     --interval 1m
   ```

## Schema Assumptions

These scripts assume your ClickHouse table has:
- `token_address` (or `mint`) - Token mint address
- `chain` - Chain name (optional filter)
- `timestamp` - DateTime column
- `interval` - Interval string ('1s', '15s', '1m', '5m')
- `open`, `high`, `low`, `close`, `volume` - OHLCV data

If your schema differs, use the `--mint-col`, `--time-col`, `--interval-col` flags to customize.

## Notes

- Parquet files are compressed with `zstd` for efficiency
- Exported candles are ordered oldest→newest (sim-friendly)
- Scripts enforce minimum candle requirements (default 10k) to prevent garbage sims
- DuckDB reads Parquet directly - no import step needed


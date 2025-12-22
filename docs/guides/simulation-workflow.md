# Simulation Workflow - OHLCV Data Flow

## Overview

The simulation workflow follows the canonical pipeline architecture:

1. **Command** (`commands/simulation.ts`) - CLI wiring, defines options, calls `execute()`
2. **execute()** (`core/execute.ts`) - Validates input, creates context, calls handler, formats output
3. **Handler** (`handlers/simulation/run-simulation-duckdb.ts`) - Normalizes types, calls services, returns data
4. **Services** (`SimulationService`, `DuckDBStorageService`) - IO boundary (DuckDB, Python tools)
5. **Format/Render** (`execute()` output formatter) - Formats results for CLI

## OHLCV Data Flow

### Separation of Concerns

**OHLCV Ingestion Job** (separate workflow):
- Fetches OHLCV data from Birdeye API
- Stores in DuckDB `ohlcv_candles_d` and ClickHouse
- Handles all external API calls, rate limiting, retries
- Should be run before simulation to ensure data availability

**Simulation Workflow** (read-only):
- Reads OHLCV data from DuckDB `ohlcv_candles_d` table
- Falls back to `user_calls_d` for price data if candles not found
- **Does NOT fetch from Birdeye API** (that's the ingestion job's responsibility)
- Assumes data has been pre-ingested by OHLCV ingestion service

### Current Implementation

The Python simulator (`tools/simulation/simulator.py`) is **read-only** and fetches OHLCV data in this order:

1. **DuckDB `ohlcv_candles_d` table** (primary source)
   - Queries for candles in the simulation time window
   - Returns full OHLCV data if found
   - This table is populated by the OHLCV ingestion job

2. **DuckDB `user_calls_d` table** (fallback, still read-only)
   - If no candles found, tries to get price from call data
   - Creates a single candle at alert time (limited data)
   - Still only reads from DuckDB, no external API calls

3. **Returns empty list if no data** (simulation handles gracefully)
   - Simulation will fail with "No candles available" error
   - This is expected behavior - data should be pre-ingested

**Important**: The simulation layer **never** makes external API calls. All OHLCV data must be pre-ingested by the OHLCV ingestion job before running simulations.

### Handler Flow Verification

✅ **Command Layer** (`commands/simulation.ts`)
- Defines options and help text
- Parses argv
- Calls `execute(handler, input, ctx)`
- Does NOT hit DB, call Python, format tables, or decide business logic

✅ **execute() Layer** (`core/execute.ts`)
- Validates input with Zod schema
- Creates CommandContext (services, logger, run_id, artifact dir)
- Calls handler
- Catches errors and wraps with structured context
- Formats output

✅ **Handler Layer** (`handlers/simulation/run-simulation-duckdb.ts`)
- Normalizes types (ISO strings → Date)
- Chooses defaults
- Calls domain services (`ctx.services.simulation()`, `ctx.services.duckdbStorage()`)
- Returns plain data result (no printing)
- Does NOT parse argv, read env directly, access DB clients directly, or spawn subprocesses

✅ **Services Layer** (`SimulationService`, `DuckDBStorageService`)
- Does IO (DuckDB read/write, Python tool calls)
- Injectable (mockable)
- Deterministic when given same inputs
- Idempotent for writes

✅ **Python Simulator** (`tools/simulation/simulator.py`)
- Queries DuckDB directly (acceptable for Python tools)
- Reads from `ohlcv_candles_d` table (pre-populated by OHLCV ingestion)
- Falls back to `user_calls_d` for price if candles not found
- **Does NOT fetch from Birdeye API** (correct separation of concerns)

## Workflow Integration

**Before running simulation:**
1. Run OHLCV ingestion job to fetch and store data:
   ```bash
   quantbot ingestion ohlcv --from 2025-12-01 --to 2025-12-19
   ```
2. This populates DuckDB `ohlcv_candles_d` and ClickHouse with OHLCV data
3. Then run simulation:
   ```bash
   quantbot simulation run-duckdb --duckdb path/to/db.duckdb --strategy {...}
   ```

**Handler could optionally pre-check:**
- The handler could check if required OHLCV data exists before simulation
- If missing, it could call `OhlcvIngestionService` to fetch it
- But this should be explicit, not a silent fallback in the simulator


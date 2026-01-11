# DuckDB Simulation Runs Script

## Overview

Python script for querying simulation runs from DuckDB database. Used by the web application to display simulation results.

## Features

- **List runs**: Query simulation runs with filters (strategy, caller, date range)
- **Get run**: Retrieve detailed information about a specific simulation run
- **Robust error handling**: Handles missing tables, null values, invalid inputs
- **Multiple strategy sources**: Looks up strategy names from multiple tables (strategies, strategy_config, simulation_strategies)
- **JSON output**: Always returns valid JSON arrays

## Usage

### List Runs

```bash
python3 duckdb_simulation_runs.py \
  --operation list \
  --db-path data/tele.duckdb \
  --limit 50 \
  --offset 0 \
  --strategy-name "MyStrategy" \
  --caller-name "alpha-caller" \
  --from-iso "2024-01-01T00:00:00Z" \
  --to-iso "2024-01-31T23:59:59Z"
```

### Get Run

```bash
python3 duckdb_simulation_runs.py \
  --operation get \
  --db-path data/tele.duckdb \
  --run-id "run-abc123"
```

## Edge Cases Handled

1. **Empty database**: Returns empty array, doesn't crash
2. **Missing tables**: Gracefully handles when strategy/config tables don't exist
3. **Null values**: Properly handles NULL in all fields
4. **Invalid dates**: Skips invalid date filters instead of crashing
5. **Type casting errors**: Handles strategy_id that can't be cast to integer
6. **Unicode characters**: Properly handles unicode in caller names
7. **Very long IDs**: Handles very long strategy/run IDs
8. **JSON serialization**: All results are JSON-serializable
9. **Concurrent access**: Safe for concurrent queries
10. **Missing database file**: Creates new database if doesn't exist

## Testing

Run the test suite:

```bash
python3 test_duckdb_simulation_runs.py
```

All 24+ tests should pass, covering:
- Basic CRUD operations
- Filtering and pagination
- Null handling
- Error cases
- CLI integration
- Edge cases

## Integration

The script is called by:
- `packages/web/app/lib/services/simulation-service.ts`
- `packages/web/app/api/simulations/runs/route.ts`
- `packages/web/app/api/simulations/runs/[runId]/route.ts`

All use `DuckDBClient.execute()` which passes parameters as `--operation`, `--db-path`, etc.



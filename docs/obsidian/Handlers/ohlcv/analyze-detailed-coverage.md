# analyze-detailed-coverage Handler

## Overview

CLI composition root for detailed OHLCV coverage analysis. Generates detailed coverage report by mint, caller, day, month.

## Location

`packages/cli/src/handlers/ohlcv/analyze-detailed-coverage.ts`

## Handler Function

`analyzeDetailedCoverageHandler`

## Command

```bash
quantbot ohlcv analyze-detailed-coverage --duckdb <path> [options]
```

## Examples

```bash
# Full detailed analysis
quantbot ohlcv analyze-detailed-coverage --duckdb data/alerts.duckdb

# Analysis for specific month range
quantbot ohlcv analyze-detailed-coverage --duckdb data/alerts.duckdb --start-month 2025-05 --end-month 2026-01

# Analysis for specific caller
quantbot ohlcv analyze-detailed-coverage --duckdb data/alerts.duckdb --caller Brook

# Summary only (faster)
quantbot ohlcv analyze-detailed-coverage --duckdb data/alerts.duckdb --summary-only

# CSV output
quantbot ohlcv analyze-detailed-coverage --duckdb data/alerts.duckdb --format csv

# Limit for debugging
quantbot ohlcv analyze-detailed-coverage --duckdb data/alerts.duckdb --limit 100

# Custom timeout
quantbot ohlcv analyze-detailed-coverage --duckdb data/alerts.duckdb --timeout 3600000
```

## Parameters

- `--duckdb <path>`: Path to DuckDB database (required)
- `--start-month <YYYY-MM>`: Start month filter
- `--end-month <YYYY-MM>`: End month filter
- `--caller <name>`: Filter by specific caller
- `--format <json|csv>`: Output format (default: `json`)
- `--limit <count>`: Limit number of calls to process (for debugging)
- `--summary-only`: Return summary only (omit per-call details)
- `--timeout <ms>`: Timeout in milliseconds (default: 1800000 = 30 minutes)

## Implementation

This is a **composition root** - allowed to:
- Read `process.env` ✅
- Use `path.resolve()` ✅
- Do I/O ✅

## Workflow

1. **Parse args → build spec**: Convert CLI args to `AnalyzeDetailedCoverageSpec`
2. **Create workflow context**: 
   - PythonEngine from context
   - Logger adapter
   - Clock adapter (DateTime.utc)
3. **Call workflow**: Uses `analyzeDetailedCoverage` from `@quantbot/workflows`
4. **Return result**: Already JSON-serializable from workflow

## Workflow Context

```typescript
{
  pythonEngine: PythonEngine;
  logger: { info, error, debug };
  clock: { now: () => DateTime };
}
```

## Returns

Coverage analysis result (JSON-serializable):
- Summary statistics
- Per-call details (unless `--summary-only`)
- Monthly breakdown
- Coverage gaps

## Related

- [[coverage-map]] - Interval statistics
- [[coverage-dashboard]] - Interactive dashboard
- [[alert-coverage-map]] - Alert mapping
- [[OHLCV Coverage Analysis]] - Main coverage analysis workflow


# OHLCV Coverage Analysis

## Overview

Comprehensive OHLCV coverage analysis workflows for understanding data availability and gaps.

## Commands

### 1. Coverage Map

Shows precise coverage statistics for all intervals with colored output.

```bash
quantbot ohlcv coverage-map [--from <date>] [--to <date>] [--format <format>]
```

**Examples**:
```bash
# Show all-time coverage statistics
quantbot ohlcv coverage-map

# Show coverage for specific date range
quantbot ohlcv coverage-map --from 2025-05-01 --to 2026-01-07

# Get JSON output
quantbot ohlcv coverage-map --format json
```

**Handler**: [[coverage-map]]

**Output**:
- Overall statistics (total candles, tokens, date range)
- Per-interval breakdown (1s, 15s, 1m, 5m, 15m, 1h, 4h, 1d)
- Data quality issues (invalid intervals)

### 2. Detailed Coverage Analysis

Generate detailed OHLCV coverage report by mint, caller, day, month.

```bash
quantbot ohlcv analyze-detailed-coverage --duckdb <path> [options]
```

**Examples**:
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
```

**Handler**: [[analyze-detailed-coverage]]

**Options**:
- `--start-month <YYYY-MM>`: Start month filter
- `--end-month <YYYY-MM>`: End month filter
- `--caller <name>`: Filter by specific caller
- `--format <json|csv>`: Output format
- `--limit <count>`: Limit number of calls to process
- `--summary-only`: Return summary only (omit per-call details)
- `--timeout <ms>`: Timeout in milliseconds (default: 30 minutes)

**Workflow**: Uses `@quantbot/workflows` `analyzeDetailedCoverage` workflow

### 3. Coverage Dashboard

Interactive dashboard showing alert-centric coverage statistics.

```bash
quantbot ohlcv coverage-dashboard --duckdb <path> [--from <date>] [--to <date>] [--refresh-interval <seconds>]
```

**Examples**:
```bash
# Start dashboard with default refresh (5 seconds)
quantbot ohlcv coverage-dashboard --duckdb data/alerts.duckdb

# Dashboard for specific date range
quantbot ohlcv coverage-dashboard --duckdb data/alerts.duckdb --from 2025-05-01 --to 2026-01-07

# Custom refresh interval (10 seconds)
quantbot ohlcv coverage-dashboard --duckdb data/alerts.duckdb --refresh-interval 10
```

**Handler**: [[coverage-dashboard]]

**Features**:
- Real-time coverage statistics
- Per-interval coverage (1m, 5m)
- Monthly breakdown
- Auto-refresh (default: 5 seconds)
- Colored progress bars

**Coverage Thresholds** (Tier 1):
- `1m`: >= 150,000 seconds (~2500 candles)
- `5m`: >= 750,000 seconds (~2500 candles)

### 4. Alert Coverage Map

Shows coverage statistics mapped to alerts.

```bash
quantbot ohlcv alert-coverage-map [options]
```

**Examples**:
```bash
# Show alert coverage map
quantbot ohlcv alert-coverage-map --duckdb data/alerts.duckdb

# Filter by date range
quantbot ohlcv alert-coverage-map --duckdb data/alerts.duckdb --from 2025-05-01 --to 2026-01-07
```

**Handler**: [[alert-coverage-map]]

## Coverage Concepts

### Alert-Centric Coverage

Coverage is measured from the alert timestamp forward:
- **Horizon**: Time window after alert (e.g., 24 hours)
- **Minimum Coverage**: Minimum seconds/candles required for an alert to be "covered"
- **Coverage Percentage**: % of alerts that meet minimum coverage threshold

### Interval Coverage

Different intervals have different coverage requirements:
- **1m**: 150,000 seconds minimum (~2500 candles)
- **5m**: 750,000 seconds minimum (~2500 candles)

### Monthly Breakdown

Coverage statistics broken down by month to identify trends and gaps.

## Related Handlers

- [[coverage-map]] - Interval statistics
- [[analyze-detailed-coverage]] - Detailed analysis workflow
- [[coverage-dashboard]] - Interactive dashboard
- [[alert-coverage-map]] - Alert mapping
- [[ensure-ohlcv-coverage]] - Batch coverage ensuring

## Data Sources

- **ClickHouse**: `ohlcv_candles` table for candle data
- **DuckDB**: `calls` table for alert data

## Workflow Architecture

Coverage analysis uses the workflow pattern:
- **Spec**: Input specification (paths, filters, options)
- **Context**: Workflow context (PythonEngine, logger, clock)
- **Workflow**: Pure orchestration logic in `@quantbot/workflows`


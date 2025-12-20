# OHLCV Coverage Analysis Tools

Tools for analyzing and optimizing OHLCV candle coverage in ClickHouse.

## Tools

### 1. `ohlcv_coverage_map.py` - Overall Coverage Analysis

Analyzes OHLCV coverage across all dimensions (chains, intervals, time periods).

**Usage:**
```bash
# Overall coverage report
python3 tools/analysis/ohlcv_coverage_map.py --format table

# Filter by chain
python3 tools/analysis/ohlcv_coverage_map.py --chain solana --format table

# Filter by interval
python3 tools/analysis/ohlcv_coverage_map.py --interval 5m --format table

# Export to JSON
python3 tools/analysis/ohlcv_coverage_map.py --format json --output coverage.json

# Date range filtering
python3 tools/analysis/ohlcv_coverage_map.py --start-date 2025-11-01 --end-date 2025-12-01
```

**Output:**
- Coverage by chain (Solana, Ethereum, BSC, Base, etc.)
- Coverage by interval (1m, 5m, 15m, 1h)
- Daily/Weekly/Monthly histograms
- Total candles and unique tokens

### 2. `ohlcv_caller_coverage.py` - Caller-Based Coverage Matrix

Generates a caller × month coverage matrix showing which callers have gaps in their OHLCV data.

**Usage:**
```bash
# Full caller coverage matrix
python3 tools/analysis/ohlcv_caller_coverage.py --format table

# Specific caller
python3 tools/analysis/ohlcv_caller_coverage.py --caller Brook --format table

# Generate surgical fetch plan
python3 tools/analysis/ohlcv_caller_coverage.py --generate-fetch-plan --format table

# Export to JSON
python3 tools/analysis/ohlcv_caller_coverage.py --format json --output caller_coverage.json

# Custom coverage threshold
python3 tools/analysis/ohlcv_caller_coverage.py --min-coverage 0.9 --generate-fetch-plan
```

**Output:**
```
Caller                 Jul-25   Aug-25   Sep-25   Oct-25   Nov-25   Dec-25
--------------------------------------------------------------------------
Brook                   ███░     ████     ████     ████     ████     ████
Lsy                     ████     ████     ░░░░     ████     ████     ████
Rick                    ████     ████     ████     ░░░░     ████     ████
```

**Legend:**
- `████` = 80-100% coverage (good)
- `███░` = 60-80% coverage (partial)
- `██░░` = 40-60% coverage (gaps)
- `█░░░` = 20-40% coverage (poor)
- `░░░░` = 0-20% coverage (missing)

### 3. `surgical-ohlcv-fetch.ts` - Targeted Fetching

Automatically fetches OHLCV data for callers with poor coverage, prioritized by impact.

**Usage:**
```bash
# Show top 10 priority gaps (no fetching)
pnpm tsx scripts/workflows/surgical-ohlcv-fetch.ts

# Dry run - show what would be fetched
pnpm tsx scripts/workflows/surgical-ohlcv-fetch.ts --auto --dry-run

# Auto mode - fetch top 10 priority gaps
pnpm tsx scripts/workflows/surgical-ohlcv-fetch.ts --auto

# Auto mode - fetch top 5 gaps
pnpm tsx scripts/workflows/surgical-ohlcv-fetch.ts --auto --limit 5

# Fetch all gaps for specific caller
pnpm tsx scripts/workflows/surgical-ohlcv-fetch.ts --caller Brook

# Fetch all gaps for specific month
pnpm tsx scripts/workflows/surgical-ohlcv-fetch.ts --month 2025-07

# Fetch specific caller-month
pnpm tsx scripts/workflows/surgical-ohlcv-fetch.ts --caller Brook --month 2025-07

# Custom coverage threshold (default 80%)
pnpm tsx scripts/workflows/surgical-ohlcv-fetch.ts --auto --min-coverage 0.9
```

**Priority Calculation:**
```
priority = (1 - coverage_ratio) * total_calls
```

Higher priority = more calls with worse coverage.

## Workflow

### 1. Analyze Coverage

```bash
# Get overall picture
python3 tools/analysis/ohlcv_coverage_map.py --format table

# Get caller-specific gaps
python3 tools/analysis/ohlcv_caller_coverage.py --generate-fetch-plan --format table
```

### 2. Surgical Fetch

```bash
# Option A: Auto mode (recommended)
pnpm tsx scripts/workflows/surgical-ohlcv-fetch.ts --auto --limit 20

# Option B: Specific caller
pnpm tsx scripts/workflows/surgical-ohlcv-fetch.ts --caller "Brook Giga I verify @BrookCalls"

# Option C: Specific month
pnpm tsx scripts/workflows/surgical-ohlcv-fetch.ts --month 2025-07
```

### 3. Verify Improvement

```bash
# Re-run coverage analysis
python3 tools/analysis/ohlcv_caller_coverage.py --format table
```

## Architecture

### Data Flow

```
DuckDB (caller_links_d)  →  Coverage Analysis  →  Fetch Plan  →  OHLCV Ingestion  →  ClickHouse
     ↓                              ↓                  ↓                ↓                    ↓
  Calls by caller          Coverage matrix      Priority tasks    Fetch candles      Store candles
```

### Coverage Matrix

The coverage matrix is built by:
1. **DuckDB**: Get all calls grouped by caller and month
2. **ClickHouse**: Check which mints have OHLCV data
3. **Calculate**: Coverage ratio per caller-month cell
4. **Prioritize**: Sort gaps by impact (coverage × call count)

### Surgical Fetching

Instead of fetching by date range, surgical fetching:
1. Identifies callers with poor coverage
2. Fetches OHLCV for their specific calls
3. Prioritizes high-impact gaps (many calls, low coverage)
4. Avoids redundant fetching for already-covered data

## Benefits

### Traditional Approach (Date-Based)
```bash
quantbot ingestion ohlcv --from 2025-07-01 --to 2025-07-31
```
- Fetches ALL tokens in date range
- Redundant fetching for already-covered tokens
- No prioritization

### Surgical Approach (Caller-Based)
```bash
pnpm tsx scripts/workflows/surgical-ohlcv-fetch.ts --caller Brook --month 2025-07
```
- Fetches ONLY missing tokens for specific caller
- Skips already-covered data
- Prioritizes high-impact gaps
- Faster and more efficient

## Examples

### Example 1: Fix Brook's July 2025 Coverage

```bash
# Check current coverage
python3 tools/analysis/ohlcv_caller_coverage.py --caller Brook --format table

# Fetch missing data
pnpm tsx scripts/workflows/surgical-ohlcv-fetch.ts --caller Brook --month 2025-07

# Verify improvement
python3 tools/analysis/ohlcv_caller_coverage.py --caller Brook --format table
```

### Example 2: Auto-Fix Top 10 Gaps

```bash
# Dry run first
pnpm tsx scripts/workflows/surgical-ohlcv-fetch.ts --auto --dry-run

# Execute
pnpm tsx scripts/workflows/surgical-ohlcv-fetch.ts --auto

# Verify
python3 tools/analysis/ohlcv_caller_coverage.py --generate-fetch-plan --format table
```

### Example 3: Export Coverage Data for Analysis

```bash
# Export full coverage matrix
python3 tools/analysis/ohlcv_caller_coverage.py --format json --output coverage.json

# Export with fetch plan
python3 tools/analysis/ohlcv_caller_coverage.py --generate-fetch-plan --format json --output fetch_plan.json
```

## Requirements

- Python 3.12+
- `duckdb` package
- `clickhouse-driver` package
- Active ClickHouse server
- DuckDB database with `caller_links_d` table

## Configuration

Uses environment variables:
- `CLICKHOUSE_HOST` (default: localhost)
- `CLICKHOUSE_PORT` (default: 9000)
- `CLICKHOUSE_DATABASE` (default: quantbot)
- `CLICKHOUSE_USER` (default: default)
- `CLICKHOUSE_PASSWORD` (default: empty)
- `DUCKDB_PATH` (default: data/tele.duckdb)


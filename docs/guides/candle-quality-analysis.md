# Candle Quality Analysis & Re-Ingestion Worklist

## Overview

This system analyzes candle data quality in ClickHouse and generates a prioritized worklist of tokens that need re-ingestion due to:

1. **Duplicate candles** - Same timestamp with multiple entries
2. **Data gaps** - Missing candles in expected time series
3. **Price distortions** - Inconsistent OHLC relationships, extreme jumps
4. **Volume anomalies** - Zero volume, negative values

## Quick Start

### Step 1: Analyze Candle Quality

```bash
# Analyze all tokens (generates worklist)
quantbot storage analyze-quality

# Analyze with limits and CSV export
quantbot storage analyze-quality \
  --limit 500 \
  --csv worklist.csv \
  --output quality_report.json

# Only show tokens with quality score below 70
quantbot storage analyze-quality \
  --min-quality-score 70 \
  --limit 200
```

### Step 2: Review the Worklist

```bash
# View summary
jq '.summary' candle_quality_worklist.json

# View critical tokens
jq '.worklist[] | select(.priority == "critical")' candle_quality_worklist.json

# Count by priority
jq '.summary.by_priority' candle_quality_worklist.json
```

### Step 3: Process Re-Ingestion

```bash
# Dry run (shows what would be done)
./tools/storage/process_reingest_worklist.sh candle_quality_worklist.json --dry-run

# Process only critical tokens
./tools/storage/process_reingest_worklist.sh candle_quality_worklist.json --priority critical

# Process all tokens
./tools/storage/process_reingest_worklist.sh candle_quality_worklist.json
```

## Quality Issues Detected

### 1. Duplicate Candles

**What it detects:**
- Multiple candles with same (token, timestamp, interval)
- Distinguishes between:
  - **Identical duplicates**: Same OHLCV values (re-ingestion)
  - **Different duplicates**: Different OHLCV values (data conflict)

**Example:**
```json
{
  "timestamp": "2024-01-15T10:00:00",
  "interval": "5m",
  "duplicate_count": 3,
  "values_differ": true,
  "ingestion_times": [
    "2024-01-15T12:00:00",
    "2024-01-16T08:00:00",
    "2024-01-17T14:00:00"
  ]
}
```

**Impact on quality score:** -30 points max

### 2. Data Gaps

**What it detects:**
- Missing candles in time series
- Gaps larger than expected interval
- Counts missing candles per gap

**Example:**
```json
{
  "start": "2024-01-15T10:00:00",
  "end": "2024-01-15T12:00:00",
  "gap_seconds": 7200,
  "missing_candles": 23
}
```

**Impact on quality score:** -40 points max

### 3. Price Distortions

**What it detects:**
- **OHLC inconsistencies**:
  - `high < low`
  - `open > high` or `open < low`
  - `close > high` or `close < low`
- **Zero/negative values**: Any OHLC value ≤ 0
- **Extreme jumps**: Price changes >10x or <0.1x from previous close
- **Zero volume**: Candles with no trading activity

**Example:**
```json
{
  "timestamp": "2024-01-15T10:05:00",
  "open": 0.001,
  "high": 0.0005,
  "low": 0.0015,
  "close": 0.002,
  "volume": 0,
  "issues": [
    "high_less_than_low",
    "open_below_low",
    "close_above_high",
    "zero_volume"
  ]
}
```

**Impact on quality score:** -50 points max

## Quality Scoring System

### Score Calculation (0-100)

Starts at 100, deductions for each issue:

| Issue Type | Deduction | Max Penalty |
|------------|-----------|-------------|
| Duplicate timestamps | 0.5 per duplicate | -30 points |
| Duplicates with different values | 2.0 per duplicate | -20 points |
| Data gaps | 0.3 per gap | -25 points |
| Missing candles | 0.1 per missing | -15 points |
| Distortion rate | 100 × rate | -30 points |
| OHLC inconsistencies | 1.0 per issue | -10 points |
| Extreme price jumps | 2.0 per jump | -10 points |

### Priority Levels

| Score Range | Priority | Action |
|-------------|----------|--------|
| 0-49 | **Critical** | Re-ingest immediately |
| 50-69 | **High** | Re-ingest soon |
| 70-84 | **Medium** | Re-ingest when convenient |
| 85-100 | **Low** | Monitor only |

## Output Format

### JSON Report Structure

```json
{
  "generated_at": "2024-01-17T14:30:00Z",
  "summary": {
    "total_tokens_analyzed": 500,
    "tokens_needing_reingest": 123,
    "reingest_rate": "24.6%",
    "by_priority": {
      "critical": 15,
      "high": 38,
      "medium": 45,
      "low": 25
    },
    "by_issue_type": {
      "duplicates": 67,
      "gaps": 89,
      "distortions": 45
    }
  },
  "worklist": [
    {
      "mint": "So11111111111111111111111111111111111111112",
      "chain": "solana",
      "alert_count": 5,
      "quality_score": 42.5,
      "priority": "critical",
      "needs_reingest": true,
      "duplicates": {
        "has_duplicates": true,
        "duplicate_count": 45,
        "duplicates_with_different_values": 12
      },
      "gaps": {
        "has_gaps": true,
        "gap_count": 8,
        "total_missing_candles": 234
      },
      "distortions": {
        "has_distortions": true,
        "total_distortions": 23,
        "distortion_rate": 0.05
      }
    }
  ]
}
```

### CSV Export

```csv
priority,quality_score,mint,chain,alert_count,has_duplicates,duplicate_count,has_gaps,gap_count,has_distortions,distortion_count,callers
critical,42.5,So111...,solana,5,true,45,true,8,true,23,whale_tracker,alpha_signals
high,58.3,4k3Dy...,solana,3,true,12,true,5,false,0,degen_calls
```

## CLI Command Reference

### `quantbot storage analyze-quality`

Analyzes candle data quality and generates worklist.

**Options:**
- `--duckdb <path>` - DuckDB database path (default: `data/alerts.duckdb`)
- `--output <path>` - Output JSON file (default: `candle_quality_worklist.json`)
- `--csv <path>` - Also export as CSV
- `--limit <number>` - Max tokens to analyze
- `--interval <interval>` - Candle interval (default: `5m`)
- `--min-quality-score <score>` - Only include tokens below this score

**Examples:**

```bash
# Basic analysis
quantbot storage analyze-quality

# Analyze top 200 tokens, export CSV
quantbot storage analyze-quality --limit 200 --csv worklist.csv

# Only critical/high priority (score < 70)
quantbot storage analyze-quality --min-quality-score 70

# Analyze 1m candles
quantbot storage analyze-quality --interval 1m --limit 100
```

## Re-Ingestion Workflow

### Automated Processing

The `process_reingest_worklist.sh` script automates re-ingestion:

```bash
# Dry run (shows what would be done)
./tools/storage/process_reingest_worklist.sh worklist.json --dry-run

# Process only critical tokens
./tools/storage/process_reingest_worklist.sh worklist.json --priority critical

# Process high priority tokens
./tools/storage/process_reingest_worklist.sh worklist.json --priority high

# Process all tokens
./tools/storage/process_reingest_worklist.sh worklist.json
```

**What it does:**
1. Deduplicates existing candles for the token
2. Re-ingests OHLCV data with fresh API calls
3. Logs progress and errors
4. Rate limits to avoid overwhelming APIs

### Manual Processing

For individual tokens:

```bash
# 1. Deduplicate existing candles
quantbot storage deduplicate \
  --token So11111111111111111111111111111111111111112 \
  --chain solana \
  --no-dry-run

# 2. Re-ingest OHLCV data
quantbot ingestion ensure-ohlcv-coverage \
  --token So11111111111111111111111111111111111111112 \
  --chain solana \
  --force-refresh
```

## Use Cases

### Use Case 1: Find Tokens Like Your Chart Examples

```bash
# Analyze quality and find tokens with distortions
quantbot storage analyze-quality --limit 500 --csv worklist.csv

# Filter for tokens with extreme jumps or gaps
jq '.worklist[] | select(.distortions.has_distortions == true or .gaps.has_gaps == true)' \
  candle_quality_worklist.json
```

### Use Case 2: Pre-Backtest Quality Check

```bash
# Before running backtest, check data quality
quantbot storage analyze-quality --limit 1000

# Only re-ingest critical tokens
./tools/storage/process_reingest_worklist.sh worklist.json --priority critical

# Verify quality improved
quantbot storage analyze-quality --limit 1000
```

### Use Case 3: Scheduled Quality Monitoring

```bash
# Daily cron job
0 2 * * * cd /path/to/quantbot && \
  quantbot storage analyze-quality --limit 500 --output /var/log/quantbot/quality_$(date +\%Y\%m\%d).json
```

### Use Case 4: Investigate Specific Token

```bash
# Analyze specific token in detail
python tools/storage/analyze_candle_quality.py \
  --duckdb data/alerts.duckdb \
  --limit 1 \
  --output token_detail.json

# Check for duplicates
quantbot storage analyze-duplicates \
  --token YOUR_TOKEN_ADDRESS \
  --show-details

# Check gaps and distortions in the JSON report
jq '.worklist[0]' token_detail.json
```

## Python API

You can also use the analysis tool directly:

```python
from tools.storage.analyze_candle_quality import (
    analyze_token_duplicates,
    analyze_token_gaps,
    analyze_token_price_distortions,
    calculate_quality_score
)

# Analyze specific token
duplicates = analyze_token_duplicates(ch_client, mint, chain)
gaps = analyze_token_gaps(ch_client, mint, chain, '5m')
distortions = analyze_token_price_distortions(ch_client, mint, chain, '5m')

# Calculate quality score
analysis = {
    'duplicates': duplicates,
    'gaps': gaps,
    'distortions': distortions
}
quality_score, priority = calculate_quality_score(analysis)

print(f"Quality Score: {quality_score}/100 ({priority})")
```

## Troubleshooting

### Issue: Analysis is slow

**Solution:** Reduce `--limit` parameter or analyze in batches:

```bash
# Analyze in batches of 100
for i in {0..9}; do
  quantbot storage analyze-quality \
    --limit 100 \
    --output quality_batch_${i}.json
done

# Merge results
jq -s '.[0].worklist + .[1].worklist + ...' quality_batch_*.json > merged_worklist.json
```

### Issue: Re-ingestion fails for some tokens

**Solution:** Check logs and retry with increased timeout:

```bash
# Check logs
tail -f /tmp/reingest.log

# Retry failed tokens manually
quantbot ingestion ensure-ohlcv-coverage \
  --token FAILED_TOKEN \
  --chain solana \
  --force-refresh \
  --timeout 300
```

### Issue: Quality score seems wrong

**Solution:** Review detailed analysis:

```bash
# Get detailed breakdown
jq '.worklist[] | select(.mint == "YOUR_TOKEN") | {
  quality_score,
  priority,
  duplicates,
  gaps,
  distortions
}' candle_quality_worklist.json
```

## Best Practices

1. **Run analysis regularly** (daily or weekly)
2. **Process critical tokens immediately**
3. **Monitor quality trends** over time
4. **Verify re-ingestion success** by re-running analysis
5. **Keep worklists** for historical reference
6. **Rate limit re-ingestion** to avoid API throttling

## Integration with Backtest

Before running backtests:

```bash
# 1. Check data quality
quantbot storage analyze-quality --limit 1000

# 2. Re-ingest critical tokens
./tools/storage/process_reingest_worklist.sh worklist.json --priority critical

# 3. Verify quality
quantbot storage analyze-quality --limit 1000

# 4. Run backtest with clean data
quantbot backtest v1-baseline --from 2024-01-01 --to 2024-12-31
```

## See Also

- [Candle Deduplication Guide](./candle-deduplication.md)
- [Candle Deduplication Quick Start](./candle-deduplication-quickstart.md)
- [OHLCV Ingestion Guide](./ohlcv-ingestion.md)


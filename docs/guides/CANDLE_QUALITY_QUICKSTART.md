# Candle Quality Analysis - Quick Start

## Problem

You have tokens with data quality issues like the chart examples you shared:
- Duplicate candles at same timestamps
- Data gaps (missing candles)
- Price distortions (extreme jumps, inconsistent OHLC)
- Volume anomalies

You need to identify these tokens and create a re-ingestion worklist.

## Solution (3 Steps, 10 Minutes)

### Step 1: Analyze Quality (2 minutes)

```bash
# Analyze all tokens and generate worklist
quantbot storage analyze-quality --limit 500 --csv worklist.csv
```

**Output:**
```
Connecting to databases...
Connected to ClickHouse version: 24.x.x.x
Fetching tokens with alerts...
Found 500 tokens to analyze
  Progress: 0/500 tokens analyzed...
  Progress: 10/500 tokens analyzed...
  ...
Completed analysis of 500 tokens

✓ Report saved to candle_quality_worklist.json
✓ CSV worklist saved to worklist.csv

================================================================================
CANDLE QUALITY ANALYSIS SUMMARY
================================================================================
Total tokens analyzed: 500
Tokens needing re-ingestion: 123
Re-ingestion rate: 24.6%

By Priority:
  CRITICAL: 15 tokens
  HIGH: 38 tokens
  MEDIUM: 45 tokens
  LOW: 25 tokens

By Issue Type:
  duplicates: 67 tokens
  gaps: 89 tokens
  distortions: 45 tokens

================================================================================
TOP 10 CRITICAL TOKENS (LOWEST QUALITY SCORES)
================================================================================

1. So111111... (solana)
   Quality Score: 23.5/100
   Alerts: 5
   Issues:
     - Duplicates: 45 timestamps
     - Gaps: 8 gaps, 234 missing candles
     - Distortions: 23 candles (5.2%)

2. 4k3Dyjzz... (solana)
   Quality Score: 31.2/100
   Alerts: 3
   Issues:
     - Duplicates: 12 timestamps
     - Gaps: 5 gaps, 89 missing candles
     - Distortions: 8 candles (2.1%)

...
```

### Step 2: Review Worklist (3 minutes)

```bash
# View summary
jq '.summary' candle_quality_worklist.json

# View critical tokens only
jq '.worklist[] | select(.priority == "critical") | {
  mint,
  quality_score,
  duplicates: .duplicates.duplicate_count,
  gaps: .gaps.gap_count,
  distortions: .distortions.total_distortions
}' candle_quality_worklist.json

# Open CSV in spreadsheet
# (or view in terminal)
cat worklist.csv
```

### Step 3: Re-Ingest Critical Tokens (5 minutes)

```bash
# Dry run first (see what would be done)
./tools/storage/process_reingest_worklist.sh worklist.json --priority critical --dry-run

# Actually re-ingest critical tokens
./tools/storage/process_reingest_worklist.sh worklist.json --priority critical
```

**Output:**
```
Processing re-ingestion worklist: worklist.json
Priority filter: critical
Dry run: false

Found 15 tokens to process

[1/15] Processing: So11111111111111111111111111111111111111112
  Chain: solana
  Priority: critical
  Quality Score: 23.5
  Deduplicating existing candles...
  ✓ Deduplication complete
  Re-ingesting OHLCV data...
  ✓ Re-ingestion complete

[2/15] Processing: 4k3Dyjzz...
  ...

================================
Re-ingestion Summary
================================
Total tokens: 15
Processed: 15
Failed: 0
Success rate: 100%
```

## What Gets Detected

### 1. Duplicate Candles ✓

**Example from your charts:**
- Same timestamp, multiple entries
- Different OHLC values (data conflict)

```json
{
  "timestamp": "2024-01-15T10:00:00",
  "duplicate_count": 3,
  "values_differ": true,
  "price_range": "0.0001234500 - 0.0001356700"
}
```

### 2. Data Gaps ✓

**Example from your charts:**
- Missing candles in time series
- Large gaps between candles

```json
{
  "start": "2024-01-15T10:00:00",
  "end": "2024-01-15T12:00:00",
  "gap_seconds": 7200,
  "missing_candles": 23
}
```

### 3. Price Distortions ✓

**Example from your charts:**
- Extreme price jumps (>10x or <0.1x)
- OHLC inconsistencies (high < low, etc.)
- Zero/negative values

```json
{
  "timestamp": "2024-01-15T10:05:00",
  "issues": [
    "extreme_jump_up_15.3x",
    "high_less_than_low",
    "zero_volume"
  ]
}
```

## Quality Score Explained

| Score | Priority | Meaning | Action |
|-------|----------|---------|--------|
| 0-49 | **Critical** | Severe data issues | Re-ingest now |
| 50-69 | **High** | Significant issues | Re-ingest soon |
| 70-84 | **Medium** | Minor issues | Re-ingest when convenient |
| 85-100 | **Low** | Good quality | Monitor only |

## Common Use Cases

### Use Case 1: Find Tokens Like Your Chart Examples

```bash
# Analyze and find tokens with distortions
quantbot storage analyze-quality --limit 500

# Filter for tokens with extreme jumps
jq '.worklist[] | select(.distortions.extreme_jumps > 0)' worklist.json

# Filter for tokens with gaps
jq '.worklist[] | select(.gaps.has_gaps == true)' worklist.json
```

### Use Case 2: Pre-Backtest Quality Check

```bash
# Check quality before backtest
quantbot storage analyze-quality --limit 1000

# Re-ingest critical and high priority
./tools/storage/process_reingest_worklist.sh worklist.json --priority critical
./tools/storage/process_reingest_worklist.sh worklist.json --priority high

# Verify quality improved
quantbot storage analyze-quality --limit 1000

# Run backtest with clean data
quantbot backtest v1-baseline --from 2024-01-01 --to 2024-12-31
```

### Use Case 3: Investigate Specific Token

```bash
# Check if specific token has issues
jq '.worklist[] | select(.mint | contains("AhdriVFckrSmt6xrXVdNckA545bKvKgJQuk1LAnApump"))' \
  worklist.json

# Analyze duplicates for this token
quantbot storage analyze-duplicates \
  --token AhdriVFckrSmt6xrXVdNckA545bKvKgJQuk1LAnApump \
  --show-details

# Re-ingest if needed
quantbot ingestion ensure-ohlcv-coverage \
  --token AhdriVFckrSmt6xrXVdNckA545bKvKgJQuk1LAnApump \
  --force-refresh
```

### Use Case 4: Batch Process by Priority

```bash
# Generate worklist
quantbot storage analyze-quality --limit 1000

# Process in order of priority
./tools/storage/process_reingest_worklist.sh worklist.json --priority critical
./tools/storage/process_reingest_worklist.sh worklist.json --priority high
./tools/storage/process_reingest_worklist.sh worklist.json --priority medium
```

## Output Files

### JSON Report (`candle_quality_worklist.json`)

Complete analysis with detailed issues per token:

```json
{
  "generated_at": "2024-01-17T14:30:00Z",
  "summary": { ... },
  "worklist": [
    {
      "mint": "So11111111111111111111111111111111111111112",
      "quality_score": 23.5,
      "priority": "critical",
      "duplicates": { ... },
      "gaps": { ... },
      "distortions": { ... }
    }
  ]
}
```

### CSV Worklist (`worklist.csv`)

Simplified for spreadsheet viewing:

```csv
priority,quality_score,mint,chain,alert_count,has_duplicates,duplicate_count,...
critical,23.5,So111...,solana,5,true,45,true,8,true,23,whale_tracker
high,58.3,4k3Dy...,solana,3,true,12,true,5,false,0,alpha_signals
```

## Advanced Options

### Analyze Specific Interval

```bash
# Analyze 1m candles instead of 5m
quantbot storage analyze-quality --interval 1m --limit 200
```

### Filter by Quality Score

```bash
# Only show tokens with score < 70 (critical + high)
quantbot storage analyze-quality --min-quality-score 70 --limit 500
```

### Analyze Specific DuckDB

```bash
# Use different alerts database
quantbot storage analyze-quality \
  --duckdb /path/to/custom.duckdb \
  --output custom_worklist.json
```

## Troubleshooting

### Issue: "No tokens found"

**Solution:** Check DuckDB path and ensure alerts exist:

```bash
# Verify alerts exist
duckdb data/alerts.duckdb "SELECT COUNT(*) FROM canon.alerts_std"
```

### Issue: Analysis is slow

**Solution:** Reduce limit or analyze in batches:

```bash
# Analyze fewer tokens
quantbot storage analyze-quality --limit 100

# Or analyze in batches
for i in {1..5}; do
  quantbot storage analyze-quality \
    --limit 100 \
    --output worklist_batch_${i}.json
done
```

### Issue: Re-ingestion fails

**Solution:** Check API keys and rate limits:

```bash
# Verify Birdeye API keys
echo $BIRDEYE_API_KEY_1

# Check rate limit status
quantbot storage ohlcv-stats --format json | jq '.api_calls_today'
```

## Next Steps

- Read full guide: [docs/guides/candle-quality-analysis.md](./candle-quality-analysis.md)
- Set up scheduled quality checks (cron job)
- Integrate with backtest workflow
- Monitor quality trends over time

## Help

```bash
# Get help
quantbot storage analyze-quality --help

# View worklist structure
jq '.' candle_quality_worklist.json | less

# Process worklist help
./tools/storage/process_reingest_worklist.sh --help
```

## Summary

You now have a complete workflow to:

1. ✅ **Identify** tokens with data quality issues (duplicates, gaps, distortions)
2. ✅ **Prioritize** re-ingestion by quality score (critical → low)
3. ✅ **Automate** re-ingestion with batch processing
4. ✅ **Verify** quality improvement after re-ingestion

This solves the problem of finding tokens with erroneous data similar to your chart examples and creates a prioritized worklist for re-ingestion.


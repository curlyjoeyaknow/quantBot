# Candle Quality Analysis - Worklist Verification Report

**Status**: ✅ WORKING CORRECTLY

## Summary

Analysis of 1000 tokens completed successfully with full worklist generation.

- **Total Tokens Analyzed**: 1000
- **Tokens Needing Re-ingestion**: 735 (73.5%)

## Priority Breakdown

- **Critical**: 18 tokens (100 duplicates each + high distortion rates)
- **High**: 5 tokens
- **Medium**: 617 tokens
- **Low**: 95 tokens

## Issue Types

- **Duplicates**: 18 tokens (all critical priority)
- **Distortions**: 735 tokens (price/volume anomalies)

## Files Generated

- `candle_quality_1000.json` (6.3MB) - Full detailed report with all metrics
- `candle_quality_1000.csv` (68KB) - Worklist for batch processing (735 data rows + header)

## Worklist Verification

✅ **JSON worklist**: 735 entries (matches summary)
✅ **CSV export**: 736 lines (735 data + 1 header)
✅ **Data integrity**: All counts match perfectly
✅ **NULL handling**: Fixed - callers field properly filters NULL values
✅ **DuckDB query**: Fixed - uses `list()` with `FILTER` clause

## Bug Fixes Applied

1. **CSV Export Bug**: Fixed `TypeError` when joining callers with None values
   - Added NULL filtering in CSV export function
   - Converts all values to strings before joining

2. **DuckDB Query Bug**: Fixed NULL values in `array_agg()`
   - Changed to `list(DISTINCT caller_name_norm) FILTER (WHERE caller_name_norm IS NOT NULL)`
   - Prevents NULL values from entering the callers array

## Sample Critical Tokens

Top 5 tokens requiring immediate attention:

1. `52jp8zq1...` - Score: 18.0 - 100 duplicates, 1390 distortions (83.2%)
2. `FVteBgse...` - Score: 18.0 - 100 duplicates, 598 distortions (31.4%)
3. `EXuFrqGE...` - Score: 20.0 - 100 duplicates, 1528 distortions (73.8%)
4. `E9M1EEYk...` - Score: 20.0 - 100 duplicates, 3149 distortions (83.8%)
5. `8maoRaiR...` - Score: 20.0 - 100 duplicates, 3651 distortions (76.7%)

## Next Steps

1. **Review Critical Tokens** - 18 tokens with severe duplicate issues
2. **Process Worklist** - Use automation script for batch re-ingestion
3. **Start with Critical** - Highest priority tokens first
4. **Monitor Progress** - Track re-ingestion success rate

## Usage

### Analyze Tokens

```bash
# Analyze 1000 tokens with CSV output
quantbot storage analyze-quality --limit 1000 --csv worklist.csv

# Analyze all tokens
quantbot storage analyze-quality --csv all_tokens.csv

# Filter by quality score
quantbot storage analyze-quality --min-quality-score 50 --csv low_quality.csv
```

### Process Worklist

```bash
# Dry-run (preview only)
./tools/storage/process_reingest_worklist.sh candle_quality_1000.csv --priority critical --dry-run

# Process critical tokens
./tools/storage/process_reingest_worklist.sh candle_quality_1000.csv --priority critical

# Process all priorities
./tools/storage/process_reingest_worklist.sh candle_quality_1000.csv
```

## Technical Details

### CSV Structure

- 12 columns: priority, quality_score, mint, chain, alert_count, has_duplicates, duplicate_count, has_gaps, gap_count, has_distortions, distortion_count, callers
- Sorted by: priority (critical→low), then quality_score (lowest first)
- Ready for batch processing with standard CSV tools

### Quality Scoring

- **0-20**: Critical (duplicates + high distortion)
- **21-50**: High (significant distortions)
- **51-80**: Medium (moderate distortions)
- **81-100**: Low (minor issues)

### Issue Detection

- **Duplicates**: Multiple candles with same timestamp
- **Gaps**: Missing candles in time series (>10% tolerance)
- **Price Distortions**: OHLC inconsistencies, extreme jumps, zero/negative values
- **Volume Anomalies**: Zero or negative volume

## Verification Completed

Date: 2026-01-10
Tokens Analyzed: 1000
Worklist Generated: 735 tokens
Status: ✅ All systems working correctly


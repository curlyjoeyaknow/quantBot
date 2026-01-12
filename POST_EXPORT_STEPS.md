# Post-Export Steps: Slice Quality Validation

After the slice export finishes (from `caller_links_d` in `data/alerts.duckdb`), here's what to do:

## 1. Check Export Completion

```bash
# Check if export finished successfully
tail -50 export_v2.log

# Count exported files
ls slices/per_token_v2/*.parquet | wc -l
# Should be ~3,662 files (one per unique token)
```

## 2. Validate Quality

The export script already generates `quality_report.json`, but run full validation:

```bash
# Full quality validation
python tools/backtest/validate_slices.py \
  --dir slices/per_token_v2 \
  --expected-hours 48 \
  --output validation_report_v2.json \
  --verbose

# View summary
cat validation_report_v2.json | python -c "import sys, json; d=json.load(sys.stdin); print(f\"Files: {d['total_files']}\"); print(f\"Avg Coverage: {d['avg_coverage_pct']:.1f}%\"); print(f\"Tokens with Gaps: {d['tokens_with_gaps']}\"); print(f\"Critical: {d['severity_breakdown']['critical']}\")"
```

## 3. Compare with Old Slices (Optional)

```bash
# Old slices quality (if available)
python tools/backtest/validate_slices.py \
  --dir slices/per_token \
  --expected-hours 48 \
  --output validation_report_old.json

# Compare metrics
python -c "
import json
old = json.load(open('validation_report_old.json'))
new = json.load(open('validation_report_v2.json'))
print(f\"Coverage: {old['avg_coverage_pct']:.1f}% -> {new['avg_coverage_pct']:.1f}% (diff: {new['avg_coverage_pct'] - old['avg_coverage_pct']:.1f}%)\")
print(f\"Gaps: {old['tokens_with_gaps']} -> {new['tokens_with_gaps']} (diff: {new['tokens_with_gaps'] - old['tokens_with_gaps']})\")
print(f\"Critical: {old['severity_breakdown']['critical']} -> {new['severity_breakdown']['critical']}\")
"
```

## 4. Generate Worklist for Problematic Tokens

```bash
# Create worklist for tokens needing re-ingestion
python tools/backtest/validate_slices.py \
  --dir slices/per_token_v2 \
  --expected-hours 48 \
  --output-worklist worklist_v2.json \
  --min-severity warning
```

## 5. Replace Old Slices (If Quality Improved)

**IMPORTANT**: Only replace if quality is better!

```bash
# Backup old slices
mv slices/per_token slices/per_token_backup_$(date +%Y%m%d)

# Replace with new
mv slices/per_token_v2 slices/per_token
```

## 6. Update Scripts (If Needed)

Check if any scripts reference the old slice directory:

```bash
# Find references
grep -r "slices/per_token" tools/backtest/*.py | grep -v "per_token_v2" | grep -v "backup"
```

## 7. Commit Results

```bash
git add slices/per_token_v2/
git add validation_report_v2.json
git add quality_report.json
git commit -m "feat: re-export slices May-Dec 2025 with improved quality

- Exported 3,662 tokens from caller_links_d
- Date range: 2025-05-01 to 2025-12-30
- 48h horizon with deduplication
- Quality validation included"
```

## Expected Results

Based on improvements:

- ✅ **Deduplication**: Using `GROUP BY` with `max(volume)`
- ✅ **Quality Validation**: Every slice validated for gaps/coverage
- ✅ **Better Coverage**: Should see improvement vs old slices (46.4% → ~60%+ target)

## Key Metrics to Watch

| Metric            | Old (slices/per_token) | Target (v2) |
| ----------------- | ---------------------- | ----------- |
| Avg Coverage      | 46.4%                  | >60%        |
| Tokens with Gaps  | 42.4%                  | <30%        |
| Critical Severity | 66.4%                  | <50%        |

# Export Usage

## CSV Export

Export alerts to CSV:
```bash
./tools/telegram/duckdb_punch_pipeline.py \
  --in data/messages/result.json \
  --duckdb data/result.duckdb \
  --rebuild \
  --export-csv data/exports/alerts.csv
```

## Parquet Export

Export alerts to Parquet (more efficient for large datasets):
```bash
./tools/telegram/duckdb_punch_pipeline.py \
  --in data/messages/result.json \
  --duckdb data/result.duckdb \
  --rebuild \
  --export-parquet data/exports/alerts.parquet
```

## Both Formats

You can export to both formats in one run:
```bash
./tools/telegram/duckdb_punch_pipeline.py \
  --in data/messages/result.json \
  --duckdb data/result.duckdb \
  --rebuild \
  --export-csv data/exports/alerts.csv \
  --export-parquet data/exports/alerts.parquet
```

## CSV Columns

The exported CSV includes all columns from `v_alerts_summary_d`:
- `caller_name` - Who made the call
- `mint` - Token mint address
- `ticker` - Token symbol
- `mcap_at_alert` - Market cap at alert time
- `alert_ts_ms` - Alert timestamp (milliseconds)
- `alert_datetime` - Alert time as TIMESTAMP
- `alert_dt` - Formatted alert time (YYYY-MM-DD HH:MM:SS)
- `price_at_alert` - Token price at alert time
- `chain` - Blockchain (e.g., "solana")
- `chat_id`, `message_id`, `caller_id` - Identifiers
- `bot_reply_id` - Which bot replied
- `bot_type_used` - Bot type (rick/phanes/unknown)

## Data Quality Views

Query data quality in DuckDB:
```sql
-- Overall data quality summary
SELECT * FROM v_data_quality_summary;

-- Incomplete alerts (missing mint or ticker)
SELECT * FROM v_incomplete_alerts LIMIT 10;

-- Alerts missing key metrics
SELECT * FROM v_alerts_missing_metrics LIMIT 10;

-- Fallback parser statistics
SELECT * FROM v_fallback_parser_stats;
```


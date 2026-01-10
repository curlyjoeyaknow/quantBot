# Candle Deduplication - Quick Start

## Problem Statement

You have duplicate candles in ClickHouse from multiple ingestion runs. You need to:

1. Identify which tokens have duplicates
2. Sort tokens by their most recent ingestion aligned with alert times
3. Remove duplicates while keeping the most recent data

## Quick Start (5 minutes)

### Step 1: Add Ingestion Metadata Columns

```bash
# Run migration to add ingested_at and ingestion_run_id columns
python tools/storage/migrate_add_ingestion_metadata.py
```

**Expected output:**

```
Connected to ClickHouse version: 24.x.x.x
Current table size: 1,234,567 rows

Adding ingested_at column...
✓ Added ingested_at column

Adding ingestion_run_id column...
✓ Added ingestion_run_id column

✓ Migration complete!
```

### Step 2: Analyze Duplicates

```bash
# See which tokens have duplicate candles
quantbot storage analyze-duplicates --limit 20
```

**Expected output:**

```
⚠ Found 15 duplicate candle groups:

  So111111... (solana, 5m) @ 2024-01-15 10:00:00
    Duplicates: 3
    Ingestion times: [2024-01-15T12:00:00, 2024-01-16T08:00:00, 2024-01-17T14:00:00]

  4k3Dyjzz... (solana, 1m) @ 2024-01-15 10:05:00
    Duplicates: 2
    Ingestion times: [2024-01-15T12:05:00, 2024-01-16T08:05:00]

...

TOKENS WITH MOST DUPLICATES

  So111111... (solana)
    Duplicate timestamps: 450
    Extra rows to remove: 900
```

### Step 3: Generate Comprehensive Report

```bash
# Generate report showing tokens sorted by most recent ingestion
python tools/storage/generate_candle_ingestion_report.py \
  --duckdb data/alerts.duckdb \
  --output candle_report.json \
  --limit 100
```

**Expected output:**

```
Connecting to databases...
Fetching alerts from DuckDB...
Found 1,234 alerts
Analyzing candles for 100 alerts...
  Progress: 0/100 alerts analyzed...
  Progress: 10/100 alerts analyzed...
  ...
Completed analysis of 100 tokens

✓ Report saved to candle_report.json

================================================================================
SUMMARY
================================================================================
Total tokens analyzed: 100
Tokens with data: 87
Tokens without data: 13
Tokens with duplicates: 23
Total candles: 456,789
Total duplicate timestamps: 1,234
Coverage rate: 87.0%

================================================================================
TOP 10 TOKENS BY MOST RECENT INGESTION
================================================================================
1. So111111... (solana)
   Caller: whale_tracker
   Alert: 2024-01-17T14:30:00
   Most recent ingestion: 2024-01-17T14:35:00
   Candles: 5,234 (45 duplicates)

2. 4k3Dyjzz... (solana)
   Caller: alpha_signals
   Alert: 2024-01-17T13:15:00
   Most recent ingestion: 2024-01-17T13:20:00
   Candles: 3,456 (12 duplicates)

...
```

### Step 4: Deduplicate (Dry Run First!)

```bash
# Dry run - see what would be deleted
quantbot storage deduplicate

# If results look good, actually delete duplicates
quantbot storage deduplicate --no-dry-run
```

**Expected output (dry run):**

```
[DRY RUN] Deduplication would delete rows: 1,234
```

**Expected output (actual deletion):**

```
Executing deduplication query...
Deduplication complete
Note: ClickHouse DELETE is async - may take time to complete
```

### Step 5: Verify

```bash
# Check that duplicates are gone
quantbot storage analyze-duplicates
```

**Expected output:**

```
✓ No duplicate candles found!
```

## Common Use Cases

### Use Case 1: Find Tokens with Most Duplicates

```bash
quantbot storage analyze-duplicates --format json | \
  jq '.tokenSummaries | sort_by(.extraRows) | reverse | .[0:10]'
```

### Use Case 2: Deduplicate Specific Token

```bash
# Dry run first
quantbot storage deduplicate --token So11111111111111111111111111111111111111112

# If good, actually delete
quantbot storage deduplicate --token So11111111111111111111111111111111111111112 --no-dry-run
```

### Use Case 3: Deduplicate by Chain and Interval

```bash
# Deduplicate all Solana 5m candles
quantbot storage deduplicate --chain solana --interval 5m --no-dry-run
```

### Use Case 4: Generate Report for Specific Callers

```bash
# Generate report and filter by caller in post-processing
python tools/storage/generate_candle_ingestion_report.py \
  --duckdb data/alerts.duckdb \
  --output report.json \
  --limit 500

# Filter by caller
jq '.tokens[] | select(.caller == "whale_tracker")' report.json
```

## Querying Deduplicated Data

Use the `ohlcv_candles_deduplicated` view to query without duplicates:

```sql
-- Query deduplicated candles
SELECT 
  token_address,
  timestamp,
  interval,
  open,
  high,
  low,
  close,
  volume,
  ingested_at
FROM quantbot.ohlcv_candles_deduplicated
WHERE token_address = 'So11111111111111111111111111111111111111112'
  AND chain = 'solana'
  AND interval = '5m'
  AND timestamp >= '2024-01-01'
ORDER BY timestamp ASC;
```

## Programmatic Usage

### TypeScript (via OhlcvRepository)

```typescript
import { getStorageEngine } from '@quantbot/storage';
import { DateTime } from 'luxon';

const storage = getStorageEngine();

// Store candles with ingestion metadata
await storage.storeCandles(
  'So11111111111111111111111111111111111111112',
  'solana',
  candles,
  '5m',
  {
    ingestionRunId: 'run-2024-01-17-001',
    ingestionTimestamp: DateTime.utc()
  }
);
```

### Python (via ClickHouse client)

```python
from clickhouse_driver import Client
from datetime import datetime

client = Client(host='localhost', database='quantbot')

# Insert candles with ingestion metadata
candles = [
    {
        'token_address': 'So11111111111111111111111111111111111111112',
        'chain': 'solana',
        'timestamp': '2024-01-17 14:00:00',
        'interval': '5m',
        'open': 100.0,
        'high': 105.0,
        'low': 99.0,
        'close': 103.0,
        'volume': 1000000.0,
        'ingested_at': datetime.utcnow(),
        'ingestion_run_id': 'run-2024-01-17-001'
    }
]

client.execute(
    'INSERT INTO quantbot.ohlcv_candles VALUES',
    candles
)
```

## Troubleshooting

### Issue: Migration says columns already exist

**Solution:** Migration is idempotent - this is normal if you've run it before.

### Issue: Deduplication doesn't seem to work

**Solution:** ClickHouse DELETE is asynchronous. Wait a few minutes and check again:

```sql
-- Check mutation status
SELECT * FROM system.mutations
WHERE table = 'ohlcv_candles'
ORDER BY create_time DESC;
```

### Issue: Report generation is slow

**Solution:** Reduce the `--limit` parameter:

```bash
python tools/storage/generate_candle_ingestion_report.py \
  --duckdb data/alerts.duckdb \
  --limit 50  # Instead of 100 or 500
```

## Next Steps

- Read the full guide: [docs/guides/candle-deduplication.md](./candle-deduplication.md)
- Set up scheduled deduplication jobs
- Monitor ingestion runs to prevent future duplicates
- Use `ingestion_run_id` to track ingestion batches

## Help

```bash
# Get help for any command
quantbot storage analyze-duplicates --help
quantbot storage deduplicate --help

# Python scripts
python tools/storage/migrate_add_ingestion_metadata.py --help
python tools/storage/generate_candle_ingestion_report.py --help
```

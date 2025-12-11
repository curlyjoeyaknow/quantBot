# Golden Path Workflows

## Overview

The Golden Path provides three main workflows for analytics and backtesting:

1. **Telegram Export Ingestion** - Parse Telegram chat exports and extract calls
2. **OHLCV Data Collection** - Fetch and store candle data for calls
3. **Strategy Simulation** - Run backtests on historical calls

## Quick Start

### Prerequisites

1. **PostgreSQL** - Running and accessible
2. **ClickHouse** - Running and accessible (optional, for OHLCV storage)
3. **Birdeye API Key** - For fetching OHLCV data
4. **Environment Variables** - Configured in `.env`

### Setup

```bash
# Install dependencies
pnpm install

# Configure environment variables
cp env.example .env
# Edit .env with your database credentials and API keys

# Run database migrations (if needed)
# See docs/SCHEMA.md for schema setup
```

## Workflow 1: Telegram Export Ingestion

### CLI Method

```bash
pnpm ingest:telegram \
  --file data/raw/messages/brook7/messages.html \
  --caller-name Brook \
  --chain SOL
```

### API Method

```bash
curl -X POST http://localhost:3000/api/golden-path/ingest/telegram \
  -H "Content-Type: application/json" \
  -d '{
    "filePath": "data/raw/messages/brook7/messages.html",
    "callerName": "Brook",
    "chain": "SOL"
  }'
```

### What It Does

1. Parses Telegram HTML export file
2. Extracts Solana addresses (full, case-preserved)
3. Creates/updates callers, tokens, alerts, and calls in Postgres
4. Idempotent - can be run multiple times safely

### Expected Output

```json
{
  "success": true,
  "result": {
    "alertsInserted": 10,
    "callsInserted": 15,
    "tokensUpserted": 5,
    "skippedMessages": 2,
    "skippedCalls": 0
  }
}
```

## Workflow 2: OHLCV Data Collection

### CLI Method

```bash
pnpm ingest:ohlcv \
  --from 2024-01-01 \
  --to 2024-02-01 \
  --pre-window-minutes 260 \
  --post-window-minutes 1440 \
  --interval 5m
```

### API Method

```bash
curl -X POST http://localhost:3000/api/golden-path/ingest/ohlcv \
  -H "Content-Type: application/json" \
  -d '{
    "from": "2024-01-01T00:00:00Z",
    "to": "2024-02-01T00:00:00Z",
    "preWindowMinutes": 260,
    "postWindowMinutes": 1440,
    "interval": "5m"
  }'
```

### What It Does

1. Queries calls from Postgres in the specified date range
2. Groups calls by token
3. Checks ClickHouse for existing candles
4. Fetches missing candles from Birdeye API
5. Stores candles in ClickHouse

### Expected Output

```json
{
  "success": true,
  "result": {
    "tokensProcessed": 50,
    "candlesInserted": 12500,
    "skippedTokens": 5
  }
}
```

## Workflow 3: Strategy Simulation

### CLI Method

```bash
pnpm simulate:calls \
  --strategy PT2_SL25_TS10@1.3 \
  --caller Brook \
  --from 2024-01-01 \
  --to 2024-02-01
```

### API Method

```bash
curl -X POST http://localhost:3000/api/golden-path/simulate \
  -H "Content-Type: application/json" \
  -d '{
    "strategyName": "PT2_SL25_TS10@1.3",
    "callerName": "Brook",
    "from": "2024-01-01T00:00:00Z",
    "to": "2024-02-01T00:00:00Z"
  }'
```

### What It Does

1. Loads strategy configuration from Postgres
2. Queries calls matching selection criteria
3. Loads OHLCV candles from ClickHouse
4. Runs pure simulation engine on each call
5. Writes events and aggregates to ClickHouse
6. Writes summary to Postgres

### Expected Output

```json
{
  "success": true,
  "result": {
    "runId": 123,
    "finalPnl": 1500.50,
    "maxDrawdown": -0.15,
    "winRate": 0.65,
    "tradeCount": 100,
    "tokenCount": 50
  }
}
```

## Complete Workflow Example

Here's a complete example of running all three workflows:

```bash
# Step 1: Ingest Telegram export
pnpm ingest:telegram \
  --file data/raw/messages/brook7/messages.html \
  --caller-name Brook

# Step 2: Fetch OHLCV for the calls
pnpm ingest:ohlcv \
  --from 2024-01-01 \
  --to 2024-02-01

# Step 3: Run simulation
pnpm simulate:calls \
  --strategy PT2_SL25_TS10@1.3 \
  --caller Brook \
  --from 2024-01-01 \
  --to 2024-02-01
```

## Web Interface

The web interface provides UI for all three workflows:

1. **Ingestion Page** - Upload Telegram exports and trigger ingestion
2. **OHLCV Page** - Configure and trigger OHLCV fetching
3. **Simulation Page** - Configure and run simulations

Access these via:
- `/golden-path/ingest` - Ingestion interface
- `/golden-path/ohlcv` - OHLCV interface
- `/golden-path/simulate` - Simulation interface

## Troubleshooting

### Common Issues

1. **"Strategy not found"**
   - Ensure strategy exists in `strategies` table
   - Check strategy name spelling

2. **"No calls found"**
   - Verify calls exist in Postgres for the date range
   - Check caller name spelling

3. **"No candle data available"**
   - Run OHLCV ingestion first
   - Check Birdeye API key is valid
   - Verify token addresses are correct

4. **"Database connection failed"**
   - Check PostgreSQL is running
   - Verify connection credentials in `.env`

## Next Steps

- See `docs/GOLDEN_PATH.md` for architecture details
- See `docs/SCHEMA.md` for database schema
- See `docs/LOGGING.md` for logging standards


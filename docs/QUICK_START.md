# Quick Start Guide - Golden Path

Get started with the Golden Path analytics pipeline in 5 minutes.

## Prerequisites

- Node.js 18+
- PostgreSQL (running)
- ClickHouse (optional, for OHLCV storage)
- Birdeye API key

## 1. Setup

```bash
# Clone and install
git clone <repo>
cd quantBot
pnpm install

# Configure environment
cp env.example .env
# Edit .env with your credentials
```

## 2. Configure Environment

Edit `.env`:

```bash
# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=quantbot
POSTGRES_PASSWORD=your_password
POSTGRES_DATABASE=quantbot

# ClickHouse (optional)
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=
CLICKHOUSE_DATABASE=quantbot

# Birdeye API
BIRDEYE_API_KEY=your_birdeye_api_key
```

## 3. Setup Database

```bash
# Create database (if not exists)
createdb quantbot

# Run migrations (see docs/SCHEMA.md for schema)
# Or use your existing schema
```

## 4. Run Your First Workflow

### Option A: CLI

```bash
# Ingest Telegram export
pnpm ingest:telegram \
  --file data/raw/messages/brook7/messages.html \
  --caller-name Brook

# Fetch OHLCV
pnpm ingest:ohlcv --from 2024-01-01 --to 2024-02-01

# Run simulation
pnpm simulate:calls \
  --strategy PT2_SL25_TS10@1.3 \
  --caller Brook \
  --from 2024-01-01 \
  --to 2024-02-01
```

### Option B: Web Interface

1. Start web server:
```bash
cd packages/web
pnpm dev
```

2. Open browser: `http://localhost:3000/golden-path/ingest`

3. Use the UI to:
   - Upload Telegram exports
   - Trigger OHLCV fetching
   - Run simulations

### Option C: API

```bash
# Ingest Telegram
curl -X POST http://localhost:3000/api/golden-path/ingest/telegram \
  -H "Content-Type: application/json" \
  -d '{"filePath": "data/raw/messages/brook7/messages.html", "callerName": "Brook"}'

# Fetch OHLCV
curl -X POST http://localhost:3000/api/golden-path/ingest/ohlcv \
  -H "Content-Type: application/json" \
  -d '{"from": "2024-01-01T00:00:00Z", "to": "2024-02-01T00:00:00Z"}'

# Run simulation
curl -X POST http://localhost:3000/api/golden-path/simulate \
  -H "Content-Type: application/json" \
  -d '{"strategyName": "PT2_SL25_TS10@1.3", "callerName": "Brook", "from": "2024-01-01T00:00:00Z", "to": "2024-02-01T00:00:00Z"}'
```

## 5. View Results

### In Database

```sql
-- View calls
SELECT * FROM calls LIMIT 10;

-- View simulation results
SELECT * FROM simulation_results_summary ORDER BY created_at DESC LIMIT 10;
```

### In Web Interface

- Dashboard: `http://localhost:3000/dashboard`
- Simulations: `http://localhost:3000/simulations`
- Analytics: `http://localhost:3000/analytics`

## Common Commands

```bash
# List all available commands
pnpm run

# Check system health
curl http://localhost:3000/api/health

# View logs
tail -f logs/combined-*.log
```

## Next Steps

- Read `docs/WORKFLOWS.md` for detailed workflow documentation
- Read `docs/GOLDEN_PATH.md` for architecture overview
- Read `docs/SCHEMA.md` for database schema

## Getting Help

- Check logs: `logs/combined-*.log`
- Check API health: `http://localhost:3000/api/health`
- Review `docs/` directory for detailed documentation


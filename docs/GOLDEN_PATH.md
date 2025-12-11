# Golden Path: Solana Analytics & Backtesting Pipeline

## Overview

QuantBot's Golden Path is a clean, focused analytics and backtesting pipeline for Solana token trading strategies. It processes Telegram caller alerts, fetches OHLCV data, and runs simulations to evaluate strategy performance.

**Key Principle:** This repo is for analytics and simulation only. Live trading execution belongs in a separate repository.

## Architecture

```
Telegram Export (HTML)
    ↓
TelegramExportParser
    ↓
TelegramAlertIngestionService
    ↓
Postgres (callers, tokens, alerts, calls)
    ↓
OhlcvIngestionService
    ↓
Birdeye API → ClickHouse (ohlcv_candles)
    ↓
SimulationService
    ↓
StrategyEngine (pure function)
    ↓
ClickHouse (simulation_events, simulation_aggregates)
Postgres (simulation_runs, simulation_results_summary)
```

## Data Flow

### 1. Ingestion: Telegram → Postgres

**Command:**
```bash
pnpm ingest:telegram --file data/raw/messages/brook7/messages.html --caller-name Brook
```

**What it does:**
- Parses Telegram HTML export
- Extracts Solana addresses (full, case-preserved)
- Creates/updates caller record
- Upserts tokens
- Inserts alerts (idempotent on chatId+messageId)
- Inserts calls linking alerts to tokens

**Output:**
- `callers` table: Caller records
- `tokens` table: Token registry
- `alerts` table: Raw messages with addresses
- `calls` table: Normalized trading signals

### 2. Ingestion: Calls → OHLCV → ClickHouse

**Command:**
```bash
pnpm ingest:ohlcv --from 2024-01-01 --to 2024-02-01 --pre-window-minutes 260 --post-window-minutes 1440 --interval 5m
```

**What it does:**
- Selects calls in time window
- Groups by token
- Computes time range (call time ± window)
- Checks ClickHouse for existing candles
- Fetches missing ranges from Birdeye
- Inserts into ClickHouse

**Output:**
- `ohlcv_candles` table in ClickHouse

### 3. Simulation: Strategy on Calls

**Command:**
```bash
pnpm simulate:calls --strategy PT2_SL25_TS10@1.3 --caller Brook --from 2024-01-01 --to 2024-02-01
```

**What it does:**
- Loads strategy from Postgres
- Selects calls matching criteria
- Loads candles from ClickHouse
- Runs pure simulation engine
- Writes events to ClickHouse
- Writes summary to Postgres

**Output:**
- `simulation_runs` table: Run metadata
- `simulation_results_summary` table: Aggregated metrics
- `simulation_events` table in ClickHouse: Event-level traces
- `simulation_aggregates` table in ClickHouse: Per-token aggregates

## Package Structure

### `@quantbot/utils`
- Logger
- Configuration loading (env vars)
- Core domain types (Chain, TokenAddress, Caller, Alert, Call, etc.)

### `@quantbot/storage`
- **Postgres repositories:**
  - `CallersRepository`
  - `TokensRepository`
  - `AlertsRepository`
  - `CallsRepository`
  - `StrategiesRepository`
  - `SimulationRunsRepository`
  - `SimulationResultsRepository`
- **ClickHouse repositories:**
  - `OhlcvRepository`
  - `SimulationEventsRepository`

### `@quantbot/simulation`
- Pure simulation engine (no DB, no side effects)
- Strategy configuration types
- Candle, Trade, Position models

### `@quantbot/services`
- **Ingestion:**
  - `TelegramExportParser`
  - `TelegramAlertIngestionService`
  - `OhlcvIngestionService`
- **Simulation:**
  - `SimulationService` (orchestrates runs)

## CLI Commands

### Ingest Telegram Export
```bash
pnpm ingest:telegram \
  --file data/raw/messages/brook7/messages.html \
  --caller-name Brook \
  --chain SOL \
  --chat-id brook7
```

### Ingest OHLCV for Calls
```bash
pnpm ingest:ohlcv \
  --from 2024-01-01 \
  --to 2024-02-01 \
  --pre-window-minutes 260 \
  --post-window-minutes 1440 \
  --interval 5m
```

### Run Simulation
```bash
pnpm simulate:calls \
  --strategy MyStrategy \
  --caller Brook \
  --from 2024-01-01 \
  --to 2024-02-01
```

## Expected Outputs

### Telegram Ingestion
```
✅ Ingestion complete!
   Alerts inserted: 150
   Calls inserted: 180
   Tokens upserted: 45
```

### OHLCV Ingestion
```
Processed 45 tokens, inserted 12,500 candles
```

### Simulation
```
Simulation complete!
Run ID: 123
Final PnL: $1,234.56
Win Rate: 65.5%
Max Drawdown: -12.3%
```

## Troubleshooting

### "No Birdeye API keys found"
- Set `BIRDEYE_API_KEY` or `BIRDEYE_API_KEY_1` in `.env`

### "File not found" (Telegram export)
- Check file path is correct
- Ensure file is HTML format from Telegram export

### "Token not found" (OHLCV)
- Token may not exist on Birdeye
- Check token address is correct (full, case-preserved)

### ClickHouse connection errors
- Ensure ClickHouse is running: `docker-compose up -d clickhouse`
- Check `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT` in `.env`

## Critical Rules

### Mint Address Handling
- **NEVER** truncate mint addresses
- **NEVER** change case for storage/API calls
- Always preserve full 32-44 character addresses
- Use case-insensitive comparison for deduplication, but store original case

### Database Access
- All DB access goes through typed repositories
- No direct SQL in services
- Repositories are "dumb" - just SQL, no business logic

### Simulation Engine
- Pure function: same inputs → same outputs
- No DB access, no side effects
- Deterministic and testable

## Next Steps

1. Run a real Brook export through the pipeline
2. Evaluate strategy performance
3. Iterate on strategy configurations
4. Build dashboards on top of simulation results

## See Also

- `docs/SCHEMA.md` - Database schema documentation
- `legacy/README.md` - Information about old code


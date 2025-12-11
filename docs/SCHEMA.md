# Database Schema Documentation

## Postgres Schema (OLTP)

Postgres stores canonical entities and relationships.

### `callers`
Signal sources (e.g., Brook, Lsy).

```sql
id BIGSERIAL PRIMARY KEY
source TEXT NOT NULL          -- e.g., 'brook', 'lsy'
handle TEXT NOT NULL          -- e.g., 'Brook', 'Lsy♡'
display_name TEXT
attributes_json JSONB
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
UNIQUE (source, handle)
```

### `tokens`
Token registry.

```sql
id BIGSERIAL PRIMARY KEY
chain TEXT NOT NULL           -- 'SOL'
address TEXT NOT NULL         -- Full mint address (32-44 chars, case-preserved)
symbol TEXT
name TEXT
decimals INTEGER
metadata_json JSONB
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
UNIQUE (chain, address)
```

**CRITICAL:** `address` must store full mint address with exact case preserved.

### `alerts`
Raw messages from callers.

```sql
id BIGSERIAL PRIMARY KEY
token_id BIGINT REFERENCES tokens(id)
caller_id BIGINT REFERENCES callers(id)
strategy_id BIGINT REFERENCES strategies(id)
side TEXT NOT NULL            -- 'buy' | 'sell'
confidence NUMERIC(6, 4)
alert_price NUMERIC(38, 18)
alert_timestamp TIMESTAMPTZ NOT NULL
raw_payload_json JSONB        -- Includes chatId, messageId, messageText
created_at TIMESTAMPTZ
```

**Idempotency:** Enforced by `(chatId, messageId)` in `raw_payload_json`.

### `calls`
Normalized trading signals derived from alerts.

```sql
id BIGSERIAL PRIMARY KEY
alert_id BIGINT REFERENCES alerts(id)
token_id BIGINT NOT NULL REFERENCES tokens(id)
caller_id BIGINT REFERENCES callers(id)
strategy_id BIGINT REFERENCES strategies(id)
side TEXT NOT NULL            -- 'buy' | 'sell'
signal_type TEXT NOT NULL     -- 'entry' | 'exit' | 'scale_in' | 'scale_out'
signal_strength NUMERIC(6, 4)
signal_timestamp TIMESTAMPTZ NOT NULL
metadata_json JSONB
created_at TIMESTAMPTZ
```

### `strategies`
Strategy configurations.

```sql
id BIGSERIAL PRIMARY KEY
name TEXT NOT NULL
version TEXT NOT NULL DEFAULT '1'
category TEXT
description TEXT
config_json JSONB NOT NULL    -- Full strategy config
is_active BOOLEAN DEFAULT TRUE
created_at TIMESTAMPTZ
updated_at TIMESTAMPTZ
UNIQUE (name, version)
```

### `simulation_runs`
Simulation run metadata.

```sql
id BIGSERIAL PRIMARY KEY
strategy_id BIGINT REFERENCES strategies(id)
token_id BIGINT REFERENCES tokens(id)
caller_id BIGINT REFERENCES callers(id)
run_type TEXT NOT NULL        -- 'backtest', 'optimization', etc.
engine_version TEXT NOT NULL
config_hash TEXT NOT NULL
config_json JSONB NOT NULL
data_selection_json JSONB NOT NULL
status TEXT NOT NULL          -- 'pending' | 'running' | 'completed' | 'failed'
started_at TIMESTAMPTZ
completed_at TIMESTAMPTZ
error_message TEXT
created_at TIMESTAMPTZ
```

### `simulation_results_summary`
Aggregated metrics per simulation run.

```sql
simulation_run_id BIGINT PRIMARY KEY REFERENCES simulation_runs(id)
final_pnl NUMERIC(38, 18) NOT NULL
max_drawdown NUMERIC(10, 6)
volatility NUMERIC(10, 6)
sharpe_ratio NUMERIC(10, 6)
sortino_ratio NUMERIC(10, 6)
win_rate NUMERIC(6, 4)
trade_count INTEGER
avg_trade_return NUMERIC(10, 6)
median_trade_return NUMERIC(10, 6)
reentry_count INTEGER
ladder_entries_used INTEGER
ladder_exits_used INTEGER
average_holding_minutes NUMERIC(10, 2)
max_holding_minutes NUMERIC(10, 2)
metadata_json JSONB
created_at TIMESTAMPTZ
```

## ClickHouse Schema (OLAP)

ClickHouse stores high-volume time-series data.

### `ohlcv_candles`
OHLCV candle data.

```sql
token_address String          -- Full mint address, case-preserved
chain String                  -- 'SOL'
timestamp DateTime
interval String               -- '1m', '5m', '15m', '1h'
open Float64
high Float64
low Float64
close Float64
volume Float64
is_backfill UInt8 DEFAULT 0

ENGINE = MergeTree()
PARTITION BY (chain, toYYYYMM(timestamp))
ORDER BY (token_address, chain, timestamp)
```

**CRITICAL:** `token_address` must store full address with exact case.

### `simulation_events`
Event-level simulation traces.

```sql
simulation_run_id UInt64
token_address String
chain String
event_time DateTime
seq UInt32
event_type String            -- 'entry', 'stop_loss', 'target_hit', etc.
price Float64
size Float64
remaining_position Float64
pnl_so_far Float64
indicators_json String
position_state_json String
metadata_json String

ENGINE = MergeTree()
PARTITION BY (chain, toYYYYMM(event_time))
ORDER BY (simulation_run_id, seq)
```

### `simulation_aggregates`
Per-token simulation aggregates.

```sql
simulation_run_id UInt64
token_address String
chain String
final_pnl Float64
max_drawdown Float64
volatility Float64
sharpe_ratio Float64
sortino_ratio Float64
win_rate Float64
trade_count UInt32
reentry_count UInt32
ladder_entries_used UInt32
ladder_exits_used UInt32
created_at DateTime DEFAULT now()

ENGINE = MergeTree()
PARTITION BY (chain, toYYYYMM(created_at))
ORDER BY (simulation_run_id)
```

## Indexes

### Postgres
- `idx_tokens_chain_address` on `tokens(chain, address)`
- `idx_alerts_token_time` on `alerts(token_id, alert_timestamp)`
- `idx_calls_token_time` on `calls(token_id, signal_timestamp)`
- `idx_simulation_runs_strategy` on `simulation_runs(strategy_id, created_at)`
- `idx_simulation_runs_status` on `simulation_runs(status, created_at)`

### ClickHouse
- Automatic indexes via `ORDER BY` clauses
- Partitioning by month for efficient time-range queries

## Migration

Schema is defined in:
- `scripts/migration/postgres/001_init.sql`

To apply:
```bash
psql $POSTGRES_URL -f scripts/migration/postgres/001_init.sql
```

ClickHouse tables are created automatically by `initClickHouse()` in `packages/storage/src/clickhouse-client.ts`.


# Safe Join Patterns for Token A→Z Simulations

## Core Tables & Keys

### ClickHouse (OLAP - Time-Series Data)

### 1. `ohlcv_candles` (Fact Table - LARGE)
**Primary Key**: `(token_address, chain, timestamp)`  
**Partition**: `(chain, toYYYYMM(timestamp))`  
**Order By**: `(token_address, chain, timestamp)`

```sql
CREATE TABLE ohlcv_candles (
  token_address String,      -- FK to token_metadata.token_address
  chain String,              -- 'solana'|'ethereum'|'base'|'bsc'
  timestamp DateTime,        -- Candle timestamp
  interval String,           -- '1s'|'15s'|'1m'|'5m'|'1h'|'4h'|'1d'
  open Float64,
  high Float64,
  low Float64,
  close Float64,
  volume Float64
)
```

**Cardinality**: ~millions to billions of rows  
**Growth**: Continuous (time-series)

### 2. `simulation_events` (Fact Table - LARGE)
**Primary Key**: `(simulation_run_id, seq)`  
**Partition**: `(chain, toYYYYMM(event_time))`  
**Order By**: `(simulation_run_id, seq)`

```sql
CREATE TABLE simulation_events (
  simulation_run_id UInt64,  -- FK to DuckDB simulation_runs.run_id
  token_address String,      -- Denormalized for filtering
  chain String,
  event_time DateTime,
  seq UInt32,                -- Sequence within run
  event_type String,         -- 'entry'|'exit'|'stop_loss'|'reentry'
  price Float64,
  size Float64,
  remaining_position Float64,
  pnl_so_far Float64,
  indicators_json String,
  position_state_json String,
  metadata_json String
)
```

**Cardinality**: ~thousands to millions per run  
**Growth**: Per simulation run

### 3. `simulation_aggregates` (Aggregate Table - MEDIUM)
**Primary Key**: `simulation_run_id`  
**Partition**: `(chain, toYYYYMM(created_at))`  
**Order By**: `simulation_run_id`

```sql
CREATE TABLE simulation_aggregates (
  simulation_run_id UInt64,  -- FK to DuckDB simulation_runs.run_id
  token_address String,      -- Denormalized
  chain String,
  final_pnl Float64,
  max_drawdown Float64,
  volatility Float64,
  sharpe_ratio Float64,
  sortino_ratio Float64,
  win_rate Float64,
  trade_count UInt32,
  reentry_count UInt32,
  ladder_entries_used UInt32,
  ladder_exits_used UInt32,
  created_at DateTime
)
```

**Cardinality**: ~1 row per simulation run  
**Growth**: Per simulation run

### 4. `token_metadata` (Dimension Table - SMALL)
**Primary Key**: `(token_address, chain)`  
**Partition**: `chain`  
**Order By**: `(token_address, chain)`

```sql
CREATE TABLE token_metadata (
  token_address String,
  chain String,
  symbol String,
  name String,
  decimals UInt8,
  metadata_json String,
  created_at DateTime,
  updated_at DateTime
)
```

**Cardinality**: ~thousands to tens of thousands  
**Growth**: Slow (new tokens)

---

### DuckDB (OLTP - Metadata & Simulation Config)

### 5. `user_calls_d` (Fact Table - MEDIUM)
**Primary Key**: `(chat_id, message_id, run_id)`  
**Indexes**: `(mint)`, `(run_id)`

```sql
CREATE TABLE user_calls_d (
  chat_id TEXT NOT NULL,
  message_id BIGINT NOT NULL,
  call_ts_ms BIGINT,
  call_datetime TIMESTAMP,
  caller_name TEXT,
  caller_id TEXT,
  trigger_text TEXT,
  bot_reply_id_1 BIGINT,
  bot_reply_id_2 BIGINT,
  mint TEXT,                 -- FK to token_metadata.token_address (implicit)
  ticker TEXT,
  mcap_usd DOUBLE,
  price_usd DOUBLE,
  first_caller BOOLEAN,
  token_resolution_method TEXT,
  run_id TEXT NOT NULL,
  inserted_at TIMESTAMP
)
```

**Cardinality**: ~hundreds of thousands to millions  
**Growth**: Per ingestion run

### 6. `simulation_runs` (Dimension Table - SMALL)
**Primary Key**: `run_id`  
**Indexes**: `(strategy_id)`, `(mint)`, `(alert_timestamp)`, `(caller_name)`

```sql
CREATE TABLE simulation_runs (
  run_id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,      -- FK to simulation_strategies.strategy_id
  mint TEXT NOT NULL,              -- FK to token_metadata.token_address (implicit)
  alert_timestamp TIMESTAMP NOT NULL,
  start_time TIMESTAMP NOT NULL,
  end_time TIMESTAMP NOT NULL,
  initial_capital DOUBLE NOT NULL,
  final_capital DOUBLE,
  total_return_pct DOUBLE,
  max_drawdown_pct DOUBLE,
  sharpe_ratio DOUBLE,
  win_rate DOUBLE,
  total_trades INTEGER,
  caller_name TEXT,
  created_at TIMESTAMP
)
```

**Cardinality**: ~thousands to tens of thousands  
**Growth**: Per simulation run

### 7. `simulation_strategies` (Dimension Table - TINY)
**Primary Key**: `strategy_id`

```sql
CREATE TABLE simulation_strategies (
  strategy_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  entry_config JSON,
  exit_config JSON,
  reentry_config JSON,
  cost_config JSON,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

**Cardinality**: ~dozens to hundreds  
**Growth**: Very slow

### 8. `strategy_config` (Dimension Table - SMALL)
**Primary Key**: `strategy_config_id`  
**Index**: `(strategy_id)`

```sql
CREATE TABLE strategy_config (
  strategy_config_id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,      -- FK to simulation_strategies.strategy_id
  strategy_name TEXT NOT NULL,
  entry_config JSON NOT NULL,
  exit_config JSON NOT NULL,
  reentry_config JSON,
  cost_config JSON,
  stop_loss_config JSON,
  entry_signal_config JSON,
  exit_signal_config JSON,
  created_at TIMESTAMP
)
```

**Cardinality**: ~hundreds to thousands  
**Growth**: Per unique strategy config

### 9. `run_strategies_used` (Junction Table - SMALL)
**Primary Key**: `run_id`

```sql
CREATE TABLE run_strategies_used (
  run_id TEXT NOT NULL,           -- FK to simulation_runs.run_id
  strategy_config_id TEXT NOT NULL, -- FK to strategy_config.strategy_config_id
  created_at TIMESTAMP,
  PRIMARY KEY (run_id)
)
```

**Cardinality**: ~1:1 with simulation_runs  
**Growth**: Per simulation run

---

## Safe Join Patterns

### Pattern 1: Token A→Z Simulation Query (SAFE)

**Goal**: Get all simulation results for tokens A through Z, with strategy details.

```sql
-- ✅ SAFE: Start with small dimension table, filter early
WITH token_list AS (
  SELECT DISTINCT mint 
  FROM user_calls_d 
  WHERE mint BETWEEN 'A' AND 'Z'  -- Or use explicit list
    AND call_datetime >= NOW() - INTERVAL '90 days'
),
filtered_runs AS (
  SELECT 
    r.run_id,
    r.mint,
    r.alert_timestamp,
    r.total_return_pct,
    r.max_drawdown_pct,
    r.sharpe_ratio,
    r.win_rate,
    r.total_trades,
    s.name AS strategy_name,
    s.entry_config,
    s.exit_config
  FROM simulation_runs r
  INNER JOIN token_list t ON r.mint = t.mint  -- ✅ Filter early
  INNER JOIN simulation_strategies s ON r.strategy_id = s.strategy_id
  WHERE r.created_at >= NOW() - INTERVAL '90 days'
)
SELECT * FROM filtered_runs;
```

**Why Safe**: 
- Starts with small `token_list` CTE (filtered dimension)
- Joins to `simulation_runs` (small dimension) with early filter
- Never touches large fact tables until needed

---

### Pattern 2: Token A→Z with OHLCV Candles (SAFE)

**Goal**: Get candles for tokens A→Z with metadata.

```sql
-- ✅ SAFE: Filter tokens first, then join to large fact table
WITH token_list AS (
  SELECT DISTINCT mint 
  FROM user_calls_d 
  WHERE mint BETWEEN 'A' AND 'Z'
    AND call_datetime >= NOW() - INTERVAL '90 days'
),
token_addresses AS (
  SELECT DISTINCT 
    tm.token_address,
    tm.chain,
    tm.symbol,
    tm.name
  FROM token_metadata tm
  INNER JOIN token_list t ON tm.token_address = t.mint  -- ✅ Filter early
  WHERE tm.chain = 'solana'
)
SELECT 
  c.token_address,
  c.chain,
  c.timestamp,
  c.interval,
  c.open,
  c.high,
  c.low,
  c.close,
  c.volume,
  tm.symbol,
  tm.name
FROM ohlcv_candles c
INNER JOIN token_addresses tm 
  ON c.token_address = tm.token_address 
  AND c.chain = tm.chain  -- ✅ Composite key join
WHERE c.timestamp >= NOW() - INTERVAL '90 days'
  AND c.interval = '5m'
ORDER BY c.token_address, c.timestamp;
```

**Why Safe**:
- Filters tokens in CTE first (small result set)
- Joins to large `ohlcv_candles` with composite key (efficient)
- Uses partition pruning (`toYYYYMM(timestamp)`) automatically

---

### Pattern 3: Token A→Z with Simulation Events (SAFE)

**Goal**: Get all events for simulations of tokens A→Z.

```sql
-- ✅ SAFE: Filter runs first, then join to events
WITH token_list AS (
  SELECT DISTINCT mint 
  FROM user_calls_d 
  WHERE mint BETWEEN 'A' AND 'Z'
    AND call_datetime >= NOW() - INTERVAL '90 days'
),
filtered_runs AS (
  SELECT run_id, mint, alert_timestamp
  FROM simulation_runs
  WHERE mint IN (SELECT mint FROM token_list)  -- ✅ Filter early
    AND created_at >= NOW() - INTERVAL '90 days'
)
SELECT 
  e.simulation_run_id,
  e.event_time,
  e.event_type,
  e.price,
  e.size,
  e.pnl_so_far,
  r.mint,
  r.alert_timestamp
FROM simulation_events e
INNER JOIN filtered_runs r ON e.simulation_run_id = r.run_id  -- ✅ Join on filtered set
WHERE e.event_time >= NOW() - INTERVAL '90 days'
ORDER BY e.simulation_run_id, e.seq;
```

**Why Safe**:
- Filters runs first (small dimension)
- Joins to events with filtered run_ids (efficient)
- Uses partition pruning on `event_time`

---

## ❌ DANGEROUS Patterns (Million-Row Explosion)

### Pattern 4: Cartesian Product from Label Table (DANGEROUS)

```sql
-- ❌ DANGEROUS: Joining large fact table to label table without filtering
SELECT 
  c.*,
  tm.symbol,  -- Label table
  tm.name      -- Label table
FROM ohlcv_candles c
CROSS JOIN token_metadata tm  -- ❌ CROSS JOIN = explosion!
WHERE c.chain = 'solana';
```

**Problem**: If `ohlcv_candles` has 1M rows and `token_metadata` has 10K tokens, this creates 10B rows.

**Fix**: Always use INNER JOIN with composite key:

```sql
-- ✅ SAFE: Composite key join
SELECT 
  c.*,
  tm.symbol,
  tm.name
FROM ohlcv_candles c
INNER JOIN token_metadata tm 
  ON c.token_address = tm.token_address 
  AND c.chain = tm.chain  -- ✅ Composite key prevents explosion
WHERE c.chain = 'solana'
  AND c.timestamp >= NOW() - INTERVAL '7 days';  -- ✅ Filter early
```

---

### Pattern 5: Multiple Label Joins Without Filtering (DANGEROUS)

```sql
-- ❌ DANGEROUS: Multiple dimension tables without early filtering
SELECT 
  e.*,
  r.mint,
  r.strategy_id,
  s.name AS strategy_name,
  sc.entry_config,
  sc.exit_config
FROM simulation_events e
INNER JOIN simulation_runs r ON e.simulation_run_id = r.run_id
INNER JOIN simulation_strategies s ON r.strategy_id = s.strategy_id
INNER JOIN run_strategies_used rsu ON r.run_id = rsu.run_id
INNER JOIN strategy_config sc ON rsu.strategy_config_id = sc.strategy_config_id
WHERE e.event_time >= NOW() - INTERVAL '90 days';  -- ❌ Filter too late
```

**Problem**: Joins all events to all runs to all strategies before filtering.

**Fix**: Filter runs first, then join:

```sql
-- ✅ SAFE: Filter runs first, then join to events
WITH filtered_runs AS (
  SELECT 
    r.run_id,
    r.mint,
    r.strategy_id,
    s.name AS strategy_name,
    sc.entry_config,
    sc.exit_config
  FROM simulation_runs r
  INNER JOIN simulation_strategies s ON r.strategy_id = s.strategy_id
  INNER JOIN run_strategies_used rsu ON r.run_id = rsu.run_id
  INNER JOIN strategy_config sc ON rsu.strategy_config_id = sc.strategy_config_id
  WHERE r.created_at >= NOW() - INTERVAL '90 days'  -- ✅ Filter early
    AND r.mint BETWEEN 'A' AND 'Z'  -- ✅ Filter tokens early
)
SELECT 
  e.*,
  r.mint,
  r.strategy_name,
  r.entry_config,
  r.exit_config
FROM simulation_events e
INNER JOIN filtered_runs r ON e.simulation_run_id = r.run_id  -- ✅ Join filtered set
WHERE e.event_time >= NOW() - INTERVAL '90 days';
```

---

## Slice Export Patterns

### Pattern 6: Export Token A→Z Simulation Results (SAFE)

```sql
-- ✅ SAFE: Export aggregated results (not raw events)
SELECT 
  r.run_id,
  r.mint,
  r.alert_timestamp,
  r.total_return_pct,
  r.max_drawdown_pct,
  r.sharpe_ratio,
  r.win_rate,
  r.total_trades,
  s.name AS strategy_name,
  tm.symbol,
  tm.name AS token_name
FROM simulation_runs r
INNER JOIN simulation_strategies s ON r.strategy_id = s.strategy_id
LEFT JOIN token_metadata tm 
  ON r.mint = tm.token_address 
  AND tm.chain = 'solana'  -- ✅ LEFT JOIN with composite key
WHERE r.mint BETWEEN 'A' AND 'Z'
  AND r.created_at >= NOW() - INTERVAL '90 days'
ORDER BY r.mint, r.alert_timestamp;
```

**Why Safe**: 
- Only joins small dimension tables
- Uses LEFT JOIN for optional metadata (no explosion)
- Filters early on `mint` range

---

### Pattern 7: Export Token A→Z OHLCV Slice (SAFE)

```sql
-- ✅ SAFE: Export time-sliced candles
SELECT 
  c.token_address,
  c.timestamp,
  c.open,
  c.high,
  c.low,
  c.close,
  c.volume,
  tm.symbol,
  tm.name
FROM ohlcv_candles c
INNER JOIN token_metadata tm 
  ON c.token_address = tm.token_address 
  AND c.chain = tm.chain
WHERE c.token_address BETWEEN 'A' AND 'Z'  -- ✅ Filter tokens early
  AND c.chain = 'solana'
  AND c.interval = '5m'
  AND c.timestamp >= NOW() - INTERVAL '30 days'  -- ✅ Filter time early
ORDER BY c.token_address, c.timestamp;
```

**Why Safe**:
- Filters on token range and time range early
- Uses composite key join
- Partition pruning on `toYYYYMM(timestamp)` helps

---

## Key Principles

1. **Filter Early**: Always filter dimension tables before joining to fact tables
2. **Use Composite Keys**: Join on `(token_address, chain)` not just `token_address`
3. **Avoid CROSS JOINs**: Never use CROSS JOIN with large tables
4. **Partition Pruning**: Filter on partition keys (`timestamp`, `chain`) early
5. **CTE Strategy**: Use CTEs to build filtered dimension sets first
6. **Denormalize When Needed**: `simulation_events` has `token_address` denormalized for filtering
7. **Index Usage**: Ensure joins use indexed columns (`mint`, `run_id`, `strategy_id`)

---

## Token A→Z Simulation Query Template

```sql
-- Template for safe token A→Z queries
WITH 
  -- Step 1: Filter tokens (small dimension)
  token_list AS (
    SELECT DISTINCT mint 
    FROM user_calls_d 
    WHERE mint BETWEEN 'A' AND 'Z'
      AND call_datetime >= @start_date
      AND call_datetime <= @end_date
  ),
  
  -- Step 2: Filter runs (small dimension)
  filtered_runs AS (
    SELECT 
      r.run_id,
      r.mint,
      r.alert_timestamp,
      r.total_return_pct,
      r.max_drawdown_pct,
      r.sharpe_ratio,
      r.win_rate,
      r.total_trades,
      s.name AS strategy_name
    FROM simulation_runs r
    INNER JOIN token_list t ON r.mint = t.mint
    INNER JOIN simulation_strategies s ON r.strategy_id = s.strategy_id
    WHERE r.created_at >= @start_date
  ),
  
  -- Step 3: Join to fact tables (only if needed)
  results AS (
    SELECT 
      r.*,
      COALESCE(a.final_pnl, r.final_capital - r.initial_capital) AS final_pnl,
      COALESCE(a.trade_count, r.total_trades) AS trade_count
    FROM filtered_runs r
    LEFT JOIN simulation_aggregates a ON r.run_id = a.simulation_run_id
  )
  
SELECT * FROM results
ORDER BY r.mint, r.alert_timestamp;
```

This pattern ensures:
- ✅ No cartesian products
- ✅ Efficient partition pruning
- ✅ Index usage
- ✅ Predictable query performance



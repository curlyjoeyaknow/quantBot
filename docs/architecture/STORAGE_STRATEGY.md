# Storage Strategy: ClickHouse, DuckDB, and Materialized Views

> **Core Principle**: ClickHouse is the always-on data refinery. DuckDB is the portable lab bench.

Last updated: 2025-01-24

---

## Table of Contents

1. [The Core Distinction](#the-core-distinction)
2. [When to Use Which](#when-to-use-which)
3. [Materialized Views](#materialized-views)
4. [Simulation Results Strategy](#simulation-results-strategy)
5. [Parquet Export Patterns](#parquet-export-patterns)
6. [Join Best Practices](#join-best-practices)
7. [Practical Workflow Template](#practical-workflow-template)
8. [Decision Trees](#decision-trees)

---

## The Core Distinction

### ClickHouse = The Always-On Data Refinery

**Characteristics:**
- Lives as a server (always running)
- Built to ingest continuously
- Answers "give me aggregates over billions of rows" fast
- Great for: dashboards, live monitoring, scanning huge history, multi-user workloads

**Use ClickHouse when:**
- You're continuously ingesting (streaming events, trades, candles, fills)
- You need sub-second response on big scans/aggregations
- Many queries/users/processes hit it
- You want materialized views, TTL, partitions, data skipping indexes
- You're doing "give me the last N days of X over all tokens" frequently

### DuckDB = The Portable Lab Bench

**Characteristics:**
- Lives inside your process (CLI/Python/Node), no server required
- Built to analyze files (Parquet/CSV) and do complex joins/window functions locally
- Great for: exploration, feature engineering, backtests on a slice, ad-hoc research, CI tests

**Use DuckDB when:**
- You have a bounded dataset (a run, a token set, a week, a strategy batch)
- You want to do messy joins and feature engineering without hammering prod
- You want reproducible research artifacts (a folder of Parquet + a script = the whole experiment)
- You're iterating fast (local laptop, CI pipeline)
- You want to join your market data with "small dimension tables" (token metadata, labels, cohorts) with minimal ops

### The Pattern

```
ClickHouse stores the canonical firehose + heavy aggregates
    ↓
DuckDB runs experiments on extracted Parquet slices
```

**Not because DuckDB is "better," but because:**
- DuckDB is a killer analysis runtime for file-based slices
- ClickHouse is a killer serving/ingestion runtime

---

## When to Use Which

### ClickHouse Use Cases

✅ **Use ClickHouse when:**

1. **Continuous ingestion**
   - Streaming events, trades, candles, fills
   - Real-time data pipeline
   - High-volume writes

2. **Fast aggregates on big data**
   - "Give me volume per token per minute over last 30 days"
   - "Show me top 100 tokens by volume in last hour"
   - Sub-second response on billions of rows

3. **Multi-user/production workloads**
   - Dashboards serving many users
   - Alerting systems
   - API endpoints

4. **Materialized views needed**
   - Pre-computed aggregates
   - Rolling counters
   - Time-based partitions

5. **Production queries**
   - Stable, repeated questions
   - Low-latency requirements
   - Infrastructure facts

### DuckDB Use Cases

✅ **Use DuckDB when:**

1. **Bounded datasets**
   - A specific simulation run
   - A token cohort
   - A time window (e.g., "Dec 1-7")

2. **Research and exploration**
   - Feature engineering experiments
   - "What if we..." questions
   - Rapid iteration

3. **Reproducible artifacts**
   - Parquet files + scripts = complete experiment
   - Version-controlled research
   - Shareable analysis

4. **Complex joins without production impact**
   - Join market data with metadata
   - Feature engineering with dimension tables
   - Local analysis without hitting prod DB

5. **CI/testing**
   - Fast, isolated test runs
   - No server dependencies
   - Deterministic results

---

## Materialized Views

### What Are Materialized Views?

**Materialized views (MVs) are pre-computed aggregates that update automatically as data arrives.**

Instead of recomputing expensive queries every time, you pay the cost once at ingest, then queries become trivial.

**Think of it as:** "Pre-chewed food for your queries."

### When Materialized Views Are Easier

✅ **Use materialized views when:**

1. **You keep asking the same expensive question**
   - Just with different filters or time windows
   - The raw data keeps growing
   - Example: "Give me volume per token per minute"

2. **The aggregation logic is stable**
   - Minute bars, daily stats, rolling counters
   - Not "let's try 12 feature variants"

3. **Data is continuously arriving**
   - Trades, events, metrics
   - Real-time ingestion

4. **You need low-latency answers**
   - Alerting systems
   - Live dashboards
   - Filters for downstream systems

5. **You don't want to manage exports/jobs**
   - No cron jobs
   - No "did we export this slice?"
   - No Parquet lifecycle headaches

### The "Should This Be an MV?" Test

**If you hear yourself saying:**
- "We always group by time + token"
- "Every query starts with the same WHERE + GROUP BY"
- "This powers alerts or real-time views"
- "Latency matters"
- "The logic hasn't changed in weeks"

→ **Materialized view**

**If instead you say:**
- "I want to try 6 different features"
- "Let's re-label cohorts"
- "What if we bucket time differently?"
- "This is exploratory"
- "I'll rerun this a bunch"

→ **Export slice → DuckDB**

### Concrete Example: Trade Aggregates

**Problem:** You have a huge `trades_raw` table and keep asking:
- "Give me volume per token per minute"
- "Give me VWAP per token per minute"
- "Show me token momentum over the last N minutes"
- "Which tokens crossed X volume in 5m"

**Without MV (pain):**
```sql
-- Every query does this:
SELECT 
  token_id,
  toStartOfMinute(timestamp) as minute_ts,
  SUM(volume) as volume,
  SUM(volume * price) / SUM(volume) as vwap
FROM trades_raw
WHERE timestamp >= now() - INTERVAL 1 DAY
GROUP BY token_id, minute_ts
-- Scans millions/billions of rows every time
```

**With MV (clean):**
```sql
-- Create materialized view
CREATE MATERIALIZED VIEW trades_1m_mv
ENGINE = SummingMergeTree()
PARTITION BY toYYYYMM(minute_ts)
ORDER BY (token_id, minute_ts)
AS SELECT
  token_id,
  toStartOfMinute(timestamp) as minute_ts,
  COUNT(*) as trade_count,
  SUM(volume) as volume,
  SUM(buy_volume) as buy_volume,
  SUM(sell_volume) as sell_volume,
  SUM(volume * price) / SUM(volume) as vwap
FROM trades_raw
GROUP BY token_id, minute_ts;

-- Now queries are instant:
SELECT * FROM trades_1m_mv
WHERE minute_ts >= now() - INTERVAL 1 DAY
  AND token_id = '...'
-- Orders of magnitude smaller, already grouped
```

### QuantBot MV Recommendations

**Almost certainly want MVs for:**

1. **Trade → time aggregates**
   - `trades_1s`, `trades_1m`, `trades_5m`
   - Per-token rolling volume counters
   - Per-token activity flags (alive/dead/hot)

2. **OHLCV → derived metrics**
   - Token momentum indicators
   - Volume spikes
   - Price change aggregations

3. **Simulation summaries**
   - PnL per run/token
   - Win rate aggregations
   - Strategy performance comparisons

**Use DuckDB for:**
- Feature engineering
- Cohort analysis
- Strategy research
- Simulation inputs
- "What if we..." questions

### One-Sentence Rule

> **If the answer should be the same tomorrow given the same data → materialized view.**
> 
> **If the question itself is still evolving → DuckDB.**

This rule alone eliminates 80% of confusion.

### Where People Misuse Materialized Views

❌ **Bad MV use cases:**
- Experimental features
- Rapidly changing logic
- Joins to unstable dimension tables
- "Let's materialize everything"

**Why:** MVs are harder to change than DuckDB scripts. They lock in assumptions.

**That's why you:**
- Use MVs for infrastructure facts
- Use DuckDB for thinking

---

## Simulation Results Strategy

### The Core Distinction

**Simulation results come in two different species, and they belong in different places.**

### 1. Raw Simulation Outputs → NOT Materialized View

**These are:**
- Per-trade fills
- Per-step state transitions
- Intermediate indicators
- Per-position lifecycle events
- Debug metrics, path-dependent values

**Characteristics:**
- Large
- Noisy
- Tightly coupled to simulation logic
- Frequently re-run
- Frequently invalidated

**Storage:**
- ✅ Parquet (or DuckDB tables backed by Parquet)
- ✅ Partitioned by `run_id`, `strategy_id`, `token_id`, `date`
- ✅ Treated as artifacts, not infrastructure

**Why:**
- You will rerun sims
- Logic will change
- You'll want to diff runs
- You don't want ClickHouse polluted with ephemeral junk

**Think of these as:** Lab notebooks, not dashboards.

### 2. Derived/Canonical Simulation Summaries → YES, Materialized View

**These are:**
- PnL per run/token
- Win rate
- Max drawdown
- Time-in-market
- Sharpe-like metrics
- Exposure stats
- "Strategy X on cohort Y"

**Characteristics:**
- Stable
- Small
- Queried constantly
- Used for comparison, ranking, dashboards, investor docs

**Storage:**
- ✅ ClickHouse (often behind a materialized view)
- ✅ Fast comparisons
- ✅ Slice by date/strategy/cohort
- ✅ Logic is stable once defined
- ✅ Latency matters

**Think of these as:** Facts about a run, not the run itself.

### The Decision Rule

**Ask this question for any simulation output:**

> **"Would I be upset if this disappeared and I had to re-run the simulation?"**

- **If yes** → Store it durably (Parquet, versioned)
- **If no** → Don't over-engineer storage

**Then ask:**

> **"Do I expect to query this the same way every time?"**

- **If yes** → Materialized view
- **If no** → DuckDB / ad-hoc

### Concrete QuantBot Example

**During simulation (research phase):**

```typescript
// Run simulation
run_id = "abc123"
strategy = "momentum_v4"
tokens = ["A", "B", "C", ..., "Z"]

// Produce raw outputs (Parquet)
fills.parquet          // Per-trade fills
positions.parquet      // Position state over time
equity_curve.parquet   // Equity curve
indicators.parquet     // Technical indicators
```

**All of this:**
- Lives outside ClickHouse
- Is reproducible
- Is cheap to recompute
- Is joined, poked, sliced in DuckDB
- You might run this 20 times

**After simulation (promotion phase):**

```sql
-- Ingest only summaries into ClickHouse
INSERT INTO simulation_runs (
  run_id, strategy_id, start_ts, end_ts, 
  capital, params_hash
) VALUES (...);

INSERT INTO simulation_results_raw (
  run_id, token_id, pnl, max_dd, trades, win_rate
) VALUES (...);

-- Then add materialized views
CREATE MATERIALIZED VIEW simulation_results_by_strategy
ENGINE = SummingMergeTree()
ORDER BY (strategy_id, date)
AS SELECT
  strategy_id,
  toDate(created_at) as date,
  COUNT(*) as run_count,
  AVG(pnl) as avg_pnl,
  AVG(win_rate) as avg_win_rate,
  ...
FROM simulation_results_raw
GROUP BY strategy_id, date;
```

**Now:**
- Dashboards are instant
- Comparisons are trivial
- Investor tables are consistent
- Nothing depends on fragile raw state

### Why MVs Help Here Specifically

Simulation results are often queried like:
- "Show top strategies last month"
- "Compare capital scales"
- "Rank by drawdown-adjusted return"
- "Group by cohort"

Those are repeated, stable questions. You don't want to recompute those from raw fills every time. That's textbook MV territory.

### The Anti-Pattern to Avoid

❌ **Materialized views over:**
- Per-step simulation state
- Per-trade fill logs
- Anything tied to evolving sim logic

**Why:** That locks you into yesterday's assumptions and makes refactors painful.

### One Sentence to Remember

> **Raw simulation data is evidence. Aggregated simulation metrics are facts.**
>
> **Evidence → Parquet + DuckDB**
>
> **Facts → ClickHouse + materialized views**

This separation will keep QuantBot sane as it grows instead of calcifying.

---

## Parquet Export Patterns

### When to Export to Parquet

✅ **Export to Parquet when:**

1. **You want a "slice" you can freeze**
   - Example: "All SOL tokens minted between Dec 1–7 plus their first 24h trades"
   - That slice becomes a stable input to backtests
   - Can be versioned

2. **You want to move computation closer to the analyst**
   - DuckDB can query Parquet directly
   - Don't need to ship your whole ClickHouse DB around
   - Local analysis without network latency

3. **You want to avoid repeatedly scanning huge tables**
   - Do one heavy ClickHouse query to extract the relevant slice
   - Then iterate locally in DuckDB 50 times
   - Much cheaper than 50 ClickHouse queries

4. **You want cheap joins against external data**
   - Parquet plays nicely with "data lake" patterns
   - Join a Parquet export with a CSV of labels
   - Join with a JSON of cohorts

❌ **Don't export to Parquet when:**

1. **You only need a quick dashboard aggregate once**
   - Just query ClickHouse directly

2. **The slice changes every minute**
   - You'd just be exporting constantly
   - Then you're reinventing ClickHouse badly

3. **You can answer it with a ClickHouse materialized view faster**
   - MVs are pre-computed, Parquet exports require work

### What "A Slice" Actually Means

**A slice is not "the whole database." It's a bounded subset defined by stable filters.**

✅ **Good slice definitions:**

- **By time:** Last 7 days, or a fixed historical window
- **By entity set:** Token IDs in cohort A, or "top 10k by volume"
- **By lifecycle window:** First 30 minutes after mint, first 24 hours after bonding
- **By experiment:** "Tokens touched by strategy run_id=XYZ"

❌ **Bad slice definitions:**

- "One Parquet file per token forever" (millions of files, metadata hell)
- "Export everything weekly" (you're duplicating the database)

### Best Practice: Partitioned Parquet

**Export partitioned Parquet by something like:**

```
exports/
  dt=2024-12-01/
    chain=sol/
      symbol_bucket=A-F/
        data.parquet
      symbol_bucket=G-M/
        data.parquet
      ...
  dt=2024-12-02/
    ...
```

**Keep file counts sane:**
- Think hundreds to low thousands, not millions
- Use partitioning to organize, not fragment

---

## Join Best Practices

### Purpose: Why Join?

**You join when one table has facts, and the other has context.**

- **Fact table (big):** Trades, candles, fills, events
  - Rows = "things that happened"
- **Dimension table (small):** Token metadata, creator labels, tags, exchange listings
  - Rows = "what this thing is"

**So you join to answer questions like:**
- "What's the PnL distribution by creator cohort?"
- "How does performance differ by token category?"
- "Filter to tokens where creator_success_rate > 0.2"

### Goal: What a Join Should Achieve

**A join should ideally be many-to-one:**
- Many fact rows map to one dimension row
- Example: `trades.token_id → tokens.token_id`
- That keeps row counts stable

### Method: How Joins Go Wrong

**The scary join is many-to-many, because it explodes row counts:**

❌ **Examples:**
- `trades JOIN tags` where a token has many tags → each trade duplicates per tag
- `trades JOIN "all time intervals"` → duplicates per interval

**That's when costs go nuclear and results get subtly wrong.**

### Join Rules That Save Your Sanity

#### 1. Know the Join Cardinality Before You Join

- **many-to-one** = usually safe
- **one-to-many** = safe if intentional
- **many-to-many** = treat as hazardous material

#### 2. Join on Stable, Unique Keys

✅ **Prefer:**
- `token_id`, `mint`, `tx_signature`
- `(token_id, ts)` with clear semantics

❌ **Avoid:**
- Fuzzy keys (names, symbols) unless you enjoy pain

#### 3. Pre-Aggregate Before Joining When the Fact Table is Huge

**Instead of:**
```sql
-- BAD: Join then aggregate
SELECT 
  t.category,
  SUM(trades.volume) as total_volume
FROM trades
JOIN tokens t ON trades.token_id = t.token_id
GROUP BY t.category
-- Scans all trades, then joins, then aggregates
```

**Do:**
```sql
-- GOOD: Aggregate then join
WITH aggregated_trades AS (
  SELECT 
    token_id,
    SUM(volume) as total_volume
  FROM trades
  GROUP BY token_id
)
SELECT 
  t.category,
  SUM(a.total_volume) as total_volume
FROM aggregated_trades a
JOIN tokens t ON a.token_id = t.token_id
GROUP BY t.category
-- Much smaller intermediate result
```

#### 4. Filter Early

**Apply time ranges and token subsets before the join whenever possible.**

```sql
-- GOOD: Filter first
SELECT ...
FROM trades
WHERE timestamp >= '2024-01-01'
  AND token_id IN (SELECT token_id FROM cohort_a)
JOIN tokens t ON trades.token_id = t.token_id
-- Join operates on filtered set

-- BAD: Join then filter
SELECT ...
FROM trades
JOIN tokens t ON trades.token_id = t.token_id
WHERE timestamp >= '2024-01-01'
  AND t.category = 'meme'
-- Join operates on full tables
```

#### 5. If You See Row Counts Grow Unexpectedly, Stop

**Do a quick sanity query:**

```sql
-- Before join
SELECT COUNT(*) FROM trades;  -- 1,000,000

-- After join
SELECT COUNT(*) 
FROM trades 
JOIN tags ON trades.token_id = tags.token_id;  -- 5,000,000?!
```

**If it changes and you didn't intend it, you've got a cardinality bug.**

---

## Practical Workflow Template

### ClickHouse → Parquet → DuckDB Loop

**This is the "boring but powerful" loop:**

#### 1. In ClickHouse: Maintain Canonical Raw + Basic Aggregates

```sql
-- Raw data
CREATE TABLE trades_raw (...);
CREATE TABLE ohlcv_candles (...);

-- Basic aggregates (materialized views)
CREATE MATERIALIZED VIEW trades_1m_mv (...);
CREATE MATERIALIZED VIEW ohlcv_1h_mv (...);
```

#### 2. Extract a Slice to Parquet for a Specific Research Goal

```python
# Export cohort of tokens + bounded time window + necessary columns only
query = """
SELECT 
  token_id,
  timestamp,
  price,
  volume
FROM trades_raw
WHERE token_id IN (SELECT token_id FROM cohort_a)
  AND timestamp >= '2024-12-01'
  AND timestamp < '2024-12-08'
"""

# Export to Parquet
clickhouse_client.query_to_parquet(query, 'exports/cohort_a_dec1-7.parquet')
```

#### 3. In DuckDB: Iterate on Joins, Features, Labels, Windows

```python
import duckdb

con = duckdb.connect()
con.execute("INSTALL parquet; LOAD parquet;")

# Load slice
con.execute("CREATE TABLE trades AS SELECT * FROM 'exports/cohort_a_dec1-7.parquet'")

# Join with metadata
con.execute("""
  CREATE TABLE enriched_trades AS
  SELECT 
    t.*,
    m.category,
    m.creator_cohort,
    m.labels
  FROM trades t
  JOIN token_metadata m ON t.token_id = m.token_id
""")

# Compute features
con.execute("""
  CREATE TABLE features AS
  SELECT 
    token_id,
    AVG(volume) as avg_volume,
    STDDEV(price) as price_volatility,
    ...
  FROM enriched_trades
  GROUP BY token_id
""")

# Run backtests
# ...

# Export results back (CSV/Parquet)
con.execute("COPY features TO 'results/cohort_a_features.parquet' (FORMAT PARQUET)")
```

#### 4. Back into ClickHouse: Store Final "Research Outputs"

```sql
-- Strategy results per token/run
INSERT INTO simulation_results_raw (
  run_id, token_id, pnl, max_dd, ...
) SELECT ... FROM 'results/cohort_a_features.parquet';

-- Summary tables for dashboards
CREATE MATERIALIZED VIEW strategy_performance_by_cohort
AS SELECT ...;
```

**This keeps:**
- ClickHouse lean and production-y
- Experimentation cheap and reproducible

---

## Decision Trees

### Storage Decision Tree

```
Need live ingestion + fast aggregates at scale?
├─ YES → ClickHouse
│   └─ Query pattern stable and repeated?
│       ├─ YES → Materialized view
│       └─ NO → Ad-hoc query
│
└─ NO → DuckDB
    └─ Bounded dataset + local analysis?
        ├─ YES → DuckDB (maybe with Parquet)
        └─ NO → Re-evaluate requirements
```

### Simulation Results Decision Tree

```
Is this raw simulation output?
├─ YES → Parquet/DuckDB
│   └─ Would you be upset if it disappeared?
│       ├─ YES → Store durably (Parquet, versioned)
│       └─ NO → Don't over-engineer
│
└─ NO → Is this a derived/canonical summary?
    ├─ YES → ClickHouse
    │   └─ Query pattern stable?
    │       ├─ YES → Materialized view
    │       └─ NO → Ad-hoc query
    │
    └─ NO → Re-evaluate what you're storing
```

### Materialized View Decision Tree

```
Do you keep asking the same expensive question?
├─ NO → Don't create MV
│
└─ YES → Is the aggregation logic stable?
    ├─ NO → Don't create MV (use DuckDB)
    │
    └─ YES → Is data continuously arriving?
        ├─ NO → Consider one-time export instead
        │
        └─ YES → Do you need low-latency answers?
            ├─ NO → Consider batch job instead
            │
            └─ YES → Create materialized view
```

### Parquet Export Decision Tree

```
Do you need a stable, versioned slice?
├─ YES → Export to Parquet
│
└─ NO → Will you iterate on this data locally?
    ├─ YES → Export to Parquet
    │
    └─ NO → Can you answer with a ClickHouse query?
        ├─ YES → Query ClickHouse directly
        │
        └─ NO → Re-evaluate your question
```

---

## Related Documentation

- [DuckDB Schema](./DUCKDB_SCHEMA.md) - Complete DuckDB schema documentation
- [OHLCV Architecture](./OHLCV_ARCHITECTURE.md) - OHLCV data flow patterns
- [Simulation Contract](./SIMULATION_CONTRACT.md) - Simulation engine contracts
- [Storage Foundations](../packages/data-observatory/docs/STORAGE_FOUNDATIONS.md) - Snapshot and storage APIs

---

## Summary

**The simplest decision tree:**

1. **Need live ingestion + fast aggregates at scale?** → ClickHouse
2. **Need "take this dataset and do science on it" locally?** → DuckDB
3. **Need reproducible experiment inputs or to move data cheaply?** → Export to Parquet
4. **Need to add context columns from another table?** → Join
5. **Join causes rows to multiply unexpectedly?** → Cardinality problem → fix keys, pre-aggregate, or restructure

**Remember:**
- ClickHouse = infrastructure facts
- DuckDB = research and thinking
- Materialized views = stable, repeated questions
- Parquet = reproducible slices
- Raw simulation data = evidence (Parquet)
- Aggregated simulation metrics = facts (ClickHouse)

---

_This documentation is maintained alongside the codebase. Update as storage patterns evolve._


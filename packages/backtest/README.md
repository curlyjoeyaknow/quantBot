# @quantbot/backtest - Caller-Centric Backtesting Lab

Learn the optimal post-alert trade management policy (exits + stops) that maximizes captured return under explicit downside constraints, **per caller**.

## Installation & Build

### Prerequisites

- Node.js 20+ (LTS recommended)
- pnpm 8+
- DuckDB (for local storage)
- ClickHouse (for candle data - optional, can use fixtures)

### Install Dependencies

```bash
# From repo root
pnpm install
```

### Build

```bash
# Build all packages
pnpm build

# Build just @quantbot/backtest
pnpm -C packages/backtest build

# Watch mode for development
pnpm -C packages/backtest dev
```

### Run Database Migrations

```bash
# Run the backtest tables migration (default)
quantbot storage migrate-duckdb --duckdb ~/.local/state/quantbot/quantbot.duckdb

# Run all migrations
quantbot storage migrate-duckdb --duckdb ~/.local/state/quantbot/quantbot.duckdb --all

# Run a specific migration
quantbot storage migrate-duckdb --duckdb ~/.local/state/quantbot/quantbot.duckdb --migration 006_create_backtest_tables.sql
```

### Verify Installation

```bash
# Check CLI is available
quantbot --help

# Check backtest commands
quantbot backtest --help

# Run a quick path-only test (requires candle data)
quantbot backtest run \
  --strategy path-only \
  --interval 5m \
  --from 2024-01-01 \
  --to 2024-01-02
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DUCKDB_PATH` | Path to DuckDB database | `~/.local/state/quantbot/quantbot.duckdb` |
| `CLICKHOUSE_URL` | ClickHouse connection URL | `http://localhost:8123` |
| `QUANTBOT_STATE_DIR` | State directory | `~/.local/state/quantbot` |

### Run Lab UI (Optional)

```bash
# Start the web UI
pnpm -C packages/lab-ui dev

# Opens at http://localhost:3111
```

---

## Core Objective

**Two-part scoring contract:**

1. **Upside capture** - Maximize median/expected net return
2. **Downside control** - Subject to stop-out rate ≤ X, p95 drawdown ≤ Y, time-exposed ≤ Z

## Architecture Overview

```
Truth Layer (path-only)     →     Policy Layer     →     Optimization Layer
      ↓                              ↓                          ↓
backtest_call_path_metrics   backtest_policy_results    backtest_policies
```

### Three-Layer Design

| Layer | Purpose | Output Table |
|-------|---------|--------------|
| **Truth** | Raw path metrics per call (no policy) | `backtest_call_path_metrics` |
| **Policy** | Apply policies, replay candles | `backtest_policy_results` |
| **Optimize** | Grid search, score, find best policy | `backtest_policies` |

---

## Quick Start

### 1. Run Truth Layer (Path-Only)

Compute raw path metrics for all calls. No policies, just the truth about what each caller's tokens did.

```bash
# CLI
quantbot backtest run \
  --strategy path-only \
  --interval 5m \
  --from 2024-01-01 \
  --to 2024-01-31 \
  --filter "TY/ACC"  # optional caller filter

# Programmatic
import { runPathOnly } from '@quantbot/backtest';

const summary = await runPathOnly({
  runId: 'my-run-id',
  interval: '5m',
  from: DateTime.fromISO('2024-01-01'),
  to: DateTime.fromISO('2024-01-31'),
  callerFilter: 'TY/ACC',
});
```

**Output:** One row per eligible call in `backtest_call_path_metrics`:

- Hit 2x/3x/4x flags and time-to-multiples
- Drawdown (max, to-2x)
- Alert-to-activity time
- Peak multiple

### 2. View Truth Leaderboard

Aggregate path metrics by caller to see which callers are worth following.

```bash
# CLI
quantbot backtest truth-leaderboard --run-id <path-only-run-id>
```

**Output:** Per-caller aggregates:

- 2x/3x/4x hit rates
- Median time-to-2x/3x/4x
- Median/p95 drawdown
- Failure rate, slow-activity rate
- Peak multiple distribution

### 3. Run Policy Backtest

Apply a policy to a path-only run and see outcomes.

```bash
# CLI
quantbot backtest policy \
  --run-id <new-run-id> \
  --path-only-run-id <path-only-run-id> \
  --caller "TY/ACC" \
  --policy-json '{"type":"fixed-stop","stopLossBps":-500,"takeProfitBps":10000}'
```

**Policy Types:**

- `fixed-stop` - Static stop-loss and take-profit levels
- `time-stop` - Exit after max duration
- `trailing-stop` - Dynamic stop that follows price
- `ladder` - Multi-level exits at different price targets

**Output:** One row per (call, policy) in `backtest_policy_results`:

- Realized return (bps)
- Stop-out flag
- Max adverse excursion
- Time exposed
- Tail capture (post-peak profit captured)

### 4. Run Policy Optimizer

Grid search over policy parameters to find optimal policy per caller.

```bash
# CLI
quantbot backtest optimize \
  --run-id <opt-run-id> \
  --path-only-run-id <path-only-run-id> \
  --caller "TY/ACC" \
  --policy-type fixed-stop \
  --constraints-json '{"maxStopOutRate":0.25,"maxP95DrawdownBps":2000,"maxTimeExposedMs":3600000}'
```

**Scoring Function (Hard Contract):**

```
Primary:      maximize median net return
Subject to:   stop-out rate ≤ maxStopOutRate
              p95 drawdown ≤ maxP95DrawdownBps
              median time-exposed ≤ maxTimeExposedMs
Tie-breakers: better tail capture
              faster time-to-2x
              lower median drawdown
```

**Output:** Best policy stored in `backtest_policies`:

- Policy JSON
- Score
- Constraints met

---

## Database Schema

### `backtest_runs`

Run metadata and parameters (filters stored in `params_json`).

| Column | Type | Description |
|--------|------|-------------|
| run_id | TEXT | Primary key |
| strategy_id | TEXT | Optional strategy reference |
| params_json | TEXT | Run parameters including filters |
| interval | TEXT | Candle interval |
| from_iso / to_iso | TEXT | Date range |
| status | TEXT | pending, running, complete, failed |

### `backtest_call_path_metrics`

Truth layer - raw path metrics per call.

| Column | Type | Description |
|--------|------|-------------|
| run_id | TEXT | FK to runs |
| call_id | TEXT | Call identifier |
| caller_name | TEXT | Caller name |
| mint | TEXT | Token address |
| alert_ts_ms | BIGINT | Alert timestamp (ms) |
| p0 | DOUBLE | Price at t0 |
| hit_2x/3x/4x | BOOLEAN | Reached multiple |
| t_2x/3x/4x_ms | BIGINT | Time to reach multiple |
| dd_bps | DOUBLE | Max drawdown (bps) |
| dd_to_2x_bps | DOUBLE | Drawdown before 2x |
| alert_to_activity_ms | BIGINT | Time to first activity |
| peak_multiple | DOUBLE | Maximum price multiple |

### `backtest_policy_results`

Policy execution outcomes.

| Column | Type | Description |
|--------|------|-------------|
| run_id | TEXT | FK to runs |
| policy_id | TEXT | Policy identifier |
| call_id | TEXT | Call identifier |
| realized_return_bps | DOUBLE | Actual return achieved |
| stop_out | BOOLEAN | Exited due to stop |
| max_adverse_excursion_bps | DOUBLE | Worst drawdown during hold |
| time_exposed_ms | BIGINT | Time in position |
| tail_capture | DOUBLE | Post-peak profit captured |
| exit_reason | TEXT | Why position was closed |

### `backtest_policies`

Best policies per caller from optimization.

| Column | Type | Description |
|--------|------|-------------|
| policy_id | TEXT | Primary key |
| caller_name | TEXT | Caller this policy is for |
| policy_json | TEXT | Policy definition |
| score | DOUBLE | Optimization score |
| constraints_json | TEXT | Constraints used |

---

## File Structure

```
packages/backtest/
  src/
    # Orchestrators
    runBacktest.ts           # Original exit-stack backtest
    runPathOnly.ts           # Truth layer orchestrator
    runPolicyBacktest.ts     # Policy execution orchestrator

    # Policies
    policies/
      risk-policy.ts         # Policy type definitions
      policy-executor.ts     # Candle replay + policy application

    # Optimization
    optimization/
      scoring.ts             # Hard contract scoring function
      policy-optimizer.ts    # Grid search optimizer
      caller-follow-plan.ts  # Best policy per caller generator

    # Reporting
    reporting/
      backtest-results-duckdb.ts   # DuckDB persistence
      path-metrics-query.ts        # Truth leaderboard queries
      caller-truth-leaderboard.ts  # Leaderboard wrapper

    # Core
    plan.ts                  # Run planning
    coverage.ts              # Coverage calculation
    slice.ts                 # Candle loading
    engine/                  # Simulation engine
    path-metrics.ts          # Path metrics computation
    types.ts                 # All types
    index.ts                 # Exports
```

---

## UI Integration

The Lab UI (`packages/lab-ui`) provides a web interface:

| Route | Purpose |
|-------|---------|
| `/truth` | Create path-only runs, view truth leaderboard |
| `/policies` | Run policy backtests, run optimizer, lookup best policies |
| `/leaderboard` | PnL leaderboard (exit-stack runs) |
| `/runs` | All runs (all modes) |
| `/strategies` | Strategy builder |

### API Endpoints

```
POST /api/runs/path-only     - Create path-only run
POST /api/runs/policy        - Create policy backtest run
POST /api/runs/optimize      - Create optimization run
GET  /api/truth-leaderboard/:runId  - Truth leaderboard
GET  /api/policies/:caller   - Best policies for caller
```

---

## Invariants & Guardrails

1. **Truth never forgotten** - Path-only mode writes exactly 1 row per eligible call, regardless of trade execution
2. **Candle replay for policies** - Policy executor iterates through candles, not summarized metrics
3. **Realized ≤ peak** - Policy execution cannot exceed peak capture (invariant enforced)
4. **Determinism** - Same inputs → same outputs (no Date.now(), no Math.random() in handlers)
5. **Explicit constraints** - Scoring function uses hard contract, not vibes

---

## Anti-Drift Check

> If a change doesn't improve (a) truth fidelity per call, (b) caller comparability, or (c) policy optimization under explicit risk constraints — **it's not core**.

---

## Design Principles

1. **Caller-centric** - Everything is per-caller
2. **Truth first** - Path metrics before policies
3. **Explicit objectives** - Quantifiable scoring, not vibes
4. **Replay-based** - Policies operate on candles, not summaries
5. **Constraint-based** - Downside control is explicit, not implicit

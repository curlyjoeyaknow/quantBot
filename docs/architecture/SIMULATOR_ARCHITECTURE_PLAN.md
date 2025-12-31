# Simulator Architecture Plan

## Goals

1. **Preserve existing CLI/handler/command model** - No breaking changes to existing workflows
2. **Add web UI as client** - Web UI uses same application services as CLI
3. **Enforce coverage + slices as hard preflight gate** - No silent partial runs
4. **Simulator is pure** - Produces events for deterministic replay
5. **Deterministic replay** - Same inputs produce identical outputs

## Non-Goals

- ❌ No TradingView/React/Jesse "engine takeover"
- ❌ No simulator reading ClickHouse directly (must use slices)
- ❌ No silent partial runs (must be explicit with status)
- ❌ No replacement of existing CLI/handler architecture

## System Boundaries

### Modules

1. **Strategy Builder** (UI + JSON compiler)
   - Wizard-based UI for strategy creation
   - Compiles to StrategyV1 JSON
   - Validation and preview

2. **Run Orchestrator** (application service)
   - Coordinates run creation and execution
   - Manages run lifecycle
   - Persists results

3. **Coverage + Slice Planner** (application service)
   - Calculates candle requirements
   - Validates coverage availability
   - Materializes slices from ClickHouse

4. **Simulator Core** (pure domain)
   - Pure function: `simulateToken(token, candles, strategy)`
   - No I/O, no DB, no network
   - Produces events and frames for replay

5. **Storage + Adapters**
   - ClickHouse: OHLCV candles (source of truth)
   - DuckDB: Metadata (strategies, filters, runs, trades)
   - Artifact Store: Slices, replay frames, run artifacts

## Component Diagram

```text
[Web UI] ----HTTP----> [API Adapter] ----> [Run Orchestrator] ----> [Artifacts/DB]
   |                         |                    |
   |                         |                    +--> [Coverage+Slice Planner] --> [ClickHouse]
   |                         |                    |               |
   |                         |                    |               +--> [Slice Store: parquet/duckdb]
   |                         |                    |
   |                         |                    +--> [Simulator Core (pure)] <-- candles from slices
   |                         |
[CLI] --------calls--------> [CLI Adapter] -------+
```

## Data Contracts (Spec Sheets)

### Strategy JSON (v1)

**ID**: `StrategyV1`  
**Stored in**: DuckDB `strategies.json`  
**Used by**: Run planner + simulator

```json
{
  "schema_version": 1,
  "id": "strat_x",
  "name": "string",
  "entry": {
    "mode": "immediate|signal",
    "signal": {
      "type": "rsi_below|ema_cross",
      "period": 14,
      "value": 30,
      "fast": 9,
      "slow": 21,
      "direction": "bull|bear"
    },
    "delay": { "mode": "none|candles", "n": 0 }
  },
  "stops": {
    "stop_loss_pct": 12,
    "break_even_after_first_target": true
  },
  "exits": {
    "targets": [{ "size_pct": 25, "profit_pct": 10 }],
    "trailing": { "enabled": true, "trail_pct": 6, "activate_profit_pct": 12 },
    "time_exit": { "enabled": false, "max_candles_in_trade": 120 }
  },
  "execution": {
    "fill_model": "open|close",
    "fee_bps": 10,
    "slippage_bps": 30
  }
}
```

#### Validation Rules (Hard Reject)

- `targets[].size_pct` sum <= 100
- If `trailing.enabled`, `trail_pct > 0`, `activate_profit_pct >= 0`
- If `time_exit.enabled`, `max_candles_in_trade > 0`
- Must have an exit path: `targets` or `trailing` or `time_exit` or `stop_loss_pct > 0`
- `fill_model ∈ {open, close}`, `fee_bps >= 0`, `slippage_bps >= 0`

### Token Filter Preset (v1)

**ID**: `FilterV1`  
**Stored in**: DuckDB `filters.json`  
**Used by**: Universe selection

```json
{
  "schema_version": 1,
  "id": "filt_x",
  "name": "string",
  "chains": ["solana"],
  "age_minutes": { "min": 5, "max": 1440 },
  "mcap_usd": { "min": 20000, "max": 500000 }
}
```

### Run Plan (Preflight Artifact)

**ID**: `RunPlanV1`  
**Stored as**: `artifact run/<run_id>/plan.json`  
**Used by**: Coverage, slicing, simulator, UI messaging

```json
{
  "schema_version": 1,
  "run_id": "run_x",
  "interval_seconds": 60,
  "requested_range": { "from_ts": "ISO", "to_ts": "ISO" },
  "requirements": {
    "indicator_warmup_candles": 200,
    "entry_delay_candles": 3,
    "max_hold_candles": 120,
    "pre_entry_context_candles": 50,
    "total_required_candles": 373
  },
  "per_token_windows": [
    { "token": "mint", "from_ts": "ISO", "to_ts": "ISO", "required_candles": 373 }
  ]
}
```

#### Computation

- `indicator_warmup_candles` = max(periods used by indicators) (EMA slow, RSI period, etc.)
- `entry_delay_candles` = `entry.delay.n`
- `max_hold_candles` = `time_exit.max_candles_in_trade` OR configured default
- `pre_entry_context_candles` = UI/replay padding (configurable)
- Per token: from/to window expanded by warmup + delay + hold + padding

### Coverage Report (Gate Artifact)

**ID**: `CoverageReportV1`  
**Stored as**: `artifact run/<run_id>/coverage.json`

```json
{
  "schema_version": 1,
  "run_id": "run_x",
  "interval_seconds": 60,
  "eligible": ["mint1", "mint2"],
  "excluded": [
    { "token": "mint3", "reason": "too_new" },
    { "token": "mint4", "reason": "insufficient_range" },
    { "token": "mint5", "reason": "missing_interval" }
  ],
  "stats": {
    "requested": 412,
    "eligible": 312,
    "excluded": 100,
    "eligible_pct": 0.757
  }
}
```

#### Gate Policy

- If `eligible == 0` → run status `failed_preflight`
- If `eligible < requested` → run status `complete_partial_universe` (explicit)
- UI must display eligible/excluded counts

### Slice Manifest (Materialization Contract)

**ID**: `SliceManifestV1`  
**Stored as**: `artifact run/<run_id>/slices.json`

```json
{
  "schema_version": 1,
  "run_id": "run_x",
  "interval_seconds": 60,
  "format": "parquet|duckdb",
  "slices": [
    {
      "slice_id": "slice_001",
      "path": "artifacts/run_x/slices/slice_001.parquet",
      "tokens": ["mint1","mint2"],
      "from_ts": "ISO",
      "to_ts": "ISO",
      "candle_count_est": 123456
    }
  ]
}
```

#### Rules

- Simulator reads only from slices referenced here
- Slices must be immutable per run for reproducibility

### Replay Frames (v1)

**ID**: `ReplayFrameV1`  
**Stored as**: `artifact run/<run_id>/replay/<token>.ndjson` or DuckDB blob  
**Used by**: replay UI (SSE/chunk fetch)

```json
{
  "seq": 123,
  "candle": { "ts": "ISO", "o": 1, "h": 1, "l": 1, "c": 1, "v": 1 },
  "events": [{ "ts": "ISO", "type": "ENTRY_FILLED", "data": {} }],
  "position": {
    "is_open": true,
    "size_pct": 75,
    "avg_price": 1.23,
    "stop_price": 1.11,
    "unrealized_pnl_pct": 6.1
  }
}
```

## Execution Flow (Sequence Spec)

### Run Creation

1. `CreateRun(strategy_id, filter_id, from_ts, to_ts, interval)`
2. `RunPlanner.plan()` → `RunPlanV1`
3. `Coverage.check(plan)` → `CoverageReportV1`
4. If `eligible == 0` → fail
5. `Slice.materialize(plan, eligible)` → `SliceManifestV1`
6. `Simulator.run(strategy, slices)` → trades + frames
7. Persist:
   - `runs.summary_json`
   - `run_trades`
   - replay artifacts
8. Status: `complete` or `complete_partial_universe`

## Application Services (Interfaces)

### Run Orchestrator

```typescript
interface RunOrchestrator {
  createRun(params: CreateRunParams): Promise<string>; // returns run_id
  executeRun(runId: string): Promise<RunStatus>;
  getRun(runId: string): Promise<RunSummary>;
  listTrades(runId: string, filters?: TradeFilters): Promise<Page<Trade>>;
}
```

### Coverage + Slice Planner

```typescript
interface CoverageSlicePlanner {
  planRequirements(strategy: StrategyV1, interval: string): Requirements;
  buildTokenWindows(
    universe: Token[],
    requestedRange: DateRange,
    requirements: Requirements
  ): TokenWindow[];
  coverageCheck(windows: TokenWindow[]): Promise<CoverageReportV1>;
  materializeSlices(
    windows: TokenWindow[],
    eligible: string[]
  ): Promise<SliceManifestV1>;
}
```

### Simulator Core (Pure)

```typescript
interface SimulatorCore {
  simulateToken(
    token: string,
    candles: Candle[],
    strategy: StrategyV1
  ): SimulationResult;
}

// Must not access env/fs/db/network
```

## Storage Spec

### DuckDB Tables (Minimum)

```sql
-- Strategies
CREATE TABLE strategies (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  json TEXT NOT NULL, -- StrategyV1 JSON
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Filters
CREATE TABLE filters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  json TEXT NOT NULL, -- FilterV1 JSON
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Runs
CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  strategy_id TEXT NOT NULL,
  filter_id TEXT NOT NULL,
  status TEXT NOT NULL, -- pending|running|complete|complete_partial_universe|failed_preflight|failed
  summary_json TEXT, -- Run summary JSON
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  finished_at TIMESTAMP
);

-- Run Trades
CREATE TABLE run_trades (
  run_id TEXT NOT NULL,
  token TEXT NOT NULL,
  trade_id TEXT NOT NULL,
  entry_ts TIMESTAMP NOT NULL,
  exit_ts TIMESTAMP NOT NULL,
  entry_price REAL NOT NULL,
  exit_price REAL NOT NULL,
  pnl_pct REAL NOT NULL,
  exit_reason TEXT NOT NULL,
  PRIMARY KEY (run_id, trade_id)
);

-- Optional: Replay Index
CREATE TABLE run_replay_index (
  run_id TEXT NOT NULL,
  token TEXT NOT NULL,
  path TEXT NOT NULL,
  frame_count INTEGER NOT NULL,
  PRIMARY KEY (run_id, token)
);
```

### ClickHouse (Source of Truth)

```sql
-- OHLCV Candles
CREATE TABLE ohlcv_candles (
  token_address String,
  interval_seconds UInt32,
  timestamp DateTime,
  open Float64,
  high Float64,
  low Float64,
  close Float64,
  volume Float64,
  chain String,
  -- ... other fields
) ENGINE = MergeTree()
ORDER BY (token_address, interval_seconds, timestamp);
```

### Artifact Store (Filesystem/S3-like)

```text
artifacts/
  run/
    <run_id>/
      plan.json              # RunPlanV1
      coverage.json           # CoverageReportV1
      slices.json             # SliceManifestV1
      slices/
        slice_001.parquet
        slice_002.parquet
      replay/
        <token>.ndjson        # ReplayFrameV1[] (one per token)
```

## UI Spec Sheet (Strategy Builder)

### Wizard Steps (v1)

1. **Entry**
   - Mode: Immediate | Signal
   - Signal type (if signal): RSI Below | EMA Cross
   - Delay: None | N candles

2. **Risk** (stop mandatory)
   - Stop loss percentage
   - Break-even after first target (optional)

3. **Profit Taking** (targets + optional trailing)
   - Targets: Add rows (size %, profit %)
   - Trailing stop: Enable, trail %, activate at profit %

4. **Time Exit** (optional)
   - Max candles in trade

5. **Execution** (fill + fees)
   - Fill model: Open | Close
   - Fee (bps)
   - Slippage (bps)

### Advanced Parameters

- Toggle per block to reveal extra fields
- "Preview JSON" read-only by default; optional editable override

### Output

- Always produces valid `StrategyV1`

## Replay API Spec

### Chunk Fetch

```http
GET /api/replay/frames?run_id=...&token=...&from_seq=0&limit=500
```

Returns:

```json
```json
{
  "frames": [ReplayFrameV1, ...],
  "next_seq": 500,
  "done": false
}
```

### SSE Playback

```http
GET /api/replay/stream?run_id=...&token=...&speed=5
```

Sends event: `frame` with `ReplayFrameV1`

## Required Acceptance Tests (Minimum)

### Coverage Gate

- ✅ If any token lacks required candles → excluded with reason
- ✅ If eligible 0 → run fails preflight

### Slice Determinism

- ✅ Same `run_id` inputs produce identical slice manifest (or content hash)

### Golden Intrabar Precedence

- ✅ Stop vs target same candle follows spec ordering (conservative_long: L before H)

### Replay Determinism

- ✅ Replay frames from artifacts exactly match sim output

## Implementation Status

### ✅ Completed

- Pure simulator core (`simulateToken`)
- Strategy validation (Zod schemas)
- Run planning service (`planRun`)
- Coverage preflight service (`coveragePreflight`)
- Slice materialization service (`materializeSlices`)
- Workflow integration (`runSimulation`)
- Strategy builder wizard (Phase 1)
- Unit tests, golden tests, integration tests

### 🚧 In Progress

- Parquet/Arrow slice format (currently JSON)
- Replay API endpoints
- Web UI integration

### 📋 Planned

- Block-based advanced mode for strategy builder
- Strategy templates/presets
- Parameter sweeps
- Slice caching across runs

## Related Documentation

- [Pure Simulator Engine Guide](../guides/pure-simulator-engine.md)
- [Strategy Builder Wizard Guide](../guides/strategy-builder-wizard.md)
- [Simulation Workflow Guide](../guides/simulation-workflow.md)
- [Simulator Engine Architecture](./SIMULATOR_ENGINE_ARCHITECTURE.md)

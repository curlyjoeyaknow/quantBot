# Lab vs Research vs Simulation - Complete Comparison

## Quick Summary

| Feature | **Lab** | **Research** | **Simulation** |
|---------|---------|--------------|----------------|
| **Purpose** | Quick exit strategy testing | Full experiment lifecycle | Lower-level simulation ops |
| **Entry** | Immediate (with lag) | Signal-based or immediate | Signal-based or immediate |
| **Exit** | Overlay-based (simple rules) | Full strategy (signals + overlays) | Full strategy (signals + overlays) |
| **Re-entry** | ❌ No | ✅ Yes | ✅ Yes |
| **Entry Signals** | ❌ No | ✅ Yes (RSI, MACD, etc.) | ✅ Yes (RSI, MACD, etc.) |
| **Exit Signals** | ❌ No | ✅ Yes | ✅ Yes |
| **Trailing Stops** | ✅ Yes (as overlay) | ✅ Yes | ✅ Yes |
| **Execution Models** | ❌ No | ✅ Yes | ❌ No |
| **Cost Models** | ❌ No | ✅ Yes | ❌ No |
| **Risk Models** | ❌ No | ✅ Yes | ❌ No |
| **Snapshots** | ❌ No | ✅ Yes | ❌ No |
| **Replayability** | ❌ No | ✅ Yes (manifest replay) | ❌ No |
| **Experiment Tracking** | ❌ No | ✅ Yes | ⚠️ Basic |
| **Data Source** | DuckDB (queries calls) | Snapshots or DuckDB | DuckDB (direct) |
| **Complexity** | Low | High | Medium |

---

## Detailed Comparison

### 1. **Lab** - Overlay Backtesting

**What it is**: Quick exit strategy experimentation

**Capabilities**:

- ✅ **Entry lag**: `--lag-ms` (default: 10s)
- ✅ **Entry timing**: `--entry-rule` (next_candle_open, next_candle_close, call_time_close)
- ✅ **Exit overlays**: take_profit, stop_loss, trailing_stop, time_exit, combo
- ✅ **Trailing stops**: Via `trailing_stop` overlay
- ❌ **Re-entry**: Not supported (by design)
- ❌ **Entry signals**: Not supported (immediate entry only)
- ❌ **Exit signals**: Not supported (overlay-based only)
- ❌ **Execution models**: Not supported
- ❌ **Cost models**: Not supported (uses simple fee/slippage params)
- ❌ **Risk models**: Not supported
- ❌ **Snapshots**: Not supported
- ❌ **Replayability**: Not supported

**Use when**: You want to quickly test "what if I entered immediately and used different exit strategies?"

**Example**:

```bash
quantbot lab run \
  --overlays '[
    {"kind":"take_profit","takePct":100},
    {"kind":"trailing_stop","trailPct":10}
  ]' \
  --lag-ms 30000 \
  --caller Brook
```

---

### 2. **Research** - Full Experiment Lifecycle

**What it is**: Complete experiment management with reproducibility

**Capabilities**:

- ✅ **Entry lag**: Configurable in request
- ✅ **Entry timing**: Configurable
- ✅ **Entry signals**: ✅ Full support (RSI, MACD, etc.)
- ✅ **Exit signals**: ✅ Full support (RSI, MACD, etc.)
- ✅ **Exit overlays**: ✅ Full support (take_profit, stop_loss, etc.)
- ✅ **Trailing stops**: ✅ Full support (via stop loss config or overlays)
- ✅ **Re-entry**: ✅ Full support (trailing re-entry after profit targets)
- ✅ **Execution models**: ✅ Realistic latency, slippage, failures
- ✅ **Cost models**: ✅ Base fees, priority fees, trading fees
- ✅ **Risk models**: ✅ Drawdown limits, position limits, loss limits
- ✅ **Snapshots**: ✅ Reproducible data snapshots
- ✅ **Replayability**: ✅ Manifest-based replay
- ✅ **Experiment tracking**: ✅ Full lifecycle tracking
- ✅ **Batch/Sweep**: ✅ Batch runs and parameter sweeps
- ✅ **Leaderboard**: ✅ Rank experiments by metrics

**Use when**: You need full experiment tracking, reproducibility, and complex strategies

**Example**:

```bash
# 1. Create snapshot
quantbot research create-snapshot \
  --from 2024-01-01T00:00:00Z \
  --to 2024-01-31T23:59:59Z \
  --caller alpha-caller

# 2. Create models
quantbot research create-execution-model --latency-samples "100,200,300"
quantbot research create-cost-model --base-fee 5000
quantbot research create-risk-model --max-drawdown-percent 20

# 3. Run experiment (with full strategy config in request.json)
quantbot research run --request-file request.json

# 4. Replay
quantbot research replay-manifest --manifest artifacts/run_abc123/manifest.json
```

**Request file includes**:

- Snapshot reference
- Strategy config (entry signals, exit signals, profit targets, stop loss, re-entry)
- Execution model
- Cost model
- Risk model

---

### 3. **Simulation** - Lower-Level Operations

**What it is**: Direct simulation operations without experiment tracking

**Capabilities**:

- ✅ **Entry lag**: Configurable
- ✅ **Entry timing**: Configurable
- ✅ **Entry signals**: ✅ Full support (RSI, MACD, etc.)
- ✅ **Exit signals**: ✅ Full support (RSI, MACD, etc.)
- ✅ **Exit overlays**: ✅ Full support (via strategy config)
- ✅ **Trailing stops**: ✅ Full support
- ✅ **Re-entry**: ✅ Full support
- ❌ **Execution models**: Not supported (uses simple cost multipliers)
- ❌ **Cost models**: Not supported (uses simple fee/slippage params)
- ❌ **Risk models**: Not supported
- ❌ **Snapshots**: Not supported
- ❌ **Replayability**: Not supported
- ⚠️ **Experiment tracking**: Basic (stores runs in DuckDB, but no manifest/replay)

**Use when**: You need full strategy simulation but don't need experiment tracking

**Example**:

```bash
# Run simulation with strategy
quantbot simulation run \
  --strategy PT2_SL25 \
  --caller Brook \
  --from 2024-01-01T00:00:00Z \
  --to 2024-01-31T23:59:59Z

# Or run with DuckDB Python engine
quantbot simulation run-duckdb \
  --duckdb data/tele.duckdb \
  --strategy '{"entry": {...}, "exit": {...}}' \
  --batch
```

---

## Feature Matrix

| Feature | Lab | Research | Simulation |
|---------|-----|----------|------------|
| **Entry Strategies** |
| Immediate entry | ✅ | ✅ | ✅ |
| Entry lag | ✅ | ✅ | ✅ |
| Entry signals (RSI, MACD) | ❌ | ✅ | ✅ |
| Trailing entry | ❌ | ✅ | ✅ |
| Initial drop entry | ❌ | ✅ | ✅ |
| **Exit Strategies** |
| Take profit | ✅ (overlay) | ✅ | ✅ |
| Stop loss | ✅ (overlay) | ✅ | ✅ |
| Trailing stop | ✅ (overlay) | ✅ | ✅ |
| Exit signals (RSI, MACD) | ❌ | ✅ | ✅ |
| Time exit | ✅ (overlay) | ✅ | ✅ |
| **Advanced Features** |
| Re-entry | ❌ | ✅ | ✅ |
| Execution models | ❌ | ✅ | ❌ |
| Cost models | ❌ | ✅ | ❌ |
| Risk models | ❌ | ✅ | ❌ |
| **Data & Reproducibility** |
| Data snapshots | ❌ | ✅ | ❌ |
| Manifest replay | ❌ | ✅ | ❌ |
| Experiment tracking | ❌ | ✅ | ⚠️ Basic |
| Leaderboard | ❌ | ✅ | ❌ |
| **Data Source** |
| DuckDB queries | ✅ | ✅ | ✅ |
| Snapshots | ❌ | ✅ | ❌ |
| JSON files | ❌ | ✅ | ❌ |

---

## When to Use Which

### Use **Lab** when

- ✅ You want to quickly test exit strategies
- ✅ You don't need entry signals
- ✅ You don't need re-entry
- ✅ You want immediate results without setup
- ✅ You're experimenting with "what exit strategy works best?"

**Example use case**: "I have 1000 calls. Which exit strategy (2x, 3x, 5x, or trailing stop) performs best?"

---

### Use **Research** when

- ✅ You need full experiment tracking and reproducibility
- ✅ You want to test entry signals (RSI oversold, MACD cross, etc.)
- ✅ You need re-entry logic
- ✅ You want execution models (realistic latency/slippage)
- ✅ You want cost models (priority fees, etc.)
- ✅ You want risk models (drawdown limits, etc.)
- ✅ You need to replay experiments
- ✅ You want to compare experiments in a leaderboard

**Example use case**: "I want to test a complete strategy with RSI entry signals, profit targets, stop loss, and re-entry, with realistic execution models, and track it as a reproducible experiment."

---

### Use **Simulation** when

- ✅ You need full strategy simulation (entry/exit signals, re-entry)
- ✅ You don't need experiment tracking
- ✅ You're working directly with DuckDB
- ✅ You want to store strategies/runs manually
- ✅ You're building custom workflows

**Example use case**: "I want to run a full simulation with entry/exit signals and re-entry, but I'll handle tracking myself."

---

## Workflow Comparison

### Lab Workflow (Simple)

```
Query DuckDB → Convert to CallSignal → Overlay Backtesting → Results
```

**Time**: Seconds to minutes  
**Setup**: Minimal (just overlays)  
**Output**: Per-overlay results with median returns

---

### Research Workflow (Complex)

```
Create Snapshot → Create Models → Build Request → Run Experiment → 
Store Results → View Leaderboard → Replay if Needed
```

**Time**: Minutes to hours  
**Setup**: Significant (snapshots, models, request files)  
**Output**: Full experiment records with manifest for replay

---

### Simulation Workflow (Medium)

```
Load Strategy → Query Calls → Fetch Candles → Run Simulation → 
Store Results (optional)
```

**Time**: Minutes  
**Setup**: Moderate (strategy config)  
**Output**: Simulation results (optionally stored in DuckDB)

---

## Code Examples

### Lab (Overlay Backtesting)

```bash
quantbot lab run \
  --overlays '[
    {"kind":"take_profit","takePct":100},
    {"kind":"trailing_stop","trailPct":10}
  ]' \
  --lag-ms 10000 \
  --caller Brook \
  --limit 100
```

**What happens**:

1. Queries 100 calls from DuckDB for caller "Brook"
2. For each call, enters 10 seconds after call time
3. Tests 2 exit strategies: 100% take profit, 10% trailing stop
4. Returns results showing which overlay performs best

---

### Research (Full Experiment)

```bash
# Step 1: Create snapshot
quantbot research create-snapshot \
  --from 2024-01-01T00:00:00Z \
  --to 2024-01-31T23:59:59Z \
  --caller alpha-caller

# Step 2: Create models
quantbot research create-execution-model \
  --latency-samples "100,200,300" \
  --failure-rate 0.01

quantbot research create-cost-model \
  --base-fee 5000 \
  --trading-fee-percent 0.01

# Step 3: Create request.json with:
# - Snapshot reference
# - Strategy: entry signals (RSI < 30), exit signals (RSI > 70), profit targets, stop loss, re-entry
# - Execution model
# - Cost model
# - Risk model

# Step 4: Run experiment
quantbot research run --request-file request.json

# Step 5: View results
quantbot research leaderboard --criteria return
```

**What happens**:

1. Creates reproducible data snapshot
2. Creates execution/cost/risk models
3. Runs full simulation with entry/exit signals, re-entry, execution models
4. Stores experiment with manifest for replay
5. Can replay exact same experiment later

---

### Simulation (Direct)

```bash
quantbot simulation run \
  --strategy PT2_SL25 \
  --caller Brook \
  --from 2024-01-01T00:00:00Z \
  --to 2024-01-31T23:59:59Z
```

**What happens**:

1. Loads strategy "PT2_SL25" from DuckDB (includes entry/exit signals, profit targets, stop loss, re-entry)
2. Queries calls from DuckDB
3. Fetches candles for each call
4. Runs full simulation with all strategy features
5. Returns results (optionally stores in DuckDB)

---

## Summary

**Lab** = Quick exit strategy testing (overlay backtesting)

- Simple, fast, focused on exit strategies
- No entry signals, no re-entry, no models

**Research** = Full experiment lifecycle

- Complete strategy testing with entry/exit signals, re-entry
- Execution models, cost models, risk models
- Snapshots, replayability, experiment tracking

**Simulation** = Lower-level simulation operations

- Full strategy simulation (entry/exit signals, re-entry)
- Direct DuckDB access
- No experiment tracking or models

**Choose based on your needs:**

- Quick exit testing? → **Lab**
- Full experiment with tracking? → **Research**
- Full simulation without tracking? → **Simulation**

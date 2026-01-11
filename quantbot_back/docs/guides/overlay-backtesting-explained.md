# Overlay Backtesting Explained

## What is Overlay Backtesting?

**Overlay backtesting** is a simplified approach to evaluating trading strategies that focuses on **exit strategies** (overlays) rather than complex entry/exit signal combinations.

### Key Concept

Instead of defining full trading strategies with entry signals, exit signals, profit targets, stop losses, and re-entry logic, overlay backtesting:

1. **Assumes immediate entry** at the call time (or with a configurable lag)
2. **Applies exit overlays** to determine when to sell
3. **Evaluates performance** of different exit strategies

Think of it as: **"If I entered immediately when this call was made, how would different exit strategies perform?"**

---

## Exit Overlays

An **overlay** is a simple exit rule that determines when to sell a position. The system supports several overlay types:

### 1. **Take Profit** (`take_profit`)

Sell when price reaches a certain percentage gain.

```json
{
  "kind": "take_profit",
  "takePct": 100  // Sell at 100% gain (2x entry price)
}
```

**Example**: Entry at $1.00 → Exit at $2.00 (100% gain)

---

### 2. **Stop Loss** (`stop_loss`)

Sell when price drops by a certain percentage.

```json
{
  "kind": "stop_loss",
  "stopPct": 20  // Sell if price drops 20% from entry
}
```

**Example**: Entry at $1.00 → Exit at $0.80 (20% loss)

---

### 3. **Trailing Stop** (`trailing_stop`)

Sell when price retraces by a percentage from the peak.

```json
{
  "kind": "trailing_stop",
  "trailPct": 10  // Sell if price drops 10% from highest point
}
```

**Example**: Entry at $1.00 → Price goes to $2.00 → Drops to $1.80 → Exit (10% retrace from $2.00)

---

### 4. **Time Exit** (`time_exit`)

Sell after holding for a specific duration.

```json
{
  "kind": "time_exit",
  "holdMs": 3600000  // Hold for 1 hour (3600 seconds × 1000ms)
}
```

**Example**: Entry at $1.00 → Hold for 1 hour → Exit at current price

---

### 5. **Combo** (`combo`)

Combine multiple overlays (first one to trigger wins).

```json
{
  "kind": "combo",
  "legs": [
    { "kind": "take_profit", "takePct": 100 },
    { "kind": "stop_loss", "stopPct": 20 }
  ]
}
```

**Example**: Exit when either 100% profit OR 20% loss is hit (whichever comes first)

---

## How Overlay Backtesting Works

### Step-by-Step Process

1. **Entry Point**:
   - Entry happens at the call time (or with configurable lag)
   - Entry price is determined by entry rule:
     - `next_candle_open`: Enter at next candle's open
     - `next_candle_close`: Enter at next candle's close
     - `call_time_close`: Enter at call time's candle close

2. **Apply Overlays**:
   - For each overlay, simulate forward through candles
   - Check if overlay conditions are met (take profit hit, stop loss hit, etc.)
   - Exit when first overlay condition triggers

3. **Calculate PnL**:
   - Gross return: `(exit_price / entry_price) - 1`
   - Fees: Applied based on taker fee and slippage
   - Net return: Gross return minus fees

4. **Compare Results**:
   - Each overlay produces a separate result
   - Compare which overlay performs best across all calls

---

## Example: Evaluating Multiple Overlays

```bash
# Evaluate calls with multiple exit strategies
quantbot calls evaluate \
  --calls-file calls.json \
  --overlays '[
    {"kind":"take_profit","takePct":50},
    {"kind":"take_profit","takePct":100},
    {"kind":"take_profit","takePct":200},
    {"kind":"stop_loss","stopPct":20},
    {"kind":"trailing_stop","trailPct":10}
  ]' \
  --lag-ms 10000 \
  --taker-fee-bps 30 \
  --slippage-bps 10
```

**What this does**:

- Takes all calls from `calls.json`
- Enters each call 10 seconds after the call time
- Tests 5 different exit strategies:
  1. Take profit at 50% gain
  2. Take profit at 100% gain (2x)
  3. Take profit at 200% gain (3x)
  4. Stop loss at 20% loss
  5. Trailing stop at 10% retrace
- Compares which exit strategy performs best

---

## Overlay Backtesting vs Full Simulation

### Overlay Backtesting (Simple)

- ✅ **Simple**: Just define exit rules
- ✅ **Fast**: No complex signal evaluation
- ✅ **Focused**: Answers "what exit strategy works best?"
- ❌ **Limited**: No entry signals, no re-entry logic
- ❌ **Assumes immediate entry**: Doesn't test entry timing

**Use when**: You want to quickly evaluate exit strategies on existing calls

### Full Simulation (Complex)

- ✅ **Complete**: Entry signals, exit signals, re-entry, profit targets
- ✅ **Realistic**: Models execution, costs, risk constraints
- ✅ **Flexible**: Can test complex strategies
- ❌ **Complex**: Requires full strategy definition
- ❌ **Slower**: More computation

**Use when**: You want to test complete trading strategies with entry/exit logic

---

## Real-World Example

### Scenario: Testing Exit Strategies for Pump.fun Calls

You have 1000 calls from a Telegram caller. You want to know:

- Should you take profit at 2x, 3x, or 5x?
- Should you use a stop loss? If so, what percentage?
- Would a trailing stop perform better?

**Solution**: Overlay backtesting

```bash
# 1. Export calls from DuckDB
quantbot calls export \
  --duckdb data/tele.duckdb \
  --from-iso 2024-01-01T00:00:00Z \
  --to-iso 2024-01-31T23:59:59Z \
  --caller-name alpha-caller \
  --out calls.json

# 2. Test multiple exit strategies
quantbot calls evaluate \
  --calls-file calls.json \
  --overlays '[
    {"kind":"take_profit","takePct":100},
    {"kind":"take_profit","takePct":200},
    {"kind":"take_profit","takePct":300},
    {"kind":"combo","legs":[
      {"kind":"take_profit","takePct":200},
      {"kind":"stop_loss","stopPct":20}
    ]},
    {"kind":"trailing_stop","trailPct":15}
  ]' \
  --lag-ms 10000 \
  --timeframe-ms 86400000 \
  --interval 5m

# 3. Results show:
# - Which overlay has highest median return
# - Win rate for each overlay
# - Best overlay per caller
```

**Output**:

- Overlay 1 (100% take profit): 45% median return, 60% win rate
- Overlay 2 (200% take profit): 120% median return, 40% win rate
- Overlay 3 (300% take profit): 180% median return, 25% win rate
- Overlay 4 (200% + 20% stop): 95% median return, 55% win rate
- Overlay 5 (15% trailing): 110% median return, 50% win rate

**Conclusion**: Overlay 2 (200% take profit) has the best risk-adjusted return.

---

## Parameter Sweeps

You can sweep across multiple parameters to find optimal combinations:

```bash
quantbot calls sweep \
  --calls-file calls.json \
  --intervals '["1m","5m","15m"]' \
  --lags-ms '[0,10000,30000,60000]' \
  --overlays-file overlays.json \
  --out results/sweep-001/
```

**What this does**:

- Tests 3 different candle intervals (1m, 5m, 15m)
- Tests 4 different entry lags (0ms, 10s, 30s, 60s)
- Tests multiple overlay sets from `overlays.json`
- Generates comprehensive results matrix

**Output files**:

- `per_call.jsonl`: One row per call × overlay × lag × interval
- `per_caller.jsonl`: Aggregated by caller
- `matrix.json`: Full parameter matrix

---

## Overlay File Format

### Single Overlay Set

```json
[
  {"kind":"take_profit","takePct":100},
  {"kind":"take_profit","takePct":200},
  {"kind":"stop_loss","stopPct":20}
]
```

### Multiple Overlay Sets

```json
[
  {
    "id": "conservative",
    "overlays": [
      {"kind":"take_profit","takePct":50},
      {"kind":"stop_loss","stopPct":10}
    ]
  },
  {
    "id": "aggressive",
    "overlays": [
      {"kind":"take_profit","takePct":300},
      {"kind":"stop_loss","stopPct":30}
    ]
  }
]
```

### Wrapped Format

```json
{
  "sets": [
    {
      "id": "set-1",
      "overlays": [
        {"kind":"take_profit","takePct":100}
      ]
    }
  ]
}
```

---

## Key Differences from Full Simulation

| Aspect | Overlay Backtesting | Full Simulation |
|--------|-------------------|-----------------|
| **Entry** | Immediate (or with lag) | Signal-based entry |
| **Exit** | Overlay-based (simple rules) | Signal-based + overlays |
| **Re-entry** | ❌ Not supported | ✅ Supported |
| **Complexity** | Low | High |
| **Speed** | Fast | Slower |
| **Use Case** | Evaluate exit strategies | Test complete strategies |
| **Configuration** | Simple JSON overlays | Full strategy config |

---

## When to Use Overlay Backtesting

✅ **Use overlay backtesting when**:

- You want to quickly test exit strategies
- You have existing calls and want to see "what if I entered immediately?"
- You're comparing different take-profit/stop-loss combinations
- You want to find optimal exit parameters

❌ **Don't use overlay backtesting when**:

- You need to test entry timing/signals
- You need re-entry logic
- You want to test complex multi-leg strategies
- You need execution models, cost models, risk constraints

**For those cases, use**: `research run` or `simulation run` (full simulation)

---

## Summary

**Overlay backtesting** = Simple exit strategy evaluation

- Enter immediately (or with lag) when call is made
- Apply exit overlays (take profit, stop loss, trailing stop, time exit)
- Compare which exit strategy performs best
- Fast, simple, focused on exit optimization

**Full simulation** = Complete strategy testing

- Entry signals, exit signals, re-entry logic
- Execution models, cost models, risk constraints
- Complete strategy lifecycle
- Complex, realistic, comprehensive

Both have their place! Use overlay backtesting for quick exit strategy evaluation, and full simulation for complete strategy testing.

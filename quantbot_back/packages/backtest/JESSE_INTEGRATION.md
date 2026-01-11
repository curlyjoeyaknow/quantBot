# Jesse Integration Plan (Post-MVB)

**Status**: Not yet. Complete MVB collapse first.

## Decision Rule

Consider Jesse integration when:

- ✅ MVB is complete and working
- ✅ You have a baseline native engine to compare against
- ✅ You need rapid strategy iteration (Python, indicators)
- ✅ You're willing to maintain a compatibility layer

**Do NOT consider Jesse when:**

- ❌ You're still collapsing architecture
- ❌ You need to fix determinism issues
- ❌ You're fighting merge debt

## Architecture: Engine Plugin Pattern

After MVB is complete, add Jesse as an optional engine:

```
packages/backtest/
  src/
    engine/
      native.ts          ← Pure TS engine (default)
      jesse-runner.ts    ← Optional Jesse bridge
      index.ts           ← Engine selector
```

## Interface Contract

### Input (from QuantBot)

- `slice_path`: Parquet file path
- `strategy_json`: Strategy configuration
- `execution_model`: Fill rules, fees, slippage

### Output (to QuantBot)

- `trades.json`: Standardized trade format
- `summary.json`: P&L, drawdown, win rate
- `replay.ndjson`: Optional candle-by-candle replay

## Minimal Spike Plan (2-3 hours, post-MVB)

1. Export one slice (single token, 1m, fixed window)
2. Write `jesse_runner.py`:

   ```python
   # Load candles from parquet
   # Run one Jesse strategy
   # Output standardized trades/summary
   ```

3. Compare outputs against native engine

## Success Criteria

- ✅ Determinism matches (same trades, timing, PnL)
- ✅ No hidden assumptions (fees, fills, signal timing)
- ✅ Not painfully slow for batch runs

## When to Fork vs Import

**Import to Jesse** (recommended):

- Use Jesse as a runner for some strategies
- QuantBot does: universe, coverage, slicing, storage, reporting
- Can drop Jesse later if it doesn't fit

**Fork Jesse** (only if all true):

- Jesse becomes primary product surface
- Willing to maintain framework long-term
- Accept breaking changes and deep internals ownership
- Current architecture becomes subordinated

**Right now: No.**

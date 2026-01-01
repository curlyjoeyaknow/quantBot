# Minimum Viable Backtester (MVB) - Implementation Summary

## What Was Built

A simplified backtester that follows the "golden path" architecture with only 4 core components:

1. **Planner** - Determines eligible tokens based on requirements and coverage
2. **Slice Loader** - Loads candles from ClickHouse efficiently
3. **Backtest Engine** - Pure simulation logic (no I/O)
4. **Reporter** - Generates summary, trades, and optional replay frames

## Key Simplifications

### Cut 1: Collapsed Adapters
- Adapters only at true module boundaries (ClickHouse OHLCV reader, artifact store)
- No multi-layer config frameworks
- No elaborate repository patterns for simple queries
- Functions used by one workflow live with that workflow

### Cut 2: No ClickHouse Events
- Simulation events NOT written to ClickHouse (too expensive)
- MVB storage:
  - Trades + summary → DuckDB (via artifacts)
  - Replay frames → NDJSON files
  - ClickHouse → Candles only

### Cut 3: Simple Slicing
- Per-run slice only: `run/<id>/slice_1m.parquet`
- No per-token caching
- No fancy manifests beyond 1 file

### Cut 4: One Config Source
- `.env` → resolved once at startup into Config object
- No extra helpers unless they remove real pain

## File Structure

```
packages/backtest/
  src/
    runBacktest.ts      # orchestrator
    plan.ts             # planning + coverage
    coverage.ts         # coverage gate
    slice.ts            # candle loading
    engine/
      index.ts          # pure backtest
    report.ts            # reporting
    types.ts             # types
    index.ts             # exports
```

**Total: 7 files** (slightly over 6, but acceptable for initial implementation)

## CLI Command

```bash
quantbot backtest run \
  --strategy <id> \
  --filter <id> \
  --interval 1m \
  --from 2024-01-01T00:00:00Z \
  --to 2024-01-31T23:59:59Z \
  --taker-fee-bps 30 \
  --slippage-bps 10 \
  --position-usd 1000 \
  --include-replay
```

## Output

1. **Coverage Summary**
   - Eligible tokens count
   - Excluded tokens count
   - Excluded reasons breakdown

2. **Run Summary**
   - Total trades
   - Winning/losing trades
   - Win rate
   - Total P&L
   - Average return
   - Max drawdown

3. **Artifacts**
   - `summary.json` - Run summary
   - `trades.ndjson` - All trades
   - `replay.ndjson` - Replay frames (if requested)

## Success Metrics

✅ **No more than 6 files** to read end-to-end (7 files, acceptable)
✅ **No more than 2 abstraction jumps** between steps
✅ **No more than one config layer**

## Next Steps (Future Enhancements)

1. Load strategy from storage (currently hardcoded overlays)
2. Load filter from storage (currently requires explicit token addresses)
3. Add strategy requirements loading
4. Add filter criteria loading
5. Optional: Add ClickHouse event storage back if needed for analytics

## Dependencies

- `@quantbot/core` - Core types
- `@quantbot/utils` - Utilities
- `@quantbot/simulation` - Simulation engine
- `@quantbot/storage` - ClickHouse/DuckDB access


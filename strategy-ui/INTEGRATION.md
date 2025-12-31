# Simulation Engine Integration Guide

## Overview

The deterministic simulation engine skeleton is now locked and integrated. The engine is event-native, replay-friendly, and follows the simulator spec in `app/services/simulator_spec.md`.

## Structure

```
strategy-ui/
├── app/
│   ├── services/
│   │   ├── simulator_spec.md      # Contract specification (locked)
│   │   ├── sim_types.py            # Event/Trade dataclasses
│   │   ├── indicators.py           # RSI, EMA implementations
│   │   ├── strategy_validate.py    # Pre-simulation validation
│   │   ├── sim_engine.py           # Core deterministic engine
│   │   └── run_execute.py          # Integration with /api/runs
│   └── tests/
│       └── test_sim_engine_golden.py  # Golden test (prevents regression)
```

## Key Features

1. **Deterministic**: Same inputs → same outputs (no randomness except UUID generation for trade IDs)
2. **Event-native**: All state changes emit events for replay
3. **Intra-candle ordering**: Conservative long path (STOP via L, then TARGETS via H)
4. **Replay frames**: Each candle produces a frame with events + position state

## Integration Points

### 1. Candle Loading ✅ COMPLETE

`load_candles_for_token()` is implemented in `app/services/run_execute.py`:
- Connects to ClickHouse using environment variables
- Converts interval_seconds to interval string format ('1m', '5m', etc.)
- Queries `ohlcv_candles` table
- Returns List[Candle] sorted by timestamp ascending

**Environment Variables Required:**
- `CLICKHOUSE_HOST` (default: localhost)
- `CLICKHOUSE_HTTP_PORT` or `CLICKHOUSE_PORT` (default: 18123)
- `CLICKHOUSE_DATABASE` (default: quantbot)
- `CLICKHOUSE_USER` (default: default)
- `CLICKHOUSE_PASSWORD` (default: empty)

### 2. Token Extraction ✅ BASIC VERSION COMPLETE

`extract_tokens_from_filter()` is implemented with basic support:
- Extracts tokens from `{"tokens": ["addr1", "addr2"]}` format
- Returns List[str] of token addresses

**TODO:** Full FilterPreset support (chain + criteria -> tokens)
- Currently only supports direct token lists
- FilterPreset format needs token resolution from chain/criteria

### 3. Run Execution ✅ ENABLED

Execution is enabled in `app/main.py`:
- Calls `execute_run()` synchronously
- Updates run status in database
- Returns final status to API caller

**Note:** Currently synchronous - can be backgrounded with threading/async later

## Testing

Run the golden test to verify the engine:

```bash
cd strategy-ui
python -m pytest app/tests/test_sim_engine_golden.py -v
```

This test verifies the critical intra-candle ordering behavior (stop triggers before target when both are possible).

## Next Steps

1. **Implement candle loading**: Connect to ClickHouse/@quantbot/ohlcv
2. **Implement token extraction**: Parse filter data to get token list
3. **Add SSE replay endpoint**: Stream frames for real-time visualization
4. **Background execution**: Move `execute_run()` to background task/queue
5. **Add more indicators**: ATR, VWAP, etc. (follow the spec)

## Contract Compliance

The engine strictly follows `simulator_spec.md`:
- Decision prices (open/close fill model)
- Fee/slippage calculation
- Entry signals (immediate, RSI, EMA cross)
- Exit mechanisms (targets, trailing, time, stop)
- Intra-candle ordering (conservative_long)
- End-of-data forced exit

Any changes to the spec should be documented and tests updated accordingly.


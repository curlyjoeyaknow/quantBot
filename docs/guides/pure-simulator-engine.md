# Pure Simulator Engine

## Overview

The pure simulator engine is a deterministic, I/O-free module that takes strategy JSON and candles as input, and produces trades, events, and replay frames as output. It has no dependencies on databases, networks, or file systems.

## Location

The pure simulator engine is located in `packages/simulation/src/engine/`:

**From repository root:**
```bash
cd /home/memez/quantBot
ls packages/simulation/src/engine/
```

Files:
- `sim_types.ts` - Type definitions (Candle, Event, Trade, ReplayFrame)
- `indicators.ts` - Technical indicators (RSI, EMA)
- `strategy_validate.ts` - Strategy JSON validation (Zod schemas)
- `sim_engine.ts` - Core `simulateToken()` function

## Core Function

```typescript
import { simulateToken, type StrategyConfig, type Candle } from '@quantbot/simulation/src/engine';

const result = simulateToken(
  token: string,
  candles: Candle[],
  strategy: StrategyConfig
): {
  summary: SimulationSummary;
  trades: Trade[];
  events: Event[];
  frames: ReplayFrame[];
}
```

## Strategy Configuration

The simulator accepts a strategy configuration in JSON format:

```typescript
{
  entry: {
    mode: 'immediate' | 'signal',
    signal?: {
      type: 'rsi_below' | 'ema_cross',
      period?: number,        // For RSI
      value?: number,          // For RSI threshold
      fast?: number,           // For EMA cross
      slow?: number,           // For EMA cross
      direction?: 'bull' | 'bear'
    },
    delay?: {
      mode: 'none' | 'candles',
      n?: number
    }
  },
  exits: {
    targets?: Array<{
      size_pct: number;    // 0-100
      profit_pct: number;  // > 0
    }>,
    trailing?: {
      enabled: boolean;
      trail_pct: number;
      activate_profit_pct: number;
    },
    time_exit?: {
      enabled: boolean;
      max_candles_in_trade: number;
    }
  },
  stops: {
    stop_loss_pct: number;  // >= 0
    break_even_after_first_target?: boolean;
  },
  execution: {
    fill_model: 'open' | 'close';
    fee_bps: number;        // >= 0
    slippage_bps: number;    // >= 0
  }
}
```

## Example Usage

**From TypeScript/Node.js code:**

```typescript
// From any package in the monorepo:
import { simulateToken } from '@quantbot/simulation/src/engine';
```

**Or from the repository root:**

```bash
cd /home/memez/quantBot
# Build first if needed:
pnpm build:ordered
```

const candles = [
  { ts: '2024-01-01T00:00:00Z', o: 1.0, h: 1.1, l: 0.9, c: 1.0, v: 1000 },
  { ts: '2024-01-01T00:05:00Z', o: 1.0, h: 1.2, l: 0.95, c: 1.1, v: 1200 },
  // ... more candles
];

const strategy = {
  entry: { mode: 'immediate' },
  exits: {
    targets: [
      { size_pct: 50, profit_pct: 5 },
      { size_pct: 50, profit_pct: 10 }
    ]
  },
  stops: { stop_loss_pct: 10 },
  execution: { fill_model: 'close', fee_bps: 10, slippage_bps: 30 }
};

const result = simulateToken('token1', candles, strategy);

console.log(result.summary);
// { token: 'token1', trades: 1, win_rate: 1.0, avg_pnl_pct: 7.5 }

console.log(result.trades);
// [{ trade_id: '...', entry_ts: '...', exit_ts: '...', pnl_pct: 7.5, ... }]

console.log(result.events);
// [{ ts: '...', type: 'ENTRY_FILLED', ... }, { ts: '...', type: 'TARGET_HIT', ... }]

console.log(result.frames);
// [{ seq: 0, candle: {...}, events: [...], position: {...} }, ...]
```

## Output Structure

### Summary

```typescript
{
  token: string;
  trades: number;
  win_rate: number;      // 0.0 to 1.0
  avg_pnl_pct: number;   // Average PnL percentage
}
```

### Trades

```typescript
{
  trade_id: string;
  token: string;
  entry_ts: string;      // ISO timestamp
  exit_ts: string;       // ISO timestamp
  entry_price: number;
  exit_price: number;
  pnl_pct: number;
  exit_reason: 'stop' | 'targets_done' | 'time_exit' | 'end_of_data';
  size_pct_initial?: number;
}
```

### Events

Events track all simulation state changes:

- `ENTRY_SIGNAL_TRUE` - Entry signal condition met
- `ENTRY_FILLED` - Position entered
- `STOP_SET` - Stop loss set
- `STOP_MOVED` - Stop loss updated (trailing/break-even)
- `STOP_HIT` - Stop loss triggered
- `TARGET_HIT` - Profit target reached
- `PARTIAL_EXIT` - Partial position exit
- `EXIT_FULL` - Complete position exit

### Replay Frames

Each frame represents the state at a single candle:

```typescript
{
  seq: number;           // Candle index
  candle: Candle;        // OHLCV data
  events: Event[];       // Events for this candle
  position: {
    is_open: boolean;
    size_pct: number;
    avg_price: number | null;
    stop_price: number | null;
    unrealized_pnl_pct: number | null;
  }
}
```

## Validation

The simulator validates strategy configuration using Zod schemas. Invalid strategies will throw errors with clear messages:

```typescript
import { validateStrategy } from '@quantbot/simulation/src/engine';

try {
  validateStrategy(strategy);
} catch (error) {
  console.error('Strategy validation failed:', error.message);
}
```

## Purity Guarantees

The simulator engine is **pure**:

- ✅ No I/O operations (no file system, no network, no database)
- ✅ Deterministic (same inputs → same outputs)
- ✅ No side effects
- ✅ JSON-serializable outputs only
- ✅ No dependencies on CLI, workflow, or storage packages

This makes it:

- **Testable** - Easy to unit test with known inputs/outputs
- **Replayable** - Results can be stored and replayed later
- **Portable** - Can be used in any context (CLI, API, tests)

## Integration

The pure simulator is integrated into the workflow layer via:

1. **Run Planning** - Calculates candle requirements
2. **Coverage Preflight** - Validates candle availability
3. **Slice Materialization** - Extracts required candles to slice files
4. **Simulation Execution** - Runs pure simulator on slices
5. **Artifact Storage** - Stores events/frames for replay

See [Simulation Workflow Guide](./simulation-workflow.md) for details.

## Python Parity

The TypeScript simulator produces identical results to the Python simulator (`strategy-ui/app/services/sim_engine.py`). Golden tests ensure parity between implementations.

# @quantbot/backtest - Minimum Viable Backtester (MVB)

The golden path implementation for backtesting. This package provides a simple, focused architecture that respects core invariants (coverage + slices + determinism) without unnecessary ceremony.

## Architecture

Only 4 moving parts:

1. **Planner** (`plan.ts`) - Requirements + coverage gate
2. **Slice Loader** (`slice.ts`) - Get candles fast
3. **Backtest Engine** (`engine/`) - Pure simulation logic
4. **Reporter** (`report.ts`) - Summary + trades + optional replay

## Golden Path Command

One command does the full vertical slice:

```bash
quantbot backtest run --strategy <id> --filter <id> --interval 1m --from 2024-01-01T00:00:00Z --to 2024-01-31T23:59:59Z
```

Success = it outputs:

- Coverage summary (eligible/excluded)
- Run summary (P&L, trades, drawdown)
- Artifacts persisted

## Usage

```typescript
import { runBacktest } from '@quantbot/backtest';
import { DateTime } from 'luxon';
import type { ExitOverlay } from '@quantbot/simulation';

const result = await runBacktest(
  {
    strategyId: 'my-strategy',
    filterId: 'my-filter',
    interval: '1m',
    from: DateTime.fromISO('2024-01-01T00:00:00Z'),
    to: DateTime.fromISO('2024-01-31T23:59:59Z'),
  },
  {
    overlays: [
      { kind: 'take_profit', takePct: 100 },
      { kind: 'stop_loss', stopPct: 20 },
    ],
    fees: {
      takerFeeBps: 30,
      slippageBps: 10,
    },
    position: {
      notionalUsd: 1000,
    },
    includeReplay: false,
  }
);
```

## Storage

- **Trades + Summary** → DuckDB (via artifacts)
- **Replay frames** → NDJSON files (per token per run)
- **ClickHouse** → Candles only (no simulation events)

## Design Principles

1. **One vertical slice module** - All golden path code in one folder
2. **No more than 6 files** to read end-to-end
3. **No more than 2 abstraction jumps** between steps
4. **One config layer** - `.env` → `Config` object

## File Structure

```
packages/backtest/
  src/
    runBacktest.ts      # orchestrator: plan -> coverage -> slice -> engine -> persist
    plan.ts             # requirements + coverage gate
    coverage.ts         # coverage calculation
    slice.ts            # fast candle loading
    engine/             # pure simulation
      index.ts
    report.ts           # summary + trades + replay
    types.ts            # core types
    index.ts            # exports
```

## Success Criteria

The golden path requires:

- ✅ No more than 6 files to read end-to-end
- ✅ No more than 2 abstraction jumps between steps
- ✅ No more than one config layer

If it exceeds these limits, it's too heavy.

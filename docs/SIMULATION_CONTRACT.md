# Simulation Contract

**Status**: 📋 ARCHITECTURE  
**Created**: 2025-01-23  
**Related**: `packages/simulation/src/types/contracts.ts`, Phase III

## Overview

The simulation contract is the **immutable interface** that defines how simulations work. It is the single source of truth for:
- What inputs are required
- What outputs are produced
- How execution models work
- How determinism is guaranteed

## Contract Schema

### SimInput

Every simulation must accept:

```typescript
{
  // Core simulation data
  run_id: string;
  strategy_id: string;
  mint: string;
  alert_timestamp: string; // ISO 8601
  candles: Candle[];
  
  // Strategy configuration
  entry_config: EntryConfig;
  exit_config: ExitConfig;
  reentry_config?: ReEntryConfig;
  cost_config?: CostConfig;
  
  // Determinism contract
  contractVersion: string;      // Default: '1.0.0'
  seed?: number;                // Random seed
  dataVersion?: string;         // Data schema version
  strategyVersion?: string;     // Strategy definition version
  
  // Execution model (no perfect fills)
  executionModel?: ExecutionModel;
  
  // Risk model
  riskModel?: RiskModel;
  
  // Data snapshot hash
  dataSnapshotHash?: string;
  
  // Clock resolution
  clockResolution: 'ms' | 's' | 'm' | 'h'; // Default: 'm'
}
```

### SimResult

Every simulation produces:

```typescript
{
  run_id: string;
  final_pnl: number;            // Multiplier (1.0 = break even)
  events: SimEvent[];           // Trade events
  entry_price: number;
  final_price: number;
  total_candles: number;
  metrics: SimMetrics;          // Performance metrics
}
```

## Execution Models

### No Perfect Fills

**Rule**: All simulations must use explicit execution models. No "perfect fills" in production.

Execution models define:
- **Latency**: How long execution takes
- **Slippage**: Price impact of trades
- **Partial Fills**: Whether trades fill completely
- **Failures**: Transaction failure probabilities
- **Fees**: Fee structures

### Available Models

- `PerfectFillModel` - For testing only (no slippage, no latency)
- `FixedSlippageModel` - Constant slippage (basis points)
- `LatencyModel` - Adds execution latency
- `PartialFillModel` - Handles partial fills
- `FailedTransactionModel` - Simulates transaction failures
- `FeeRegimeModel` - Different fee structures

## Risk Models

Risk models enforce constraints:
- **Position Limits**: Max position size, max concurrent positions
- **Drawdown Limits**: Max drawdown before stopping
- **Exposure Limits**: Max total exposure, per-asset exposure

## Determinism

Every simulation:
- Accepts a `seed` parameter
- Same `seed` + same inputs → same outputs
- Versioned inputs ensure reproducibility

## Clock Resolution

Simulations support multiple time resolutions:
- **Milliseconds** - For sniper logic
- **Seconds** - For early post-mint
- **Minutes/Hours** - For post-graduation

Same engine, different clocks.

## Validation

Use `validateSimulationContract()` to ensure inputs comply:

```typescript
import { validateSimulationContract } from '@quantbot/simulation/core/contract-validator';

const input = validateSimulationContract(rawInput);
// input is now validated SimInput
```

## Examples

### Basic Simulation

```typescript
const input: SimInput = {
  run_id: 'run-123',
  strategy_id: 'strategy-1',
  mint: 'So11111111111111111111111111111111111111112',
  alert_timestamp: '2024-01-01T00:00:00Z',
  candles: [...],
  entry_config: { initialEntry: 'immediate', trailingEntry: 'none', maxWaitTime: 60 },
  exit_config: {
    profit_targets: [{ target: 2.0, percent: 1.0 }],
    stop_loss: { initial: -0.25 },
  },
  contractVersion: '1.0.0',
  seed: 42,
};
```

### With Execution Model

```typescript
const input: SimInput = {
  // ... other fields ...
  executionModel: {
    slippage: {
      type: 'fixed',
      params: { bps: 10 }, // 0.1% slippage
    },
    latency: {
      type: 'normal',
      params: { mean: 100, stdDev: 20 }, // 100ms ± 20ms
    },
    fees: {
      takerFeeBps: 30, // 0.3% taker fee
    },
  },
};
```

## References

- `packages/simulation/src/types/contracts.ts` - Contract schemas
- `packages/simulation/src/types/execution-model.ts` - Execution model schemas
- `packages/simulation/src/types/risk-model.ts` - Risk model schemas
- `packages/simulation/src/core/contract-validator.ts` - Contract validation


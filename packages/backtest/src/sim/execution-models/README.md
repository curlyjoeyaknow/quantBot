# Execution Reality Models (Branch C)

This module provides realistic execution models for trading simulations, including latency, slippage, failures, costs, and risk management.

## Overview

Branch C delivers execution reality models that inject real-world constraints into simulations:

- **Latency Models**: Network and confirmation latency distributions (p50/p90/p99)
- **Slippage Models**: Dynamic slippage based on trade size, volume, and volatility
- **Failure Models**: Transaction failures, partial fills, and chain reorganizations
- **Cost Models**: Enhanced cost calculations including priority fees and compute units
- **Risk Framework**: Circuit breakers, anomaly detection, and exposure limits
- **Calibration Tools**: Fit models from live trading data

## Quick Start

```typescript
import {
  createPumpfunExecutionModel,
  createPumpswapExecutionModel,
  sampleTotalLatency,
  calculateEntrySlippage,
  checkCircuitBreaker,
} from '@quantbot/simulation/execution-models';

// Create an execution model
const model = createPumpfunExecutionModel();

// Sample latency
const latency = sampleTotalLatency(model.latency, 0.5); // 50% congestion

// Calculate slippage
const slippageBps = calculateEntrySlippage(
  model.slippage,
  100, // trade size
  1_000_000, // market volume 24h
  0.3 // volatility level
);

// Check circuit breaker
const state = createCircuitBreakerState();
const result = checkCircuitBreaker(
  riskFramework.circuitBreakers,
  state,
  currentPnl,
  peakPnl,
  'strategy-id',
  tradeAmount
);
```

## Execution Models

### Pre-configured Models

- `createPumpfunExecutionModel()` - Pump.fun (pre-graduation)
- `createPumpswapExecutionModel()` - PumpSwap (post-graduation)
- `createMinimalExecutionModel()` - Zero-cost model for testing

### Model Structure

An `ExecutionModel` contains:

- **latency**: Network and confirmation latency distributions
- **slippage**: Entry and exit slippage models
- **failures**: Transaction failure probability model
- **partialFills**: Partial fill probability and distribution
- **reorgs**: Chain reorganization model
- **costs**: Fee structure including priority fees

All models are JSON-serializable and can be saved/loaded as config files.

## Latency Models

Latency is modeled using percentile distributions (p50, p90, p99) with optional jitter:

```typescript
const latency = sampleLatency({
  p50: 50,   // 50ms median
  p90: 150,  // 150ms at 90th percentile
  p99: 500,  // 500ms at 99th percentile
  jitterMs: 20,
  distribution: 'percentile',
});
```

Congestion multiplies latency:

```typescript
const latency = sampleNetworkLatency(config, 0.8); // 80% congestion
```

## Slippage Models

Slippage can be:

- **Fixed**: Constant basis points
- **Linear**: Proportional to trade size
- **Sqrt**: Square root of trade size (common for AMMs)
- **Volume-based**: Based on trade size relative to market volume

```typescript
const slippageBps = calculateSlippage(
  {
    type: 'sqrt',
    sqrtCoefficient: 50,
    minBps: 10,
    maxBps: 500,
  },
  tradeSize,
  marketVolume24h,
  volatilityMultiplier
);
```

## Failure Models

Failure probability increases with:

- Base failure rate
- Congestion level
- Priority fee shortfall

```typescript
const failed = sampleFailure(
  {
    baseFailureRate: 0.02,
    congestionFailureRate: 0.05,
    feeShortfallFailureRate: 0.10,
    maxFailureRate: 0.30,
  },
  congestionLevel,
  priorityFeeShortfall
);
```

## Cost Models

Enhanced cost calculations include:

- Base trading fees (taker/maker)
- Priority fees (micro-lamports per CU)
- Compute unit costs
- Effective cost per trade (including slippage)

```typescript
const totalCost = calculateTotalTransactionCost(
  costModel,
  tradeAmount,
  isEntry,
  congestionLevel
);
```

## Risk Framework

### Circuit Breakers

Stop trading when:

- Max drawdown exceeded
- Max daily loss exceeded
- Max consecutive losses
- Max exposure per strategy/total
- Trade throttles (min interval, max per hour/day)

### Anomaly Detection

Detect unusual patterns:

- Latency spikes (>3x expected p99)
- Slippage spikes (>3x expected)
- Failure rate spikes (>3x base rate)

## Calibration

Calibrate models from live trading data:

```typescript
import { calibrateExecutionModel } from '@quantbot/simulation/execution-models';

const records: LiveTradeRecord[] = [
  {
    timestamp: '2024-01-01T00:00:00Z',
    venue: 'pumpfun',
    tradeSize: 100,
    expectedPrice: 1.0,
    actualPrice: 1.0025,
    networkLatencyMs: 45,
    confirmationLatencyMs: 420,
    failed: false,
    fillPercentage: 1.0,
  },
  // ... more records
];

const result = calibrateExecutionModel(records, 'pumpfun', 'live-trading');
// result.model contains calibrated execution model
// result.statistics contains calibration metrics
```

## Integration with Simulation Engine

Execution models are designed to be consumed by Branch A (simulation engine). The simulation engine should:

1. Accept an `ExecutionModel` as input
2. Sample latency, slippage, failures for each trade
3. Apply costs using the `CostModel`
4. Check circuit breakers and anomalies
5. Return execution metadata in results

## Example Config Files

See `examples.ts` for pre-configured models and risk frameworks.

## Testing

All models are thoroughly tested:

```bash
pnpm --filter @quantbot/simulation test execution-models
```

## Branch C Deliverables

✅ ExecutionModel and CostModel schemas (JSON-serializable)  
✅ Latency distribution models (p50/p90/p99, jitter, venue-specific)  
✅ Slippage models (dynamic, volume-based, venue-specific)  
✅ Failure models (dropped tx, reorgs, missed slots, partial fills)  
✅ Enhanced CostModel (priority fees, compute-unit costs)  
✅ Risk framework (circuit breakers, stop conditions, exposure limits)  
✅ Calibration tool (live logs → fit latency/slippage distributions)  
✅ Integration tests and example configs  

## Next Steps

1. **Branch A Integration**: Simulation engine should accept `ExecutionModel` as input
2. **Live Data Collection**: Collect live trade records for calibration
3. **Continuous Calibration**: Periodically recalibrate models from live data
4. **Model Validation**: Compare simulated vs actual execution costs


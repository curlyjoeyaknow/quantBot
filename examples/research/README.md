# Research Services Examples

This directory contains example scripts demonstrating how to use the Research Services CLI commands and programmatic API.

## Quick Start

### Code Example (TypeScript)

See `simple-example.ts` for a minimal example that doesn't require database connections:

```typescript
import { createExecutionRealityService } from '@quantbot/workflows/research/services/index.js';

const service = createExecutionRealityService();

// Create execution model
const executionModel = service.createExecutionModelFromCalibration({
  latencySamples: [100, 150, 200, 250, 300],
  slippageSamples: [
    { tradeSize: 100, expectedPrice: 100.0, actualPrice: 100.1 },
  ],
  failureRate: 0.02,
}, 'pumpfun');

// Create cost model
const costModel = service.createCostModelFromFees({
  baseFee: 5000,
  priorityFee: { base: 1000, max: 10000 },
  tradingFee: 0.01,
});

// Create risk model
const riskModel = service.createRiskModelFromConstraints({
  maxDrawdown: 0.2,
  maxLossPerDay: 1000,
  maxConsecutiveLosses: 5,
  maxPositionSize: 500,
});
```

### CLI Example

```bash
# Create an execution model
quantbot research create-execution-model \
  --latency-samples "100,150,200,250,300" \
  --failure-rate "0.02" \
  --format json

# Create a cost model
quantbot research create-cost-model \
  --base-fee "5000" \
  --trading-fee-percent "0.01" \
  --format json

# Create a risk model
quantbot research create-risk-model \
  --max-drawdown-percent "20" \
  --max-loss-per-day "1000" \
  --format json
```

## Available Examples

### 1. Create Snapshot (`create-snapshot-example.sh`)

Creates a data snapshot for a specific time range:

```bash
./examples/research/create-snapshot-example.sh
```

This will:
- Create a snapshot for January 1-2, 2024
- Save the snapshot reference to `snapshot.json`
- Display the snapshot contents

### 2. Create Execution Model (`create-execution-model-example.sh`)

Creates an execution model from calibration data:

```bash
./examples/research/create-execution-model-example.sh
```

This will:
- Create an execution model with latency samples
- Configure failure and partial fill rates
- Save the model to `execution-model.json`

### 3. Create Cost Model (`create-cost-model-example.sh`)

Creates a cost model from fee structure:

```bash
./examples/research/create-cost-model-example.sh
```

This will:
- Create a cost model with base fees and trading fees
- Configure priority fee ranges
- Save the model to `cost-model.json`

### 4. Create Risk Model (`create-risk-model-example.sh`)

Creates a risk model from constraints:

```bash
./examples/research/create-risk-model-example.sh
```

This will:
- Create a risk model with drawdown and loss limits
- Configure position size and consecutive loss limits
- Save the model to `risk-model.json`

### 5. Complete Simulation Workflow (`complete-simulation-example.sh`)

Demonstrates a complete workflow from snapshot creation to simulation:

```bash
./examples/research/complete-simulation-example.sh
```

This will:
1. Create a data snapshot
2. Create execution, cost, and risk models
3. Combine them into a simulation request
4. Show how to run the simulation

## Prerequisites

- QuantBot CLI installed and built
- `jq` installed (for JSON formatting in examples)
- Access to data sources (DuckDB with calls, OHLCV data)

## Usage

Make scripts executable:

```bash
chmod +x examples/research/*.sh
```

Run any example:

```bash
./examples/research/create-snapshot-example.sh
```

## Customization

Edit the scripts to customize:
- Time ranges for snapshots
- Calibration data for execution models
- Fee structures for cost models
- Risk constraints for risk models

## Code Examples

### Simple Example (`simple-example.ts`)

A minimal example that demonstrates creating and using execution, cost, and risk models without requiring database connections:

```bash
# Run with tsx (if available)
pnpm tsx examples/research/simple-example.ts

# Or compile and run
pnpm build
node dist/examples/research/simple-example.js
```

### Full Example (`code-example.ts`)

A complete example showing:
- Creating data snapshots (requires database)
- Creating execution/cost/risk models
- Applying models to trades
- Complete workflow integration

```bash
pnpm tsx examples/research/code-example.ts
```

## Next Steps

After creating snapshots and models, you can:

1. Use them in simulation requests (see `complete-simulation-example.sh`)
2. Run simulations: `quantbot research run --request-file simulation-request.json`
3. Analyze results: `quantbot research show --run-id <run-id>`

See the [Research Services Usage Guide](../../docs/guides/research-services-usage.md) for more details.

## Example Output

### Execution Model

```json
{
  "latency": {
    "p50": 200,
    "p95": 350,
    "p99": 400,
    "mean": 235.7,
    "stdDev": 98.2
  },
  "slippage": {
    "p50": 0.003,
    "p95": 0.005,
    "p99": 0.006
  },
  "failures": {
    "rate": 0.02,
    "retryable": 0.015,
    "permanent": 0.005
  }
}
```

### Cost Model

```json
{
  "baseFee": 5000,
  "priorityFee": {
    "base": 1000,
    "max": 10000
  },
  "tradingFee": 0.01
}
```

### Risk Model

```json
{
  "maxDrawdown": 0.2,
  "maxLossPerDay": 1000,
  "maxConsecutiveLosses": 5,
  "maxPositionSize": 500,
  "tradeThrottle": {
    "maxTradesPerMinute": 10,
    "maxTradesPerHour": 100
  }
}
```

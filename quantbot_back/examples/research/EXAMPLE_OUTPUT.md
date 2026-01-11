# Research Services - Example Output

This document shows example outputs from the research services commands and code examples.

## Execution Model Example

### Input
```typescript
const executionModel = service.createExecutionModelFromCalibration({
  latencySamples: [100, 150, 200, 250, 300, 350, 400],
  slippageSamples: [
    { tradeSize: 100, expectedPrice: 100.0, actualPrice: 100.1 },
    { tradeSize: 200, expectedPrice: 100.0, actualPrice: 100.2 },
    { tradeSize: 300, expectedPrice: 100.0, actualPrice: 100.3 },
  ],
  failureRate: 0.02,
  partialFillRate: 0.1,
}, 'pumpfun');
```

### Output
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
    "p99": 0.006,
    "mean": 0.003,
    "stdDev": 0.0014
  },
  "failures": {
    "rate": 0.02,
    "retryable": 0.015,
    "permanent": 0.005
  },
  "partialFills": {
    "rate": 0.1,
    "avgFillRatio": 0.85
  },
  "venue": "pumpfun",
  "calibratedAt": "2024-01-01T12:00:00.000Z"
}
```

## Cost Model Example

### Input
```typescript
const costModel = service.createCostModelFromFees({
  baseFee: 5000,
  priorityFee: { base: 1000, max: 10000 },
  tradingFee: 0.01,
});
```

### Output
```json
{
  "baseFee": 5000,
  "priorityFee": {
    "base": 1000,
    "max": 10000
  },
  "tradingFee": 0.01,
  "effectiveCostPerTrade": 15000
}
```

## Risk Model Example

### Input
```typescript
const riskModel = service.createRiskModelFromConstraints({
  maxDrawdown: 0.2,
  maxLossPerDay: 1000,
  maxConsecutiveLosses: 5,
  maxPositionSize: 500,
  tradeThrottle: {
    maxTradesPerMinute: 10,
    maxTradesPerHour: 100,
  },
});
```

### Output
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

## Trade Execution Example

### Applying Execution Model
```typescript
const trade = {
  size: 1000,
  price: 100.0,
  side: 'buy' as const,
};

const result = service.applyExecutionModel(
  executionModel,
  trade,
  executionModel.slippage,
  () => Math.random(),
  1000000 // marketVolume24h
);
```

### Output
```json
{
  "executed": true,
  "latency": 250,
  "slippage": 0.0035,
  "fillRatio": 1.0,
  "failed": false,
  "retryable": false
}
```

## Trade Cost Example

### Applying Cost Model
```typescript
const costResult = service.applyCostModel(costModel, {
  size: 1000,
  price: 100.0,
  side: 'buy' as const,
});
```

### Output
```json
{
  "totalCost": 15000,
  "baseFee": 5000,
  "priorityFee": 5000,
  "tradingFee": 5000
}
```

## Risk Check Example

### Checking Risk Constraints
```typescript
const riskCheck = service.checkRiskConstraints(riskModel, {
  currentDrawdown: 0.1,
  dailyLoss: 500,
  consecutiveLosses: 2,
  positionSize: 200,
  tradesThisMinute: 5,
  tradesThisHour: 50,
});
```

### Output (Allowed)
```json
{
  "allowed": true,
  "reason": null
}
```

### Output (Blocked)
```json
{
  "allowed": false,
  "reason": "Max drawdown exceeded: 0.25 > 0.2"
}
```

## Data Snapshot Example

### Creating a Snapshot
```typescript
const snapshot = await dataService.createSnapshot({
  timeRange: {
    fromISO: '2024-01-01T00:00:00Z',
    toISO: '2024-01-02T00:00:00Z',
  },
  sources: [
    { venue: 'pump.fun', chain: 'solana' },
  ],
  filters: {
    callerNames: ['example_caller'],
  },
});
```

### Output
```json
{
  "snapshotId": "snapshot-1704067200000-a1b2c3d4",
  "contentHash": "a1b2c3d4e5f6789012345678901234567890abcdef",
  "timeRange": {
    "fromISO": "2024-01-01T00:00:00.000Z",
    "toISO": "2024-01-02T00:00:00.000Z"
  },
  "sources": [
    {
      "venue": "pump.fun",
      "chain": "solana"
    }
  ],
  "filters": {
    "callerNames": ["example_caller"]
  },
  "schemaVersion": "1.0.0",
  "createdAtISO": "2024-01-01T12:00:00.000Z"
}
```

## Complete Workflow Example

### Step-by-Step Output

1. **Create Snapshot**
   ```
   ✓ Snapshot created: snapshot-1704067200000-a1b2c3d4
   ✓ Snapshot integrity: Valid
   ```

2. **Create Models**
   ```
   ✓ Execution model created (latency P50: 200ms)
   ✓ Cost model created (base fee: 5000 lamports)
   ✓ Risk model created (max drawdown: 20%)
   ```

3. **Simulate Trade**
   ```
   ✓ Trade executed (latency: 250ms, slippage: 0.35%)
   ✓ Cost: 15000 lamports
   ✓ Risk check: Allowed
   ```

4. **Results**
   ```
   ✓ Trade completed successfully
   ✓ All constraints satisfied
   ```


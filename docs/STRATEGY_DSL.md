# Strategy DSL Documentation

## Overview

The Strategy DSL (Domain-Specific Language) is a structured, JSON-serializable format for defining trading strategies. **Strategies are data, not code** - enabling automated mutation, parameter sweeps, cross-strategy comparison, and optimization.

## Key Principles

1. **Data, Not Code**: All strategies are JSON/YAML files
2. **Versioned**: DSL has a version field for compatibility tracking
3. **Structured**: Clear schema with validation
4. **Composable**: Entry, exit, re-entry conditions are separate entities
5. **Type-Safe**: Full TypeScript support with Zod validation

## DSL Structure

```typescript
{
  version: "1.0.0",        // DSL version
  id?: string,             // Optional strategy identifier
  name: string,            // Strategy name
  description?: string,    // Strategy description
  tags?: string[],         // Categorization tags
  positionSizing?: {       // Position sizing configuration
    type: "fixed" | "percent_of_capital" | "risk_based" | "kelly",
    value: number,
    maxSize?: number
  },
  entry: {                 // Entry condition (required)
    type: "immediate" | "price_drop" | "trailing_rebound" | "signal",
    // ... type-specific fields
  },
  exit: [                  // Exit conditions (array, at least one)
    {
      type: "profit_target" | "stop_loss" | "signal" | "time" | "ladder",
      // ... type-specific fields
    }
  ],
  reEntry?: {              // Re-entry conditions (optional)
    enabled: boolean,
    type?: "trailing_retrace" | "signal",
    // ... type-specific fields
  },
  risk?: {                 // Risk constraints (optional)
    maxLossPercent?: number,
    minExitPrice?: number,
    maxPositionSize?: number,
    maxLeverage?: number
  },
  costs?: {                // Cost configuration (optional)
    entrySlippageBps?: number,
    exitSlippageBps?: number,
    feePercent?: number,
    fixedFee?: number
  },
  metadata?: Record<string, unknown>  // Free-form metadata
}
```

## Entry Conditions

### Immediate Entry

Enter immediately at market price:

```json
{
  "type": "immediate"
}
```

### Price Drop Entry

Wait for price to drop by a certain percentage before entering:

```json
{
  "type": "price_drop",
  "priceDropPercent": -0.3,      // Wait for 30% drop (negative value)
  "maxWaitMinutes": 60            // Maximum wait time
}
```

### Trailing Rebound Entry

Wait for price to rebound from a low:

```json
{
  "type": "trailing_rebound",
  "reboundPercent": 0.1,          // Wait for 10% rebound from low
  "maxWaitMinutes": 1440          // Maximum wait time (24 hours)
}
```

### Signal-Based Entry

Enter based on indicator signals:

```json
{
  "type": "signal",
  "signal": {
    "logic": "AND",
    "conditions": [
      {
        "indicator": "rsi",
        "operator": "<",
        "value": 30
      },
      {
        "indicator": "macd",
        "operator": "crosses_above",
        "secondaryIndicator": "sma"
      }
    ]
  },
  "maxWaitMinutes": 1440
}
```

## Exit Conditions

Exit conditions are an array - multiple exits can be defined. Each exit can be:

### Profit Target

Exit at a specific profit level:

```json
{
  "type": "profit_target",
  "profitTarget": 2.0,            // Exit at 2x (100% profit)
  "percentToExit": 0.5            // Exit 50% of position
}
```

### Stop Loss

Exit on loss:

```json
{
  "type": "stop_loss",
  "stopLossPercent": -0.3,        // Exit at -30% (negative value)
  "trailingStopThreshold": 1.5,   // Activate trailing at 1.5x (optional)
  "trailingStopPercent": 0.25     // Trailing stop at 25% (optional)
}
```

### Time-Based Exit

Exit after a specific hold duration:

```json
{
  "type": "time",
  "holdHours": 24                 // Exit after 24 hours
}
```

### Signal-Based Exit

Exit based on indicator signals:

```json
{
  "type": "signal",
  "signal": {
    "logic": "OR",
    "conditions": [
      {
        "indicator": "rsi",
        "operator": ">",
        "value": 70
      },
      {
        "indicator": "price_change",
        "operator": "<",
        "value": -0.1
      }
    ]
  }
}
```

### Ladder Exit

Graduated exits at multiple price levels:

```json
{
  "type": "ladder",
  "ladder": {
    "legs": [
      {
        "sizePercent": 0.25,      // Exit 25% at 1.5x
        "multiple": 1.5,
        "signal": { /* optional signal condition */ }
      },
      {
        "sizePercent": 0.25,      // Exit 25% at 2.0x
        "multiple": 2.0
      },
      {
        "sizePercent": 0.5,       // Exit remaining 50% at 3.0x
        "multiple": 3.0
      }
    ],
    "sequential": false           // Can execute in parallel if false
  }
}
```

## Re-Entry Conditions

Re-entry allows adding to a position after initial exit:

### Trailing Retrace Re-Entry

Re-enter when price retraces from a peak:

```json
{
  "enabled": true,
  "type": "trailing_retrace",
  "retracePercent": 0.5,          // Re-enter at 50% retrace from peak
  "maxReEntries": 3,              // Maximum 3 re-entries
  "sizePercent": 0.5              // Re-entry size: 50% of original
}
```

### Signal-Based Re-Entry

Re-enter based on indicator signals:

```json
{
  "enabled": true,
  "type": "signal",
  "signal": {
    "logic": "AND",
    "conditions": [
      {
        "indicator": "rsi",
        "operator": "<",
        "value": 40
      }
    ]
  },
  "maxReEntries": 2,
  "sizePercent": 0.5
}
```

## Position Sizing

Define how much capital to allocate per trade:

### Fixed Amount

```json
{
  "type": "fixed",
  "value": 1000,                  // Always use $1000
  "maxSize": 5000                 // Optional cap
}
```

### Percent of Capital

```json
{
  "type": "percent_of_capital",
  "value": 0.1,                   // Use 10% of available capital
  "maxSize": 2000                 // Optional cap
}
```

### Risk-Based

```json
{
  "type": "risk_based",
  "value": 0.02,                  // Risk 2% of capital per trade
  "maxSize": 1000                 // Optional cap
}
```

## Risk Constraints

Additional risk limits beyond stop loss:

```json
{
  "maxLossPercent": -0.2,         // Never allow more than -20% loss
  "minExitPrice": 0.5,            // Never sell below 50% of entry price
  "maxPositionSize": 5000,        // Maximum position size
  "maxLeverage": 3                // Maximum leverage (if applicable)
}
```

## Cost Configuration

Transaction costs and slippage:

```json
{
  "entrySlippageBps": 50,         // 0.5% slippage on entry
  "exitSlippageBps": 30,          // 0.3% slippage on exit
  "feePercent": 0.001,            // 0.1% transaction fee
  "fixedFee": 0.5                 // $0.50 fixed fee per transaction
}
```

## Signal Conditions

Signal conditions use indicators and comparison operators:

### Available Indicators

- `rsi` - Relative Strength Index
- `macd` - Moving Average Convergence Divergence
- `sma` - Simple Moving Average
- `ema` - Exponential Moving Average
- `vwma` - Volume-Weighted Moving Average
- `bbands` - Bollinger Bands
- `atr` - Average True Range
- `ichimoku_cloud` - Ichimoku Cloud
- `price_change` - Price change percentage
- `volume_change` - Volume change percentage
- `custom` - Custom indicator

### Comparison Operators

- `>` - Greater than
- `>=` - Greater than or equal
- `<` - Less than
- `<=` - Less than or equal
- `==` - Equal to
- `!=` - Not equal to
- `crosses_above` - Indicator crosses above threshold/another indicator
- `crosses_below` - Indicator crosses below threshold/another indicator

### Signal Groups

Signals can be combined with AND/OR logic:

```json
{
  "logic": "AND",
  "conditions": [
    {
      "indicator": "rsi",
      "operator": "<",
      "value": 30,
      "lookbackBars": 5,          // Consider last 5 bars
      "minBarsTrue": 3            // Must be true for at least 3 bars
    }
  ],
  "groups": [                     // Nested groups for complex logic
    {
      "logic": "OR",
      "conditions": [
        {
          "indicator": "macd",
          "operator": "crosses_above",
          "secondaryIndicator": "sma"
        }
      ]
    }
  ]
}
```

## Complete Example

```json
{
  "version": "1.0.0",
  "name": "Momentum Breakout with Trailing Stop",
  "description": "Enter on momentum breakout, exit with trailing stop",
  "tags": ["momentum", "breakout", "trailing-stop"],
  "positionSizing": {
    "type": "percent_of_capital",
    "value": 0.1,
    "maxSize": 5000
  },
  "entry": {
    "type": "signal",
    "signal": {
      "logic": "AND",
      "conditions": [
        {
          "indicator": "rsi",
          "operator": ">",
          "value": 50
        },
        {
          "indicator": "price_change",
          "operator": ">",
          "value": 0.05,
          "lookbackBars": 10,
          "minBarsTrue": 5
        }
      ]
    },
    "maxWaitMinutes": 1440
  },
  "exit": [
    {
      "type": "profit_target",
      "profitTarget": 2.0,
      "percentToExit": 0.5
    },
    {
      "type": "stop_loss",
      "stopLossPercent": -0.3,
      "trailingStopThreshold": 1.5,
      "trailingStopPercent": 0.25
    }
  ],
  "reEntry": {
    "enabled": true,
    "type": "trailing_retrace",
    "retracePercent": 0.5,
    "maxReEntries": 2,
    "sizePercent": 0.5
  },
  "risk": {
    "maxLossPercent": -0.2,
    "minExitPrice": 0.5
  },
  "costs": {
    "entrySlippageBps": 50,
    "exitSlippageBps": 30,
    "feePercent": 0.001
  }
}
```

## Validation

The DSL includes two levels of validation:

1. **Schema Validation**: Checks required fields, types, and value ranges
2. **Consistency Validation**: Checks logical consistency (e.g., exit percentages sum to <= 1)

### Validation Example

```typescript
import { validateFull, parseStrategyDSL } from '@quantbot/core';

const dslJson = { /* ... */ };

const result = validateFull(dslJson);

if (!result.schemaValid) {
  console.error('Schema errors:', result.schemaErrors);
}

if (!result.consistencyValid) {
  console.error('Consistency errors:', result.consistencyErrors);
}

if (result.warnings.length > 0) {
  console.warn('Warnings:', result.warnings);
}
```

## Conversion to SimInput

The DSL can be converted to SimInput format for simulation:

```typescript
import { convertDSLToSimInput } from '@quantbot/core';

const simInput = convertDSLToSimInput(
  dsl,
  'run-123',
  'strategy-456',
  'So111...',
  '2024-01-01T00:00:00Z',
  candles
);
```

## Best Practices

1. **Use Tags**: Tag strategies for easy filtering and categorization
2. **Version Control**: Store DSL files in version control
3. **Validate Early**: Validate DSL before running simulations
4. **Document Assumptions**: Use `description` and `metadata` to document strategy rationale
5. **Test Incrementally**: Start with simple entry/exit, then add complexity
6. **Risk First**: Always define risk constraints before adding aggressive exits
7. **Cost Awareness**: Include realistic cost estimates for accurate simulations

## Migration from Legacy Format

Existing strategies in the legacy format (array of profit targets) can be migrated to DSL format. See migration script: `scripts/migration/strategies-to-dsl.ts`.

## See Also

- [Strategy Templates](./STRATEGY_TEMPLATES.md) - Pre-built strategy templates
- [Simulation Contract](./SIMULATION_CONTRACT.md) - Simulation input/output format
- [Execution Models](./EXECUTION_MODELS.md) - Realistic execution simulation


# 📊 Strategies Guide

## Where Strategies Come From

The interactive CLI (`quantbot sim`) fetches strategies from your **Postgres database** in the `strategies` table.

## Adding Strategies

### Option 1: Use the Seed Script (Recommended)

```bash
# From workspace root
ts-node scripts/workflows/seed-strategies.ts
```

This will add 5 example strategies:
- `IchimokuV1` - Ichimoku cloud strategy
- `PT2_SL25` - Simple 2x target with 25% stop loss
- `Scalper_Fast` - Fast scalping strategy
- `Conservative_24h` - Conservative 24h hold
- `Aggressive_Multi` - Aggressive multi-target

### Option 2: Add via CLI (Coming Soon)

```bash
quantbot storage create-strategy \
  --name "MyStrategy" \
  --config '{"legs": [{"target": 2.0, "percent": 1.0}], "stopLoss": {"initial": -0.25}}'
```

### Option 3: Add Programmatically

```typescript
import { StrategiesRepository } from '@quantbot/storage';

const repo = new StrategiesRepository();
await repo.create({
  name: 'MyStrategy',
  version: '1',
  category: 'custom',
  description: 'My custom strategy',
  config: {
    legs: [
      { target: 2.0, percent: 0.5 },
      { target: 3.0, percent: 0.5 },
    ],
    stopLoss: {
      initial: -0.25,
    },
    entry: {
      type: 'immediate',
    },
    costs: {
      entryFee: 0.01,
      exitFee: 0.01,
      slippage: 0.005,
    },
  },
  isActive: true,
});
```

## Strategy Configuration Format

Strategies are stored as JSON in the `config_json` column. The format matches `@quantbot/simulation` types:

```typescript
{
  // Profit targets (legs)
  legs: [
    { target: 2.0, percent: 0.5 },  // Exit 50% at 2x
    { target: 3.0, percent: 0.5 },  // Exit 50% at 3x
  ],
  
  // Stop loss configuration
  stopLoss: {
    initial: -0.25,      // -25% initial stop loss
    trailing: 0.1,       // 10% trailing stop (optional)
  },
  
  // Entry configuration
  entry: {
    type: 'immediate',   // or 'drop_based', 'trailing'
  },
  
  // Cost configuration
  costs: {
    entryFee: 0.01,      // 1% entry fee
    exitFee: 0.01,       // 1% exit fee
    slippage: 0.005,     // 0.5% slippage
  },
  
  // Optional: Hold duration
  holdHours: 24,         // Hold for 24 hours max
  
  // Optional: Entry/exit signals
  entrySignal: { ... },
  exitSignal: { ... },
}
```

## Checking Existing Strategies

### Via CLI

```bash
# Query strategies table
quantbot storage query --table strategies --limit 10
```

### Via SQL

```sql
SELECT name, version, description, is_active 
FROM strategies 
WHERE is_active = true
ORDER BY name, version;
```

## Troubleshooting

### "No active strategies found"

**Solution**: Run the seed script:
```bash
ts-node scripts/workflows/seed-strategies.ts
```

### Strategy not showing in list

**Check**:
1. Is `is_active = true`?
2. Does the strategy have a valid `config_json`?
3. Are you connected to the correct database?

### Strategy config errors

**Common issues**:
- Missing `legs` array
- Invalid `target` or `percent` values
- Missing required fields in `stopLoss` or `entry`

## Example Strategies

### Simple 2x Target
```json
{
  "legs": [{"target": 2.0, "percent": 1.0}],
  "stopLoss": {"initial": -0.25},
  "entry": {"type": "immediate"},
  "costs": {"entryFee": 0.01, "exitFee": 0.01, "slippage": 0.005}
}
```

### Multi-Target Ladder
```json
{
  "legs": [
    {"target": 1.5, "percent": 0.25},
    {"target": 2.0, "percent": 0.25},
    {"target": 3.0, "percent": 0.25},
    {"target": 5.0, "percent": 0.25}
  ],
  "stopLoss": {"initial": -0.3, "trailing": 0.1},
  "entry": {"type": "immediate"},
  "costs": {"entryFee": 0.01, "exitFee": 0.01, "slippage": 0.005}
}
```

### Conservative Hold
```json
{
  "legs": [{"target": 3.0, "percent": 1.0}],
  "stopLoss": {"initial": -0.2},
  "entry": {"type": "immediate"},
  "holdHours": 24,
  "costs": {"entryFee": 0.01, "exitFee": 0.01, "slippage": 0.005}
}
```

## Next Steps

1. **Seed example strategies**: `ts-node scripts/workflows/seed-strategies.ts`
2. **Run interactive CLI**: `quantbot sim`
3. **Select a strategy** from the list
4. **Configure and run** your simulation!


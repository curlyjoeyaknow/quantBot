# Using Existing `backtest optimize` Command

The existing `backtest optimize` command uses the `RiskPolicy` system, which is different from the `ExitPlan` system where break-even bailout is implemented.

## Two Approaches

### Approach 1: Use Existing Optimizer (Recommended for Initial Exploration)

The existing optimizer can explore:

- ✅ Fixed TP/SL combinations
- ✅ Time-based exits
- ✅ Ladder (partial exit) strategies
- ❌ Break-even bailout (not in RiskPolicy system)

**Command:**

```bash
quantbot backtest optimize \
  --interval 5m \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --caller <caller-name> \
  --max-stop-out-rate 0.3 \
  --max-p95-drawdown-bps -3000 \
  --taker-fee-bps 30 \
  --slippage-bps 10
```

**Limitations:**

- Uses `POLICY_GRID` from `packages/backtest/src/policies/risk-policy.ts`
- Doesn't support break-even bailout
- TP/SL are in the grid, not fixed to your specific values

**To customize the grid:**

1. Modify `POLICY_GRID` in `packages/backtest/src/policies/risk-policy.ts`
2. Set fixed TP=5.45x and SL=25% in the grid
3. Run the optimizer

### Approach 2: Hybrid - Optimizer + Exit-Stack (Recommended)

**Step 1:** Use optimizer to find best TP/SL/time/ladder combos (without BE bailout)

```bash
quantbot backtest optimize \
  --interval 5m \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --caller <caller-name>
```

**Step 2:** Take top performers and test with BE bailout using exit-stack mode

```bash
# Store exit plans with BE bailout variants
pnpm exec tsx scripts/store-be-bailout-strategies.ts

# Test each BE bailout variant
quantbot backtest run \
  --strategy exit-stack \
  --strategy-id be_bailout_be_10pct_hold_30min_ladder_none \
  --interval 5m \
  --from 2024-01-01 \
  --to 2024-12-31 \
  --run-id be_bailout_test_001
```

### Approach 3: Extend RiskPolicy to Support BE Bailout

To use the existing optimizer with BE bailout, you would need to:

1. **Add BE bailout to RiskPolicy types:**

   ```typescript
   export interface BreakEvenBailoutPolicy extends FixedStopPolicy {
     beArmedDdPct?: number; // Optional BE bailout threshold
   }
   ```

2. **Update policy executor** to handle BE bailout logic

3. **Update policy generator** to create BE bailout variants

This requires code changes but would allow using the existing optimizer directly.

## Recommended Workflow

Given your specific requirements (fixed TP/SL, explore BE bailout), I recommend:

1. **Use exit-stack mode** (Approach 2) - it's already set up and working
2. **Run all 100 configurations** using the scripts we created
3. **Compare results** to find optimal BE bailout parameters

The existing optimizer is great for general policy exploration, but for your specific BE bailout optimization, exit-stack mode is the right tool.

## Quick Comparison

| Feature | Existing Optimizer | Exit-Stack Mode |
|---------|-------------------|-----------------|
| TP/SL exploration | ✅ Yes | ✅ Fixed (your requirement) |
| Time-based exits | ✅ Yes | ✅ Yes |
| Ladder exits | ✅ Yes | ✅ Yes |
| BE bailout | ❌ No | ✅ Yes |
| Grid search | ✅ Automatic | ✅ Manual (via scripts) |
| Scoring | ✅ Built-in | ✅ Manual (query results) |

## Next Steps

1. **For BE bailout optimization:** Use exit-stack mode with the scripts we created
2. **For general policy exploration:** Use `backtest optimize` command
3. **For hybrid approach:** Use optimizer first, then test top performers with BE bailout

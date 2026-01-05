# Optimizer Combo Policies for Non-High-Multiple Callers

## Overview

The optimizer now generates sophisticated combo policies specifically for callers without high-multiple history (or not consistently high-multiple). These policies vigilantly protect 2x/3x gains from drawdowns while allowing trailing stops to ride pumps.

## Strategy

For **non-high-multiple callers**, the optimizer generates combo policies that combine:

1. **Trailing Stops (10-20%)** - Ride pumps after activation
2. **Ladder Exits at 2x/3x** - Protect gains by taking partial profits
3. **Hard Stop Losses** - Downside protection (15-25%)
4. **Time-Based Exits** - Optional risk management (2-4 hours)

## Policy Combinations

### Combo 1: Trailing Stop + Ladder + Hard Stop
- Trailing stop activates at 0.5x, 1x, 1.5x, or 2x gain
- Trails with 10%, 15%, or 20% from peak
- Ladder exits protect 2x/3x with partial profits (30-50% at each level)
- Hard stop (15-25%) protects downside

### Combo 2: Trailing Stop + Ladder + Hard Stop + Time Stop
- Same as Combo 1, plus time-based exit (2-4 hours)
- Ensures position doesn't stay open indefinitely

### Combo 3: Trailing Stop + Hard Stop (Simple)
- For when we want to ride the wave but still protect downside
- No ladder exits, just trailing stop + hard stop

### Combo 4: Ladder + Trailing Stop (Protect Then Ride)
- Ladder exits at 2x/3x protect initial gains
- Trailing stop activates after 1.5x to ride remaining position

## Activation Logic

The optimizer automatically:
1. Analyzes caller's historical peak multiples (p95, p75)
2. If caller is **high-multiple** (p95 >= 20x or p75 >= 10x):
   - Uses constraint relaxation instead of combo policies
   - Allows more drawdown/stop-outs for proven callers
3. If caller is **non-high-multiple**:
   - Generates combo policies with vigilant 2x/3x protection
   - Uses trailing stops to ride pumps (10-20%)
   - Combines multiple exit strategies

## Example Policies Generated

```typescript
// Example 1: Protect 2x with 50% exit, trail rest with 15%
{
  kind: 'combo',
  policies: [
    {
      kind: 'trailing_stop',
      activationPct: 1.0,  // Activate at 1x gain
      trailPct: 0.15,        // 15% trail
      hardStopPct: 0.20,     // 20% hard stop
    },
    {
      kind: 'ladder',
      levels: [{ multiple: 2.0, fraction: 0.5 }],  // Exit 50% at 2x
      stopPct: 0.20,
    },
  ],
}

// Example 2: Protect 2x/3x with ladder, then trail remaining
{
  kind: 'combo',
  policies: [
    {
      kind: 'ladder',
      levels: [
        { multiple: 2.0, fraction: 0.5 },  // 50% at 2x
        { multiple: 3.0, fraction: 0.3 },   // 30% at 3x
      ],
      stopPct: 0.20,
    },
    {
      kind: 'trailing_stop',
      activationPct: 1.5,   // Activate trailing after 1.5x
      trailPct: 0.10,       // 10% trail (tight to ride pump)
      hardStopPct: 0.20,
    },
  ],
}
```

## Benefits

1. **Protects Gains**: Ladder exits at 2x/3x ensure profits are locked in
2. **Rides Pumps**: Trailing stops (10-20%) allow remaining position to capture upside
3. **Downside Protection**: Hard stops prevent catastrophic losses
4. **Flexible**: Multiple combinations tested to find optimal strategy per caller

## Usage

The combo policies are automatically generated when:
- Caller is identified as non-high-multiple
- Policy types include 'combo', 'trailing_stop', or 'ladder'

No additional configuration needed - the optimizer handles this automatically based on caller profile analysis.


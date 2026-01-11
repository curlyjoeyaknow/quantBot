# Modular Trade Simulation Library - Usage Guide

## Overview

The modular library separates trade simulation into composable components:

1. **Entry Strategies** (`lib/entry_strategies.py`) - How to enter a trade
2. **Stop Strategies** (`lib/stop_strategies.py`) - How to exit a trade
3. **Trade Simulator** (`lib/trade_simulator.py`) - Combines entry + stop

## Benefits

✅ **Reusable** - Write once, use everywhere  
✅ **Testable** - Each component can be tested independently  
✅ **Composable** - Mix and match strategies  
✅ **Maintainable** - Changes in one place affect all simulators  
✅ **Extensible** - Easy to add new strategies  

## Quick Start

### Example 1: Immediate Entry + Trailing Stop

```python
from lib.trade_simulator import simulate_trade
from lib.entry_strategies import immediate_entry
from lib.stop_strategies import trailing_stop, PhaseConfig

result = simulate_trade(
    candles=candles,
    alert_price=1.0,
    alert_ts_ms=alert_ts,
    entry_strategy=immediate_entry,
    entry_params={},
    stop_strategy=trailing_stop,
    stop_params={
        'phases': [
            PhaseConfig(stop_pct=0.15, target_mult=2.0),  # Phase 1: 15% stop until 2x
            PhaseConfig(stop_pct=0.50),                   # Phase 2: 50% stop after 2x
        ]
    },
    stop_reference='alert',  # Calculate stops from alert price
)

print(f"Entry: {result.entry_price:.4f}")
print(f"Exit: {result.exit_price:.4f}")
print(f"Exit mult: {result.exit_mult:.2f}x")
print(f"Hit 3x: {result.hit_3x}")
```

### Example 2: Wait for -10% Dip + Static Stop

```python
from lib.entry_strategies import delayed_entry_dip
from lib.stop_strategies import static_stop

result = simulate_trade(
    candles=candles,
    alert_price=1.0,
    alert_ts_ms=alert_ts,
    entry_strategy=delayed_entry_dip,
    entry_params={
        'dip_pct': -0.10,  # Wait for 10% dip
        'max_wait_hrs': 2.0,  # Max 2 hours
    },
    stop_strategy=static_stop,
    stop_params={
        'phases': [
            PhaseConfig(stop_pct=0.20, target_mult=2.0),
            PhaseConfig(stop_pct=0.40),
        ]
    },
    stop_reference='alert',
)

if result.entry_occurred:
    print(f"Dip occurred after {result.time_to_entry_hrs:.2f} hours")
    print(f"Entry: {result.entry_price:.4f} ({result.entry_price/result.alert_price - 1:.1%} from alert)")
else:
    print(f"Dip never occurred: {result.missed_reason}")
```

### Example 3: Time-Delayed Entry + Trailing Stop

```python
from lib.entry_strategies import delayed_entry_time

result = simulate_trade(
    candles=candles,
    alert_price=1.0,
    alert_ts_ms=alert_ts,
    entry_strategy=delayed_entry_time,
    entry_params={
        'wait_hrs': 0.5,  # Wait 30 minutes
    },
    stop_strategy=trailing_stop,
    stop_params={
        'phases': [PhaseConfig(stop_pct=0.15)],  # Single phase, 15% trailing
    },
    stop_reference='entry',  # Calculate stops from entry price
)
```

### Example 4: Limit Order + Trailing Stop

```python
from lib.entry_strategies import limit_order_entry

result = simulate_trade(
    candles=candles,
    alert_price=1.0,
    alert_ts_ms=alert_ts,
    entry_strategy=limit_order_entry,
    entry_params={
        'limit_price': 0.85,  # Limit order at $0.85
        'max_wait_hrs': 1.0,  # Cancel after 1 hour
    },
    stop_strategy=trailing_stop,
    stop_params={
        'phases': [PhaseConfig(stop_pct=0.20)],
    },
    stop_reference='entry',
)
```

## Entry Strategies

### `immediate_entry`

Enter at alert price immediately.

**Parameters**: None

**Use case**: Baseline strategy, enter as soon as alert fires.

### `delayed_entry_dip`

Wait for price to dip X% below alert before entering.

**Parameters**:
- `dip_pct` (float): Target dip percentage (negative, e.g., -0.10 for -10%)
- `max_wait_hrs` (float, optional): Maximum hours to wait

**Use case**: Wait for a pullback to get better entry.

**Returns**: `entry_occurred=False` if dip never occurs.

### `delayed_entry_time`

Wait X hours after alert, then enter at market price.

**Parameters**:
- `wait_hrs` (float): Hours to wait before entering

**Use case**: Avoid initial volatility, enter after price settles.

### `limit_order_entry`

Place limit order at specific price.

**Parameters**:
- `limit_price` (float): Target entry price
- `max_wait_hrs` (float, optional): Maximum hours to wait

**Use case**: Enter at specific price level.

**Returns**: `entry_occurred=False` if limit never fills.

## Stop Strategies

### `static_stop`

Stops fixed at reference price × (1 - stop_pct).

**Parameters**:
- `phases` (List[PhaseConfig]): Phase configurations
- `reference_price` (float): Price to calculate stops from
- `max_duration_hrs` (float): Maximum trade duration (default 48h)

**Behavior**:
- Stop price is fixed when phase starts
- Does not move with price
- Good for "let it run" strategies

**Example**:
```python
phases = [
    PhaseConfig(stop_pct=0.15, target_mult=2.0),  # 15% below alert until 2x
    PhaseConfig(stop_pct=0.50),                   # 50% below 2x price after 2x
]
```

### `trailing_stop`

Stop follows peak price.

**Parameters**:
- `phases` (List[PhaseConfig]): Phase configurations
- `max_duration_hrs` (float): Maximum trade duration (default 48h)

**Behavior**:
- Stop moves up with every new peak
- Locks in gains
- Good for capturing momentum

**Example**:
```python
phases = [
    PhaseConfig(stop_pct=0.15, target_mult=2.0),  # 15% trailing until 2x
    PhaseConfig(stop_pct=0.50),                   # 50% trailing after 2x
]
```

## Stop Reference: Alert vs Entry

### `stop_reference='alert'` (Recommended)

Stops calculated from original alert price.

**Pros**:
- Consistent risk management
- Fair comparison across entry strategies
- Stops don't change based on entry timing

**Cons**:
- Stop might be above entry price initially
- Could stop out immediately if entered near stop

**Example**:
```
Alert: $1.00
Wait for -20% dip: Enter at $0.80
Phase 1 stop (15%): $0.85 (15% below $1.00)
```

### `stop_reference='entry'`

Stops calculated from actual entry price.

**Pros**:
- Stops always below entry
- More intuitive risk management

**Cons**:
- Different risk profiles for each entry strategy
- Not apples-to-apples comparison

**Example**:
```
Alert: $1.00
Wait for -20% dip: Enter at $0.80
Phase 1 stop (15%): $0.68 (15% below $0.80)
```

## Trade Result Schema

```python
@dataclass
class TradeResult:
    # Entry details
    entry_occurred: bool
    entry_price: float
    entry_ts_ms: int
    time_to_entry_hrs: float
    missed_reason: Optional[str]  # Why entry didn't occur
    
    # Exit details (only if entry occurred)
    exit_price: Optional[float]
    exit_ts_ms: Optional[int]
    exit_reason: Optional[str]
    
    # Performance metrics
    entry_mult: float  # Always 1.0
    peak_mult: Optional[float]
    exit_mult: Optional[float]
    exit_mult_from_alert: Optional[float]
    giveback_from_peak_pct: Optional[float]
    
    # Milestones
    hit_2x: Optional[bool]
    hit_3x: Optional[bool]
    hit_4x: Optional[bool]
    hit_5x: Optional[bool]
    hit_10x: Optional[bool]
    ath_multiple: Optional[float]
    
    # Reference prices
    alert_price: float
    reference_price: float
```

## Grid Testing

Test multiple entry × stop strategy combinations:

```python
from lib.trade_simulator import simulate_trade_grid
from lib.entry_strategies import immediate_entry, delayed_entry_dip
from lib.stop_strategies import static_stop, trailing_stop

entry_strategies = [
    (immediate_entry, {}, "Immediate"),
    (delayed_entry_dip, {'dip_pct': -0.10}, "-10% dip"),
    (delayed_entry_dip, {'dip_pct': -0.20}, "-20% dip"),
]

stop_strategies = [
    (static_stop, {'phases': [PhaseConfig(0.15, 2.0), PhaseConfig(0.50)]}, "Static 15/50"),
    (trailing_stop, {'phases': [PhaseConfig(0.15, 2.0), PhaseConfig(0.50)]}, "Trailing 15/50"),
]

results = simulate_trade_grid(
    candles=candles,
    alert_price=1.0,
    alert_ts_ms=alert_ts,
    entry_strategies=entry_strategies,
    stop_strategies=stop_strategies,
    stop_reference='alert',
)

for r in results:
    print(f"{r['entry_strategy']} + {r['stop_strategy']}: {r['result'].exit_mult:.2f}x")
```

## Adding New Strategies

### New Entry Strategy

```python
def my_custom_entry(
    candles: List[Dict],
    alert_price: float,
    alert_ts_ms: int,
    # Your custom parameters
    my_param: float,
) -> EntryResult:
    """Your custom entry logic."""
    # ... implementation ...
    
    return EntryResult(
        entry_occurred=True,
        entry_price=actual_entry_price,
        entry_ts_ms=entry_ts,
        time_to_entry_hrs=time_elapsed,
        candles_after_entry=remaining_candles,
    )

# Register it
from lib.entry_strategies import ENTRY_STRATEGIES
ENTRY_STRATEGIES['my_custom'] = my_custom_entry
```

### New Stop Strategy

```python
def my_custom_stop(
    candles: List[Dict],
    entry_price: float,
    entry_ts_ms: int,
    reference_price: float,
    # Your custom parameters
    my_param: float,
) -> ExitResult:
    """Your custom stop logic."""
    # ... implementation ...
    
    return ExitResult(
        exit_price=exit_price,
        exit_ts_ms=exit_ts,
        exit_reason="my_custom_reason",
        peak_mult=peak_mult,
        hit_2x=hit_2x,
        hit_3x=hit_3x,
        hit_4x=hit_4x,
        hit_5x=hit_5x,
        hit_10x=hit_10x,
        ath_multiple=ath_multiple,
    )

# Register it
from lib.stop_strategies import STOP_STRATEGIES
STOP_STRATEGIES['my_custom'] = my_custom_stop
```

## Integration with Existing Simulators

### Refactoring `phased_stop_simulator.py`

**Before** (monolithic):
```python
def simulate_phased_trade(candles, entry_price, ...):
    # 300 lines of entry + stop logic mixed together
    ...
```

**After** (modular):
```python
from lib.trade_simulator import simulate_trade
from lib.entry_strategies import immediate_entry
from lib.stop_strategies import trailing_stop

result = simulate_trade(
    candles=candles,
    alert_price=alert_price,
    alert_ts_ms=alert_ts,
    entry_strategy=immediate_entry,
    stop_strategy=trailing_stop,
    stop_params={'phases': phases},
)
```

### Adding Delayed Entry to Existing Simulator

```python
# Add parameter
parser.add_argument('--delayed-entry', type=float, default=0.0,
                   help='Wait for X% dip before entering (e.g., -0.10 for -10%)')

# Use in simulation
if args.delayed_entry < 0:
    entry_strategy = delayed_entry_dip
    entry_params = {'dip_pct': args.delayed_entry}
else:
    entry_strategy = immediate_entry
    entry_params = {}

result = simulate_trade(
    ...,
    entry_strategy=entry_strategy,
    entry_params=entry_params,
)
```

## Testing

### Unit Tests

```python
def test_delayed_entry_dip():
    candles = [
        {'timestamp': 1000, 'high': 1.0, 'low': 0.95, 'close': 0.97},
        {'timestamp': 2000, 'high': 0.98, 'low': 0.88, 'close': 0.90},  # Dip to -12%
        {'timestamp': 3000, 'high': 1.50, 'low': 0.90, 'close': 1.40},
    ]
    
    result = delayed_entry_dip(
        candles=candles,
        alert_price=1.0,
        alert_ts_ms=0,
        dip_pct=-0.10,
    )
    
    assert result.entry_occurred == True
    assert result.entry_price == 0.90
    assert result.time_to_entry_hrs > 0
```

### Integration Tests

```python
def test_trade_simulation_with_delayed_entry():
    result = simulate_trade(
        candles=test_candles,
        alert_price=1.0,
        alert_ts_ms=0,
        entry_strategy=delayed_entry_dip,
        entry_params={'dip_pct': -0.10},
        stop_strategy=trailing_stop,
        stop_params={'phases': [PhaseConfig(0.15)]},
    )
    
    assert result.entry_occurred == True
    assert result.exit_mult > 0
```

## Best Practices

1. **Always use `stop_reference='alert'` for comparisons**
   - Ensures fair comparison across entry strategies
   - Consistent risk management

2. **Test entry strategies independently**
   - Verify dip occurrence rates
   - Check time to entry distributions
   - Validate missed trade handling

3. **Test stop strategies independently**
   - Verify stop calculations
   - Check phase transitions
   - Validate exit reasons

4. **Use grid testing for optimization**
   - Test all combinations
   - Find optimal entry + stop pairs
   - Per-caller optimization

5. **Handle edge cases**
   - No candles available
   - Dip never occurs
   - Limit order never fills
   - Immediate stop out

## Performance Tips

1. **Reuse candle data**
   - Load once, simulate multiple strategies
   - Cache candle data per token

2. **Parallelize simulations**
   - Use `ThreadPoolExecutor` for multiple alerts
   - Each alert is independent

3. **Batch aggregations**
   - Collect all results first
   - Aggregate at the end

4. **Lazy evaluation**
   - Only load candles when needed
   - Skip tokens with no candles

## Future Extensions

### Planned Strategies

**Entry**:
- `vwap_entry` - Enter when price crosses VWAP
- `rsi_entry` - Enter when RSI hits threshold
- `volume_spike_entry` - Enter on volume spike

**Stop**:
- `ladder_stop` - Step up stops at intervals
- `time_stop` - Exit after X hours
- `indicator_stop` - Exit on RSI/MACD signal
- `hybrid_stop` - Combine multiple stop types

### Planned Features

- Strategy backtesting framework
- Strategy optimization (grid search)
- Strategy comparison dashboard
- Strategy performance metrics
- Strategy risk analysis

## Summary

The modular library provides:

✅ **Separation of concerns** - Entry, stop, and simulation logic are independent  
✅ **Reusability** - Write once, use in all simulators  
✅ **Testability** - Each component can be tested independently  
✅ **Extensibility** - Easy to add new strategies  
✅ **Maintainability** - Changes in one place affect all simulators  

This is the foundation for all future backtesting work. 🎯


# Simulator Spec v1 (Deterministic Candle Engine)

This spec defines the simulator's "physics" so results are reproducible and debuggable.

## Inputs
- candles[]: ordered by time ascending
  - candle: { ts, o, h, l, c, v }
- strategy: JSON config (validated)
- execution model:
  - fill_model: "open" | "close"
  - fee_bps: >= 0
  - slippage_bps: >= 0
- optional: initial_capital, position sizing (v1 assumes 100% size_pct unless configured)

## Outputs
- trades[]: summary of completed trades
- events[]: ordered by time ascending (and within candle by precedence ordering)
- (optional) frames[]: candle + events + position state per candle for replay

## Time & indexing
- Each candle has an index i
- All decisions happen on a "decision price" per candle:
  - if fill_model == "close": decision_price = c
  - if fill_model == "open": decision_price = o

## Indicators (v1)
- RSI (period N)
- EMA (period N)
- Future: ATR, VWAP, etc.

Indicators are computed on candle close prices (c) unless explicitly specified otherwise.

## Entry
Strategy entry modes (v1 subset):
- immediate
- signal: rsi_below(period, value)
- signal: ema_cross(fast, slow, direction="bull"|"bear")

Entry delay:
- none
- wait N candles AFTER signal becomes true
  - signal_true at candle i => earliest fill at candle i + N
  - If signal stops being true during delay window:
    - v1 rule: still enter at i+N (signal is a trigger, not a condition)
    - (later: optional "must-still-be-true" mode)

Entry fill price:
- Use decision_price of the fill candle, then apply slippage:
  - buy_fill = decision_price * (1 + slippage_bps/10000)

## Position model
- Single position at a time per token (v1)
- Position size tracked in percent of initial position: 0..100
- Partial exits reduce size_pct; avg_price remains unchanged for simplicity (v1)

## Exits
Exit mechanisms (any combination):
- Profit targets (ladder)
- Trailing stop
- Time exit (max candles in trade)
- Hard stop loss

### Profit targets (ladder)
- Each target: { size_pct, profit_pct }
- profit_pct is relative to entry_price
- Target price = entry_price * (1 + profit_pct/100)

When hit:
- emit TARGET_HIT
- emit PARTIAL_EXIT(size_pct)
- sell_fill = fill_price * (1 - fee - slippage)

### Hard stop loss
- stop_price = entry_price * (1 - stop_loss_pct/100)

### Trailing stop
- Activated when unrealized profit >= activate_profit_pct
- trail is percent off highest price since activation:
  - trail_stop = high_watermark * (1 - trail_pct/100)
- High watermark updates based on candle highs (h) after activation.
- If break-even mode enabled and first target hit:
  - stop_price becomes at least entry_price (after target1)

### Time exit
- Exit fully when trade_age_candles >= max_candles_in_trade
- Fill on decision_price of that candle

## Intra-candle event ordering (critical!)
Candles only provide O/H/L/C. If both stop and target are inside the same candle, ordering is ambiguous.
We define a deterministic precedence based on a chosen intrabar path.

v1 sets an explicit intrabar path:
- "conservative_long": price traverses O -> L -> H -> C
  - For long positions, this favors stops triggering before targets in mixed candles.

For longs:
1) STOP check uses L against stop_price / trailing_stop
2) TARGET check uses H against target_price(s)
3) TIME EXIT check last (end of candle)

If stop triggers:
- exit full immediately; remaining targets do not execute in that candle.

If multiple targets are hit in one candle:
- execute targets in ascending profit_pct order until position size runs out.

## Fees & slippage
- fee_bps applies on each fill (entry and each exit fill)
- For buys: price *= (1 + fee + slippage)
- For sells: price *= (1 - fee - slippage)
(Yes, simplified. It's consistent and explicit.)

## End of data
If a position remains open at final candle:
- v1: force EXIT_FULL at final candle decision_price
- reason = "end_of_data"

## Validation rules (hard rejects)
- targets sum size_pct <= 100
- stop_loss_pct > 0 recommended (may be required by policy)
- trail_pct > 0 if enabled
- activate_profit_pct >= 0 if trailing enabled
- max_candles_in_trade > 0 if time exit enabled
- strategy must contain at least one exit path:
  - targets OR trailing OR time_exit OR stop_loss


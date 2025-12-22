# Technical Indicators Integration Plan

## Goal
Integrate technical indicators (Moving Averages, Ichimoku Cloud) into strategy simulations to:
- Improve entry timing (e.g., enter when price crosses above Ichimoku cloud)
- Better exit signals (e.g., exit when price breaks below moving average)
- Higher win rates through better entry/exit decisions

## Available Indicators

### 1. Ichimoku Cloud (Already Implemented)
- **Location:** `src/simulation/ichimoku.ts`
- **Components:**
  - Tenkan-sen (9-period high/low average)
  - Kijun-sen (26-period high/low average)
  - Senkou Span A & B (cloud boundaries)
  - Chikou Span (lagging line)
- **Signals:**
  - Price above cloud = bullish
  - Price below cloud = bearish
  - Tenkan crosses Kijun = momentum shift
  - Price crosses cloud = trend change

### 2. Moving Averages (To Implement)
- Simple Moving Average (SMA)
- Exponential Moving Average (EMA)
- Multiple timeframes (9, 20, 50, 200 periods)

## Strategy Ideas Using Indicators

### Entry Strategies

1. **Ichimoku Cloud Entry**
   - Wait for price to cross above cloud (bullish signal)
   - Enter when Tenkan crosses above Kijun
   - Enter when price exits cloud upward

2. **Moving Average Entry**
   - Enter when price crosses above SMA(20)
   - Enter when SMA(9) crosses above SMA(20) (golden cross)
   - Enter when price bounces off SMA support

3. **Combined Entry**
   - Price above Ichimoku cloud AND above SMA(20)
   - Tenkan > Kijun AND price > SMA(9)

### Exit Strategies

1. **Ichimoku Cloud Exit**
   - Exit when price breaks below cloud
   - Exit when Tenkan crosses below Kijun
   - Exit when cloud turns bearish

2. **Moving Average Exit**
   - Exit when price breaks below SMA(20)
   - Exit when SMA(9) crosses below SMA(20) (death cross)
   - Exit when price breaks below SMA(9)

3. **Combined Exit**
   - Exit when price breaks below cloud AND SMA(20)
   - Exit on bearish cloud + death cross

### Stop Loss Strategies

1. **Dynamic Stops Based on Indicators**
   - Stop loss at cloud bottom
   - Stop loss at SMA(20)
   - Stop loss at Kijun-sen (base line)

2. **Trailing Stops with Indicators**
   - Trail stop at cloud bottom as it rises
   - Trail stop at SMA(20) as it rises

## Implementation Approach

1. **Add indicator calculation to simulation**
   - Calculate Ichimoku for each candle
   - Calculate moving averages for each candle
   - Store indicator values with each candle

2. **Add indicator-based entry conditions**
   - Check indicators before entering
   - Wait for bullish signals before entry
   - Skip entry if indicators are bearish

3. **Add indicator-based exit conditions**
   - Check indicators during hold period
   - Exit early if indicators turn bearish
   - Use indicators to adjust stop losses

4. **Create indicator-based strategy variations**
   - Test strategies with different indicator combinations
   - Optimize indicator parameters (periods, thresholds)

## Expected Benefits

- **Higher Win Rates:** Better entry timing = fewer bad trades
- **Better Risk Management:** Indicator-based stops = better exits
- **More Consistent Returns:** Technical confirmation = more reliable signals
- **Improved Reinvestment Performance:** Higher win rates = better compound growth


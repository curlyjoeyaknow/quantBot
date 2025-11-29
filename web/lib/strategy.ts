// Strategy simulation utilities for web interface
// Simplified version of the tenkan-kijun strategy

interface Candle {
  timestamp: number | string | Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface IchimokuData {
  tenkan: number;
  kijun: number;
}

interface IndicatorData {
  ichimoku: IchimokuData | null;
}

function calculateIchimoku(candles: Candle[], currentIndex: number): IchimokuData | null {
  if (candles.length < 52 || currentIndex < 51) {
    return null;
  }

  // Tenkan-sen: 9-period high/low average
  const tenkanPeriod = Math.min(9, currentIndex + 1);
  const tenkanSlice = candles.slice(currentIndex - tenkanPeriod + 1, currentIndex + 1);
  const tenkanHigh = Math.max(...tenkanSlice.map(c => c.high));
  const tenkanLow = Math.min(...tenkanSlice.map(c => c.low));
  const tenkan = (tenkanHigh + tenkanLow) / 2;

  // Kijun-sen: 26-period high/low average
  const kijunPeriod = Math.min(26, currentIndex + 1);
  const kijunSlice = candles.slice(currentIndex - kijunPeriod + 1, currentIndex + 1);
  const kijunHigh = Math.max(...kijunSlice.map(c => c.high));
  const kijunLow = Math.min(...kijunSlice.map(c => c.low));
  const kijun = (kijunHigh + kijunLow) / 2;

  return { tenkan, kijun };
}

function normalizeTimestamp(timestamp: number | string | Date): number {
  if (typeof timestamp === 'number') {
    return timestamp * 1000; // Assume seconds, convert to ms
  }
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }
  return new Date(timestamp).getTime();
}

export interface StrategyResult {
  pnl: number;
  maxReached: number;
  holdDuration: number;
  entryTime: number;
  exitTime: number;
  entryPrice: number;
}

/**
 * Simulate Tenkan-Kijun cross strategy with 20% loss cap
 * Only enters after 6-hour mark from alert
 */
export function simulateTenkanKijunRemainingPeriodOnly(
  candles: Candle[],
  alertTime: Date
): StrategyResult | null {
  if (candles.length < 52) {
    return null;
  }

  const alertTimestamp = alertTime.getTime();
  const sixHourMark = alertTimestamp + (6 * 60 * 60 * 1000);

  // Find the index where 6 hours have passed
  let sixHourIndex = 0;
  for (let i = 0; i < candles.length; i++) {
    const candleTime = normalizeTimestamp(candles[i].timestamp);
    if (candleTime >= sixHourMark) {
      sixHourIndex = i;
      break;
    }
  }

  if (sixHourIndex === 0 || candles.length - sixHourIndex < 52) {
    return null;
  }

  // Calculate indicators
  const indicatorData: IndicatorData[] = [];
  for (let i = 0; i < candles.length; i++) {
    const ichimoku = calculateIchimoku(candles, i);
    indicatorData.push({ ichimoku });
  }

  // Find Tenkan/Kijun cross entry - ONLY after 6-hour mark
  let entryIndex = 0;
  const searchStartIndex = Math.max(sixHourIndex, 52);
  
  for (let i = searchStartIndex; i < candles.length; i++) {
    const indicators = indicatorData[i];
    const previousIndicators = i > 0 ? indicatorData[i - 1] : null;
    
    if (previousIndicators?.ichimoku && indicators.ichimoku) {
      const crossedUp = previousIndicators.ichimoku.tenkan <= previousIndicators.ichimoku.kijun &&
                        indicators.ichimoku.tenkan > indicators.ichimoku.kijun;
      if (crossedUp) {
        entryIndex = i;
        break;
      }
    }
  }

  if (entryIndex === 0 || entryIndex < sixHourIndex) {
    return null;
  }

  const actualEntryPrice = candles[entryIndex].close;
  const entryTime = normalizeTimestamp(candles[entryIndex].timestamp);

  let remaining = 1.0;
  let pnl = 0;
  let highestPrice = actualEntryPrice;
  let maxReached = 1.0;
  let exitTime = entryTime;
  let exited = false;

  const minExitPrice = actualEntryPrice * 0.8; // 20% loss cap
  const targetsHit = new Set<number>();

  const startIndex = entryIndex + 1;
  
  if (startIndex >= candles.length) {
    return {
      pnl: 1.0,
      maxReached: 1.0,
      holdDuration: 0,
      entryTime,
      exitTime: entryTime,
      entryPrice: actualEntryPrice,
    };
  }
  
  for (let i = startIndex; i < candles.length; i++) {
    const candle = candles[i];
    const indicators = indicatorData[i];
    const previousIndicators = i > startIndex ? indicatorData[i - 1] : indicatorData[entryIndex];
    
    const candleTime = normalizeTimestamp(candle.timestamp);

    const effectiveHigh = candle.close > 0 && candle.high / candle.close > 10 
      ? candle.close * 1.05
      : candle.high;
    
    const effectiveLow = candle.close > 0 && candle.low / candle.close < 0.1
      ? candle.close * 0.95
      : candle.low;

    const currentMultiplier = effectiveHigh / actualEntryPrice;
    if (currentMultiplier > maxReached) {
      maxReached = currentMultiplier;
    }

    if (remaining > 0 && effectiveHigh > highestPrice) {
      highestPrice = effectiveHigh;
    }

    // Check Tenkan/Kijun cross down exit
    if (previousIndicators?.ichimoku && indicators.ichimoku) {
      const crossedDown = previousIndicators.ichimoku.tenkan >= previousIndicators.ichimoku.kijun &&
                           indicators.ichimoku.tenkan < indicators.ichimoku.kijun;
      if (crossedDown && remaining > 0) {
        const exitPrice = Math.max(effectiveLow, minExitPrice);
        pnl += remaining * (exitPrice / actualEntryPrice);
        remaining = 0;
        exitTime = candleTime;
        exited = true;
        break;
      }
    }

    // Profit target: 50% at 1.5x
    const targetPrice = actualEntryPrice * 1.5;
    if (!targetsHit.has(1.5) && remaining >= 0.5 && effectiveHigh >= targetPrice) {
      pnl += 0.5 * 1.5;
      remaining -= 0.5;
      targetsHit.add(1.5);
    }

    // Stop loss at Kijun or 20% floor
    let currentStopPrice = minExitPrice;
    if (indicators.ichimoku && indicators.ichimoku.kijun > minExitPrice) {
      currentStopPrice = indicators.ichimoku.kijun;
    }
    
    if (remaining > 0 && effectiveLow <= currentStopPrice) {
      const exitPrice = Math.max(currentStopPrice, minExitPrice);
      pnl += remaining * (exitPrice / actualEntryPrice);
      remaining = 0;
      exitTime = candleTime;
      exited = true;
      break;
    }
  }

  // Final exit if still holding
  if (remaining > 0) {
    const finalPrice = candles[candles.length - 1].close;
    const exitPrice = Math.max(finalPrice, minExitPrice);
    pnl += remaining * (exitPrice / actualEntryPrice);
    exitTime = normalizeTimestamp(candles[candles.length - 1].timestamp);
    exited = true;
  }

  // Apply loss clamp (20% max loss = 0.8x minimum)
  if (pnl < 0.8) {
    pnl = 0.8;
  }

  const holdDurationMinutes = exited
    ? Math.max(0, Math.floor((exitTime - entryTime) / 60000))
    : 0;

  return {
    pnl,
    maxReached,
    holdDuration: holdDurationMinutes,
    entryTime,
    exitTime,
    entryPrice: actualEntryPrice,
  };
}


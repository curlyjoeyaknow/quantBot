/**
 * Ichimoku Cloud Technical Analysis
 * =================================
 * Implements Ichimoku Kinko Hyo (Cloud) analysis for real-time CA monitoring.
 *
 * Ichimoku Components:
 * - Tenkan-sen (Conversion Line): (9-period high + 9-period low) / 2
 * - Kijun-sen (Base Line): (26-period high + 26-period low) / 2
 * - Senkou Span A (Leading Span A): (Tenkan + Kijun) / 2, plotted 26 periods ahead
 * - Senkou Span B (Leading Span B): (52-period high + 52-period low) / 2, plotted 26 periods ahead
 * - Chikou Span (Lagging Span): Current close, plotted 26 periods behind
 *
 * Trading Signals:
 * - Price above cloud = bullish
 * - Price below cloud = bearish
 * - Tenkan crosses Kijun = momentum shift
 * - Price crosses cloud = trend change
 */

import type { Candle } from '@quantbot/core';

export interface IchimokuData {
  span_b: number | undefined;
  span_a: number | undefined;
  tenkan: number; // Conversion Line
  kijun: number; // Base Line
  senkouA: number; // Leading Span A (26 periods ahead)
  senkouB: number; // Leading Span B (26 periods ahead)
  chikou: number; // Lagging Span (26 periods behind)
  cloudTop: number; // Top of cloud (max of senkouA, senkouB)
  cloudBottom: number; // Bottom of cloud (min of senkouA, senkouB)
  cloudThickness: number; // Cloud thickness (senkouA - senkouB)
  isBullish: boolean; // Price above cloud
  isBearish: boolean; // Price below cloud
  inCloud: boolean; // Price inside cloud
}

export interface IchimokuSignal {
  type: 'tenkan_kijun_cross' | 'cloud_cross' | 'cloud_exit' | 'momentum_shift';
  direction: 'bullish' | 'bearish';
  price: number;
  timestamp: number;
  description: string;
  strength: 'weak' | 'medium' | 'strong';
}

/**
 * Calculate Ichimoku Cloud data for a given candle
 * @param candles Array of candles (need at least 52 periods for full calculation)
 * @param currentIndex Index of current candle to analyze
 * @returns Ichimoku data for the current candle
 */
export function calculateIchimoku(candles: Candle[], currentIndex: number): IchimokuData | null {
  if (candles.length < 52 || currentIndex < 51) {
    return null; // Need at least 52 periods for full Ichimoku calculation
  }

  const current = candles[currentIndex];

  // Tenkan-sen (Conversion Line): 9-period high/low average
  const tenkanPeriod = Math.min(9, currentIndex + 1);
  const tenkanHigh = Math.max(
    ...candles.slice(currentIndex - tenkanPeriod + 1, currentIndex + 1).map((c) => c.high)
  );
  const tenkanLow = Math.min(
    ...candles.slice(currentIndex - tenkanPeriod + 1, currentIndex + 1).map((c) => c.low)
  );
  const tenkan = (tenkanHigh + tenkanLow) / 2;

  // Kijun-sen (Base Line): 26-period high/low average
  const kijunPeriod = Math.min(26, currentIndex + 1);
  const kijunHigh = Math.max(
    ...candles.slice(currentIndex - kijunPeriod + 1, currentIndex + 1).map((c) => c.high)
  );
  const kijunLow = Math.min(
    ...candles.slice(currentIndex - kijunPeriod + 1, currentIndex + 1).map((c) => c.low)
  );
  const kijun = (kijunHigh + kijunLow) / 2;

  // Senkou Span A: (Tenkan + Kijun) / 2, plotted 26 periods ahead
  const senkouA = (tenkan + kijun) / 2;

  // Senkou Span B: 52-period high/low average, plotted 26 periods ahead
  const senkouBPeriod = Math.min(52, currentIndex + 1);
  const senkouBHigh = Math.max(
    ...candles.slice(currentIndex - senkouBPeriod + 1, currentIndex + 1).map((c) => c.high)
  );
  const senkouBLow = Math.min(
    ...candles.slice(currentIndex - senkouBPeriod + 1, currentIndex + 1).map((c) => c.low)
  );
  const senkouB = (senkouBHigh + senkouBLow) / 2;

  // Chikou Span: Current close, plotted 26 periods behind
  const chikou = current.close;

  // Cloud analysis
  const cloudTop = Math.max(senkouA, senkouB);
  const cloudBottom = Math.min(senkouA, senkouB);
  const cloudThickness = Math.abs(senkouA - senkouB);

  // Price position relative to cloud
  const isBullish = current.close > cloudTop;
  const isBearish = current.close < cloudBottom;
  const inCloud = !isBullish && !isBearish;

  return {
    tenkan,
    kijun,
    senkouA,
    senkouB,
    chikou,
    cloudTop,
    cloudBottom,
    cloudThickness,
    isBullish,
    isBearish,
    inCloud,
    span_a: senkouA, // Alias for compatibility
    span_b: senkouB, // Alias for compatibility
  };
}

/**
 * Detect Ichimoku signals by comparing current and previous Ichimoku data
 * @param current Current Ichimoku data
 * @param previous Previous Ichimoku data
 * @param currentPrice Current price
 * @param timestamp Current timestamp
 * @returns Array of detected signals
 */
export function detectIchimokuSignals(
  current: IchimokuData,
  previous: IchimokuData,
  currentPrice: number,
  timestamp: number
): IchimokuSignal[] {
  const signals: IchimokuSignal[] = [];

  // Tenkan-Kijun Cross (momentum shift)
  if (previous && current) {
    const tenkanCrossUp = previous.tenkan <= previous.kijun && current.tenkan > current.kijun;
    const tenkanCrossDown = previous.tenkan >= previous.kijun && current.tenkan < current.kijun;

    if (tenkanCrossUp) {
      signals.push({
        type: 'tenkan_kijun_cross',
        direction: 'bullish',
        price: currentPrice,
        timestamp,
        description: `Tenkan crossed above Kijun - Bullish momentum shift`,
        strength: 'medium',
      });
    } else if (tenkanCrossDown) {
      signals.push({
        type: 'tenkan_kijun_cross',
        direction: 'bearish',
        price: currentPrice,
        timestamp,
        description: `Tenkan crossed below Kijun - Bearish momentum shift`,
        strength: 'medium',
      });
    }

    // Cloud Cross (trend change)
    const cloudCrossUp = previous.isBearish && current.isBullish;
    const cloudCrossDown = previous.isBullish && current.isBearish;
    const cloudExitUp = previous.inCloud && current.isBullish;
    const cloudExitDown = previous.inCloud && current.isBearish;

    if (cloudCrossUp || cloudExitUp) {
      signals.push({
        type: 'cloud_cross',
        direction: 'bullish',
        price: currentPrice,
        timestamp,
        description: `Price crossed above Ichimoku cloud - Bullish trend change`,
        strength: 'strong',
      });
    } else if (cloudCrossDown || cloudExitDown) {
      signals.push({
        type: 'cloud_cross',
        direction: 'bearish',
        price: currentPrice,
        timestamp,
        description: `Price crossed below Ichimoku cloud - Bearish trend change`,
        strength: 'strong',
      });
    }

    // Cloud thickness change (momentum strength)
    const thicknessChange = Math.abs(current.cloudThickness - previous.cloudThickness);
    const thicknessRatio = thicknessChange / previous.cloudThickness;

    if (thicknessRatio > 0.1) {
      // 10% change in cloud thickness
      const direction = current.cloudThickness > previous.cloudThickness ? 'bullish' : 'bearish';
      signals.push({
        type: 'momentum_shift',
        direction,
        price: currentPrice,
        timestamp,
        description: `Ichimoku cloud ${direction === 'bullish' ? 'expanding' : 'contracting'} - Momentum ${direction === 'bullish' ? 'strengthening' : 'weakening'}`,
        strength: 'weak',
      });
    }
  }

  return signals;
}

/**
 * Get Ichimoku signal strength based on multiple factors
 * @param signal The Ichimoku signal
 * @param ichimoku Current Ichimoku data
 * @returns Enhanced signal with strength assessment
 */
export function assessIchimokuSignalStrength(
  signal: IchimokuSignal,
  ichimoku: IchimokuData
): IchimokuSignal {
  let strength = signal.strength;

  // Enhance strength based on cloud thickness and position
  if (signal.type === 'cloud_cross') {
    const cloudThicknessRatio = ichimoku.cloudThickness / ichimoku.cloudTop;

    if (cloudThicknessRatio > 0.05) {
      // Thick cloud = stronger signal
      strength = 'strong';
    } else if (cloudThicknessRatio > 0.02) {
      strength = 'medium';
    } else {
      strength = 'weak';
    }
  }

  // Enhance strength based on Tenkan-Kijun distance
  if (signal.type === 'tenkan_kijun_cross') {
    const tenkanKijunDistance = Math.abs(ichimoku.tenkan - ichimoku.kijun) / ichimoku.kijun;

    if (tenkanKijunDistance > 0.02) {
      // 2% distance = stronger signal
      strength = 'strong';
    } else if (tenkanKijunDistance > 0.01) {
      strength = 'medium';
    } else {
      strength = 'weak';
    }
  }

  return {
    ...signal,
    strength,
  };
}

/**
 * Format Ichimoku data for display
 * @param ichimoku Ichimoku data
 * @param price Current price
 * @returns Formatted string for display
 */
export function formatIchimokuData(ichimoku: IchimokuData, price: number): string {
  const priceVsCloud =
    price > ichimoku.cloudTop ? 'above' : price < ichimoku.cloudBottom ? 'below' : 'inside';

  return `📊 **Ichimoku Analysis:**
• **Price**: $${price.toFixed(8)} (${priceVsCloud} cloud)
• **Tenkan**: $${ichimoku.tenkan.toFixed(8)}
• **Kijun**: $${ichimoku.kijun.toFixed(8)}
• **Cloud**: $${ichimoku.cloudBottom.toFixed(8)} - $${ichimoku.cloudTop.toFixed(8)}
• **Thickness**: ${((ichimoku.cloudThickness / ichimoku.cloudTop) * 100).toFixed(1)}%
• **Trend**: ${ichimoku.isBullish ? '🟢 Bullish' : ichimoku.isBearish ? '🔴 Bearish' : '🟡 Neutral'}`;
}

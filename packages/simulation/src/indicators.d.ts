/**
 * Technical Indicators for Trading Simulations
 * ============================================
 * Provides moving averages and integrates with Ichimoku Cloud
 */
import { Candle } from './candles';
import { IchimokuData } from './ichimoku';
export interface MovingAverages {
    sma9: number | null;
    sma20: number | null;
    sma50: number | null;
    ema9: number | null;
    ema20: number | null;
    ema50: number | null;
}
export interface IndicatorData {
    candle: Candle;
    index: number;
    movingAverages: MovingAverages;
    ichimoku: IchimokuData | null;
}
/**
 * Calculate Simple Moving Average (SMA)
 */
export declare function calculateSMA(candles: Candle[], period: number, currentIndex: number): number | null;
/**
 * Calculate Exponential Moving Average (EMA)
 */
export declare function calculateEMA(candles: Candle[], period: number, currentIndex: number, previousEMA?: number | null): number | null;
/**
 * Calculate all moving averages for a candle
 */
export declare function calculateMovingAverages(candles: Candle[], currentIndex: number, previousEMAs?: {
    ema9?: number | null;
    ema20?: number | null;
    ema50?: number | null;
}): MovingAverages;
/**
 * Calculate all indicators for a candle
 */
export declare function calculateIndicators(candles: Candle[], currentIndex: number, previousEMAs?: {
    ema9?: number | null;
    ema20?: number | null;
    ema50?: number | null;
}): IndicatorData;
/**
 * Check if price is above moving average (bullish signal)
 */
export declare function isPriceAboveMA(price: number, ma: number | null): boolean;
/**
 * Check if price is below moving average (bearish signal)
 */
export declare function isPriceBelowMA(price: number, ma: number | null): boolean;
/**
 * Check for golden cross (fast MA crosses above slow MA)
 */
export declare function isGoldenCross(fastMA: number | null, slowMA: number | null, prevFastMA: number | null, prevSlowMA: number | null): boolean;
/**
 * Check for death cross (fast MA crosses below slow MA)
 */
export declare function isDeathCross(fastMA: number | null, slowMA: number | null, prevFastMA: number | null, prevSlowMA: number | null): boolean;
/**
 * Get bullish indicator signals
 */
export declare function getBullishSignals(current: IndicatorData, previous: IndicatorData | null): string[];
/**
 * Get bearish indicator signals
 */
export declare function getBearishSignals(current: IndicatorData, previous: IndicatorData | null): string[];
/**
 * Check if indicators support bullish entry
 */
export declare function isBullishEntry(current: IndicatorData, previous: IndicatorData | null): boolean;
/**
 * Check if indicators suggest exit
 */
export declare function isBearishExit(current: IndicatorData, previous: IndicatorData | null): boolean;
//# sourceMappingURL=indicators.d.ts.map
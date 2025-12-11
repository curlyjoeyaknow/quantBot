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
import { Candle } from './candles';
export interface IchimokuData {
    span_b: number | undefined;
    span_a: number | undefined;
    tenkan: number;
    kijun: number;
    senkouA: number;
    senkouB: number;
    chikou: number;
    cloudTop: number;
    cloudBottom: number;
    cloudThickness: number;
    isBullish: boolean;
    isBearish: boolean;
    inCloud: boolean;
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
export declare function calculateIchimoku(candles: Candle[], currentIndex: number): IchimokuData | null;
/**
 * Detect Ichimoku signals by comparing current and previous Ichimoku data
 * @param current Current Ichimoku data
 * @param previous Previous Ichimoku data
 * @param currentPrice Current price
 * @param timestamp Current timestamp
 * @returns Array of detected signals
 */
export declare function detectIchimokuSignals(current: IchimokuData, previous: IchimokuData, currentPrice: number, timestamp: number): IchimokuSignal[];
/**
 * Get Ichimoku signal strength based on multiple factors
 * @param signal The Ichimoku signal
 * @param ichimoku Current Ichimoku data
 * @returns Enhanced signal with strength assessment
 */
export declare function assessIchimokuSignalStrength(signal: IchimokuSignal, ichimoku: IchimokuData): IchimokuSignal;
/**
 * Format Ichimoku data for display
 * @param ichimoku Ichimoku data
 * @param price Current price
 * @returns Formatted string for display
 */
export declare function formatIchimokuData(ichimoku: IchimokuData, price: number): string;
//# sourceMappingURL=ichimoku.d.ts.map
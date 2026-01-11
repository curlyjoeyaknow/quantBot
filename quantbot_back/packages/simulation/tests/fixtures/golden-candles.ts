/**
 * Golden Fixtures for Simulation Tests
 * ====================================
 *
 * These are tiny candle series where we know the exact answer.
 * Use these to verify simulation correctness, not just "it runs".
 *
 * SEMANTICS (locked):
 * - ATH/ATL: Uses high/low (not close) - realistic price extremes
 * - Drawdown: Peak-to-trough on highs/lows (not close-based)
 * - Fill model: Stop/target triggers on high/low, fills at trigger price (optimistic but explicit)
 * - Gaps: We simulate on available candles only; missing intervals don't affect results
 *
 * FEE MODEL:
 * - Entry: 1.25% slippage + 0.25% fee = 1.5% total cost
 * - Exit: 1.25% slippage + 0.25% fee = 1.5% total cost
 * - netMultiple = (exit * (1 - feeExit)) / (entry * (1 + feeEntry))
 */

import type { Candle } from '@quantbot/core';

/**
 * Calculate expected net multiple from entry/exit prices and fees
 *
 * Formula: netMultiple = (exit * (1 - feeExit)) / (entry * (1 + feeEntry))
 *
 * Where:
 * - feeEntry = entrySlippageBps + takerFeeBps (in decimal, e.g., 0.015 for 1.5%)
 * - feeExit = exitSlippageBps + takerFeeBps (in decimal)
 */
export function expectedNetMultiple(
  entryPrice: number,
  exitPrice: number,
  feeEntryDecimal: number,
  feeExitDecimal: number
): number {
  return (exitPrice * (1 - feeExitDecimal)) / (entryPrice * (1 + feeEntryDecimal));
}

// Fee configuration used in golden fixtures tests
// entrySlippageBps: 125 (1.25%) + takerFeeBps: 25 (0.25%) = 1.5% entry cost
// exitSlippageBps: 125 (1.25%) + takerFeeBps: 25 (0.25%) = 1.5% exit cost
const FEE_ENTRY_DECIMAL = 0.015; // 1.5%
const FEE_EXIT_DECIMAL = 0.015; // 1.5%

/**
 * Monotonic Up: Price goes from 1.0 to 2.0 linearly
 *
 * Fill model: Exit at last candle close (2.0)
 * ATH/ATL: Uses high/low (ATH = 2.0 at candle 10, ATL = 0.99 at candle 1)
 * Drawdown: 0% (price never goes below entry after entry candle)
 */
export const monotonicUp: Candle[] = [
  { timestamp: 1000, open: 1.0, high: 1.1, low: 0.99, close: 1.1, volume: 1000 },
  { timestamp: 2000, open: 1.1, high: 1.2, low: 1.09, close: 1.2, volume: 1100 },
  { timestamp: 3000, open: 1.2, high: 1.3, low: 1.19, close: 1.3, volume: 1200 },
  { timestamp: 4000, open: 1.3, high: 1.4, low: 1.29, close: 1.4, volume: 1300 },
  { timestamp: 5000, open: 1.4, high: 1.5, low: 1.39, close: 1.5, volume: 1400 },
  { timestamp: 6000, open: 1.5, high: 1.6, low: 1.49, close: 1.6, volume: 1500 },
  { timestamp: 7000, open: 1.6, high: 1.7, low: 1.59, close: 1.7, volume: 1600 },
  { timestamp: 8000, open: 1.7, high: 1.8, low: 1.69, close: 1.8, volume: 1700 },
  { timestamp: 9000, open: 1.8, high: 1.9, low: 1.79, close: 1.9, volume: 1800 },
  { timestamp: 10000, open: 1.9, high: 2.0, low: 1.89, close: 2.0, volume: 2000 },
];

export const monotonicUpExpected = {
  entryPrice: 1.0,
  exitPrice: 2.0,
  feeEntry: FEE_ENTRY_DECIMAL,
  feeExit: FEE_EXIT_DECIMAL,
  netMultiple: expectedNetMultiple(1.0, 2.0, FEE_ENTRY_DECIMAL, FEE_EXIT_DECIMAL), // ≈ 1.940886
  athPrice: 2.0, // Highest high
  athTimestamp: 10000,
  atlPrice: 0.99, // Lowest low
  atlTimestamp: 1000,
  maxDrawdown: 0, // Price never goes below entry (1.0) after entry candle
  totalCandles: 10,
};

/**
 * Monotonic Down: Price goes from 2.0 to 1.0 linearly
 *
 * Fill model: Stop loss triggers when low <= stop price (1.4), fills at stop price
 * ATH/ATL: ATH = 2.0 (candle 1), ATL = 1.0 (candle 10)
 * Drawdown: 50% from ATH (2.0 → 1.0)
 */
export const monotonicDown: Candle[] = [
  { timestamp: 1000, open: 2.0, high: 2.0, low: 1.9, close: 1.9, volume: 2000 },
  { timestamp: 2000, open: 1.9, high: 1.9, low: 1.8, close: 1.8, volume: 1900 },
  { timestamp: 3000, open: 1.8, high: 1.8, low: 1.7, close: 1.7, volume: 1800 },
  { timestamp: 4000, open: 1.7, high: 1.7, low: 1.6, close: 1.6, volume: 1700 },
  { timestamp: 5000, open: 1.6, high: 1.6, low: 1.5, close: 1.5, volume: 1600 },
  { timestamp: 6000, open: 1.5, high: 1.5, low: 1.4, close: 1.4, volume: 1500 }, // Stop loss triggers here (low <= 1.4)
  { timestamp: 7000, open: 1.4, high: 1.4, low: 1.3, close: 1.3, volume: 1400 },
  { timestamp: 8000, open: 1.3, high: 1.3, low: 1.2, close: 1.2, volume: 1300 },
  { timestamp: 9000, open: 1.2, high: 1.2, low: 1.1, close: 1.1, volume: 1200 },
  { timestamp: 10000, open: 1.1, high: 1.1, low: 1.0, close: 1.0, volume: 1000 },
];

export const monotonicDownExpected = {
  entryPrice: 2.0,
  exitPrice: 1.4, // Stop loss at -30% (2.0 * 0.7 = 1.4), fills at stop price
  feeEntry: FEE_ENTRY_DECIMAL,
  feeExit: FEE_EXIT_DECIMAL,
  netMultiple: expectedNetMultiple(2.0, 1.4, FEE_ENTRY_DECIMAL, FEE_EXIT_DECIMAL), // ≈ 0.6793
  athPrice: 2.0, // Highest high
  athTimestamp: 1000,
  atlPrice: 1.0, // Lowest low
  atlTimestamp: 10000,
  maxDrawdown: 0.5, // 50% from ATH (2.0 → 1.0)
  stopLossTriggered: true,
  totalCandles: 10,
};

/**
 * Whipsaw: Price oscillates around entry
 *
 * Fill model: Exit at last candle close (1.0)
 * ATH/ATL: ATH = 1.2 (candle 2), ATL = 0.9 (candle 3)
 * Drawdown: 25% from ATH (1.2 → 0.9)
 *
 * Note: Break-even price movement, but fees cause loss
 */
export const whipsaw: Candle[] = [
  { timestamp: 1000, open: 1.0, high: 1.05, low: 0.98, close: 1.02, volume: 1000 },
  { timestamp: 2000, open: 1.02, high: 1.2, low: 1.0, close: 1.15, volume: 1200 },
  { timestamp: 3000, open: 1.15, high: 1.15, low: 0.9, close: 0.95, volume: 1500 },
  { timestamp: 4000, open: 0.95, high: 1.1, low: 0.92, close: 1.05, volume: 1300 },
  { timestamp: 5000, open: 1.05, high: 1.08, low: 0.98, close: 1.0, volume: 1100 },
];

export const whipsawExpected = {
  entryPrice: 1.0,
  exitPrice: 1.0, // Break-even price, but fees cause loss
  feeEntry: FEE_ENTRY_DECIMAL,
  feeExit: FEE_EXIT_DECIMAL,
  netMultiple: expectedNetMultiple(1.0, 1.0, FEE_ENTRY_DECIMAL, FEE_EXIT_DECIMAL), // ≈ 0.970443
  athPrice: 1.2, // Highest high
  athTimestamp: 2000,
  atlPrice: 0.9, // Lowest low
  atlTimestamp: 3000,
  maxDrawdown: 0.25, // 25% from ATH (1.2 → 0.9)
  totalCandles: 5,
};

/**
 * Gappy Timestamps: Missing candles (simulates real-world data gaps)
 *
 * POLICY: We simulate on available candles only; missing intervals don't affect results.
 * This means gaps do not prevent stop/target triggers if price moves through them.
 *
 * Fill model: Exit at last candle close (2.0)
 * ATH/ATL: Same as monotonic up (ATH = 2.0, ATL = 0.99)
 *
 * Note: Same price movement as monotonic up, so netMultiple should match
 */
export const gappyTimestamps: Candle[] = [
  { timestamp: 1000, open: 1.0, high: 1.1, low: 0.99, close: 1.1, volume: 1000 },
  // Missing 2000, 3000
  { timestamp: 4000, open: 1.3, high: 1.4, low: 1.29, close: 1.4, volume: 1300 },
  // Missing 5000
  { timestamp: 6000, open: 1.6, high: 1.7, low: 1.59, close: 1.7, volume: 1600 },
  { timestamp: 7000, open: 1.7, high: 1.8, low: 1.69, close: 1.8, volume: 1700 },
  // Missing 8000, 9000
  { timestamp: 10000, open: 1.9, high: 2.0, low: 1.89, close: 2.0, volume: 2000 },
];

export const gappyTimestampsExpected = {
  entryPrice: 1.0,
  exitPrice: 2.0,
  feeEntry: FEE_ENTRY_DECIMAL,
  feeExit: FEE_EXIT_DECIMAL,
  netMultiple: expectedNetMultiple(1.0, 2.0, FEE_ENTRY_DECIMAL, FEE_EXIT_DECIMAL), // Same as monotonic up
  athPrice: 2.0,
  athTimestamp: 10000,
  atlPrice: 0.99,
  atlTimestamp: 1000,
  totalCandles: 5, // Only 5 candles (gaps removed some)
};

/**
 * Perfect Target Hit: Price hits exact 2x target
 *
 * Fill model: Target triggers when high >= target (2.0), fills at target price (optimistic)
 * ATH/ATL: ATH = 2.1 (candle 7), ATL = 0.99 (candle 1)
 *
 * Note: Target hit at candle 6, exits immediately at 2.0
 */
export const perfectTargetHit: Candle[] = [
  { timestamp: 1000, open: 1.0, high: 1.1, low: 0.99, close: 1.05, volume: 1000 },
  { timestamp: 2000, open: 1.05, high: 1.2, low: 1.04, close: 1.15, volume: 1100 },
  { timestamp: 3000, open: 1.15, high: 1.3, low: 1.14, close: 1.25, volume: 1200 },
  { timestamp: 4000, open: 1.25, high: 1.5, low: 1.24, close: 1.4, volume: 1300 },
  { timestamp: 5000, open: 1.4, high: 1.8, low: 1.39, close: 1.7, volume: 1400 },
  { timestamp: 6000, open: 1.7, high: 2.0, low: 1.69, close: 2.0, volume: 2000 }, // Target hit! (high >= 2.0)
  { timestamp: 7000, open: 2.0, high: 2.1, low: 1.9, close: 1.95, volume: 1800 },
];

export const perfectTargetHitExpected = {
  entryPrice: 1.0,
  exitPrice: 2.0, // Target hit, fills at target price
  feeEntry: FEE_ENTRY_DECIMAL,
  feeExit: FEE_EXIT_DECIMAL,
  netMultiple: expectedNetMultiple(1.0, 2.0, FEE_ENTRY_DECIMAL, FEE_EXIT_DECIMAL), // Same as monotonic up
  athPrice: 2.1, // Highest high (after exit)
  athTimestamp: 7000,
  atlPrice: 0.99, // Lowest low
  atlTimestamp: 1000,
  targetHitEvent: true,
  exitTimestamp: 6000, // Exits when target hit
  totalCandles: 7,
};

/**
 * Multiple Profit Targets (Ladder): Price hits 1.5x, then 2x, then 3x
 *
 * Strategy: 33% at 1.5x, 33% at 2x, 34% at 3x
 * Fill model: Each target triggers when high >= target, fills at target price
 * ATH/ATL: ATH = 3.1 (candle 10), ATL = 0.99 (candle 1)
 *
 * Expected: First exit at 1.5x (candle 4), second at 2x (candle 6), final at 3x (candle 9)
 */
export const ladderTargets: Candle[] = [
  { timestamp: 1000, open: 1.0, high: 1.1, low: 0.99, close: 1.05, volume: 1000 },
  { timestamp: 2000, open: 1.05, high: 1.2, low: 1.04, close: 1.15, volume: 1100 },
  { timestamp: 3000, open: 1.15, high: 1.4, low: 1.14, close: 1.35, volume: 1200 },
  { timestamp: 4000, open: 1.35, high: 1.5, low: 1.34, close: 1.5, volume: 1300 }, // First target hit (1.5x)
  { timestamp: 5000, open: 1.5, high: 1.8, low: 1.49, close: 1.75, volume: 1400 },
  { timestamp: 6000, open: 1.75, high: 2.0, low: 1.74, close: 2.0, volume: 1500 }, // Second target hit (2x)
  { timestamp: 7000, open: 2.0, high: 2.5, low: 1.99, close: 2.4, volume: 1600 },
  { timestamp: 8000, open: 2.4, high: 2.9, low: 2.39, close: 2.85, volume: 1700 },
  { timestamp: 9000, open: 2.85, high: 3.0, low: 2.84, close: 3.0, volume: 1800 }, // Final target hit (3x)
  { timestamp: 10000, open: 3.0, high: 3.1, low: 2.9, close: 2.95, volume: 2000 },
];

export const ladderTargetsExpected = {
  entryPrice: 1.0,
  // Weighted average exit: (0.33 * 1.5 + 0.33 * 2.0 + 0.34 * 3.0) = 2.165
  weightedExitPrice: 0.33 * 1.5 + 0.33 * 2.0 + 0.34 * 3.0, // ≈ 2.165
  feeEntry: FEE_ENTRY_DECIMAL,
  feeExit: FEE_EXIT_DECIMAL,
  // Net multiple for weighted exit
  netMultiple: expectedNetMultiple(
    1.0,
    0.33 * 1.5 + 0.33 * 2.0 + 0.34 * 3.0,
    FEE_ENTRY_DECIMAL,
    FEE_EXIT_DECIMAL
  ),
  athPrice: 3.1,
  athTimestamp: 10000,
  atlPrice: 0.99,
  atlTimestamp: 1000,
  targetHits: [4000, 6000, 9000], // Timestamps when each target was hit
  totalCandles: 10,
};

/**
 * Single Candle: Edge case with only one candle
 *
 * Fill model: Entry and exit at same candle (immediate exit)
 * ATH/ATL: ATH = ATL = same candle
 */
export const singleCandle: Candle[] = [
  { timestamp: 1000, open: 1.0, high: 1.1, low: 0.9, close: 1.05, volume: 1000 },
];

export const singleCandleExpected = {
  entryPrice: 1.0,
  exitPrice: 1.05, // Exit at close
  feeEntry: FEE_ENTRY_DECIMAL,
  feeExit: FEE_EXIT_DECIMAL,
  netMultiple: expectedNetMultiple(1.0, 1.05, FEE_ENTRY_DECIMAL, FEE_EXIT_DECIMAL), // ≈ 1.0296
  athPrice: 1.1,
  athTimestamp: 1000,
  atlPrice: 0.9,
  atlTimestamp: 1000,
  totalCandles: 1,
};

/**
 * Immediate Stop Loss: Price drops below stop immediately
 *
 * Fill model: Stop loss at -30% (0.7), triggers on first candle
 * ATH/ATL: ATH = 1.0 (entry), ATL = 0.65 (candle 2)
 */
export const immediateStopLoss: Candle[] = [
  { timestamp: 1000, open: 1.0, high: 1.0, low: 0.65, close: 0.7, volume: 1000 }, // Stop loss triggers (low <= 0.7)
  { timestamp: 2000, open: 0.7, high: 0.75, low: 0.6, close: 0.65, volume: 900 },
];

export const immediateStopLossExpected = {
  entryPrice: 1.0,
  // Stop loss triggers when low <= stop price (0.7)
  // Fill model: Fills at stop price (0.7), not at low (0.65) - optimistic fill
  exitPrice: 0.7, // Fills at stop price
  feeEntry: FEE_ENTRY_DECIMAL,
  feeExit: FEE_EXIT_DECIMAL,
  netMultiple: expectedNetMultiple(1.0, 0.7, FEE_ENTRY_DECIMAL, FEE_EXIT_DECIMAL), // ≈ 0.6793
  athPrice: 1.0,
  athTimestamp: 1000,
  atlPrice: 0.6,
  atlTimestamp: 2000,
  stopLossTriggered: true,
  exitTimestamp: 1000, // Exits immediately
  totalCandles: 2,
};

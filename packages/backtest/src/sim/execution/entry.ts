/**
 * Entry Logic
 * ===========
 * Entry detection and execution logic.
 */

import type { EntryConfig, SignalGroup, IndicatorName } from '../types/index.js';
import type { Candle } from '../types/candle.js';
import type { LegacyIndicatorData } from '../indicators/registry.js';
import { evaluateSignalGroup } from '../signals/evaluator.js';

/**
 * Entry detection result
 */
export interface EntryDetectionResult {
  /** Whether entry should occur */
  shouldEnter: boolean;
  /** Entry price */
  price: number;
  /** Entry candle index */
  candleIndex: number;
  /** Entry timestamp */
  timestamp: number;
  /** Entry type */
  type: 'immediate' | 'initial_drop' | 'trailing' | 'signal' | 'ladder';
  /** Description */
  description: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Default entry configuration
 */
export const DEFAULT_ENTRY_CONFIG: EntryConfig = {
  initialEntry: 'none',
  trailingEntry: 'none',
  maxWaitTime: 60,
};

/**
 * Detect entry point based on configuration
 */
export function detectEntry(
  candles: readonly Candle[],
  startIndex: number,
  config: EntryConfig,
  indicators?: readonly LegacyIndicatorData[],
  entrySignal?: SignalGroup
): EntryDetectionResult {
  const startCandle = candles[startIndex];
  const startPrice = startCandle.open;

  // If no entry conditions, enter immediately
  if (config.initialEntry === 'none' && config.trailingEntry === 'none' && !entrySignal) {
    return {
      shouldEnter: true,
      price: startPrice,
      candleIndex: startIndex,
      timestamp: startCandle.timestamp,
      type: 'immediate',
      description: `Immediate entry at $${startPrice.toFixed(8)}`,
    };
  }

  const maxWaitTime = config.maxWaitTime ?? DEFAULT_ENTRY_CONFIG.maxWaitTime ?? 60;
  const maxWaitTimestamp = startCandle.timestamp + maxWaitTime * 60;

  // Check for initial drop entry
  if (config.initialEntry !== 'none') {
    const result = detectInitialDropEntry(
      candles,
      startIndex,
      config.initialEntry as number,
      maxWaitTimestamp,
      indicators,
      entrySignal
    );

    if (result.shouldEnter) {
      return result;
    }
  }

  // Check for trailing entry
  if (config.trailingEntry !== 'none') {
    const result = detectTrailingEntry(
      candles,
      startIndex,
      config.trailingEntry as number,
      maxWaitTimestamp,
      indicators,
      entrySignal
    );

    if (result.shouldEnter) {
      return result;
    }
  }

  // Check for signal-only entry
  if (entrySignal && indicators) {
    const result = detectSignalEntry(
      candles,
      startIndex,
      maxWaitTimestamp,
      indicators,
      entrySignal
    );

    if (result.shouldEnter) {
      return result;
    }
  }

  // No entry triggered
  return {
    shouldEnter: false,
    price: startPrice,
    candleIndex: startIndex,
    timestamp: startCandle.timestamp,
    type: 'immediate',
    description: 'No entry triggered within wait period',
  };
}

/**
 * Detect initial drop entry (wait for price to drop X%)
 */
function detectInitialDropEntry(
  candles: readonly Candle[],
  startIndex: number,
  dropPercent: number,
  maxWaitTimestamp: number,
  indicators?: readonly LegacyIndicatorData[],
  entrySignal?: SignalGroup
): EntryDetectionResult {
  const startCandle = candles[startIndex];
  const startPrice = startCandle.open;
  const triggerPrice = startPrice * (1 - Math.abs(dropPercent)); // dropPercent is negative, ensure we always calculate a drop

  for (let i = startIndex; i < candles.length; i++) {
    const candle = candles[i];

    if (candle.timestamp > maxWaitTimestamp) break;

    if (candle.low <= triggerPrice) {
      // Check signal if required
      if (entrySignal && indicators) {
        const indicator = indicators[i];
        const prevIndicator = i > 0 ? indicators[i - 1] : undefined;
        const signalResult = evaluateSignalGroup(entrySignal, {
          candle,
          indicators: indicator,
          prevIndicators: prevIndicator,
        });

        if (!signalResult.satisfied) {
          continue;
        }
      }

      return {
        shouldEnter: true,
        price: triggerPrice,
        candleIndex: i,
        timestamp: candle.timestamp,
        type: 'initial_drop',
        description: `Initial entry at $${triggerPrice.toFixed(8)} (${(Math.abs(dropPercent) * 100).toFixed(0)}% drop)`,
        metadata: { dropPercent },
      };
    }
  }

  return {
    shouldEnter: false,
    price: startPrice,
    candleIndex: startIndex,
    timestamp: startCandle.timestamp,
    type: 'initial_drop',
    description: `Price never dropped ${(Math.abs(dropPercent) * 100).toFixed(0)}%`,
  };
}

/**
 * Detect trailing entry (find lowest price, enter on X% rebound)
 */
function detectTrailingEntry(
  candles: readonly Candle[],
  startIndex: number,
  reboundPercent: number,
  maxWaitTimestamp: number,
  indicators?: readonly LegacyIndicatorData[],
  entrySignal?: SignalGroup
): EntryDetectionResult {
  const startCandle = candles[startIndex];
  const startPrice = startCandle.open;

  // Find lowest price within wait period
  let lowestPrice = startPrice;
  let lowestTimestamp = startCandle.timestamp;

  for (let i = startIndex; i < candles.length; i++) {
    const candle = candles[i];
    if (candle.timestamp > maxWaitTimestamp) break;

    if (candle.low < lowestPrice) {
      lowestPrice = candle.low;
      lowestTimestamp = candle.timestamp;
    }
  }

  const triggerPrice = lowestPrice * (1 + reboundPercent);

  // Now find when price rebounds to trigger
  for (let i = startIndex; i < candles.length; i++) {
    const candle = candles[i];
    if (candle.timestamp > maxWaitTimestamp) break;

    if (candle.high >= triggerPrice) {
      // Check signal if required
      if (entrySignal && indicators) {
        const indicator = indicators[i];
        const prevIndicator = i > 0 ? indicators[i - 1] : undefined;
        const signalResult = evaluateSignalGroup(entrySignal, {
          candle,
          indicators: indicator,
          prevIndicators: prevIndicator,
        });

        if (!signalResult.satisfied) {
          continue;
        }
      }

      return {
        shouldEnter: true,
        price: triggerPrice,
        candleIndex: i,
        timestamp: candle.timestamp,
        type: 'trailing',
        description: `Trailing entry at $${triggerPrice.toFixed(8)} (${(reboundPercent * 100).toFixed(1)}% from low)`,
        metadata: { reboundPercent, lowestPrice, lowestTimestamp },
      };
    }
  }

  return {
    shouldEnter: false,
    price: startPrice,
    candleIndex: startIndex,
    timestamp: startCandle.timestamp,
    type: 'trailing',
    description: 'Trailing entry not triggered',
    metadata: { lowestPrice, lowestTimestamp },
  };
}

/**
 * Detect signal-based entry
 */
function detectSignalEntry(
  candles: readonly Candle[],
  startIndex: number,
  maxWaitTimestamp: number,
  indicators: readonly LegacyIndicatorData[],
  entrySignal: SignalGroup
): EntryDetectionResult {
  const startCandle = candles[startIndex];

  // Determine minimum candles needed for indicators in the signal
  // EMA20 needs 20 candles, SMA20 needs 20, etc.
  const minCandlesNeeded = getMinCandlesForSignal(entrySignal);

  for (let i = startIndex; i < candles.length; i++) {
    const candle = candles[i];
    if (candle.timestamp > maxWaitTimestamp) break;

    // Skip if we don't have enough candles for indicators
    if (i < minCandlesNeeded - 1) {
      continue;
    }

    const indicator = indicators[i];
    const prevIndicator = i > 0 ? indicators[i - 1] : undefined;

    const signalResult = evaluateSignalGroup(entrySignal, {
      candle,
      indicators: indicator,
      prevIndicators: prevIndicator,
    });

    if (signalResult.satisfied) {
      return {
        shouldEnter: true,
        price: candle.close,
        candleIndex: i,
        timestamp: candle.timestamp,
        type: 'signal',
        description: `Signal entry at $${candle.close.toFixed(8)}`,
      };
    }
  }

  return {
    shouldEnter: false,
    price: startCandle.open,
    candleIndex: startIndex,
    timestamp: startCandle.timestamp,
    type: 'signal',
    description: 'Entry signal not triggered',
  };
}

/**
 * Get minimum candles needed for signal evaluation
 * Returns the maximum period required by any indicator in the signal
 */
function getMinCandlesForSignal(signal: SignalGroup): number {
  let maxPeriod = 0;

  // Check conditions
  for (const condition of signal.conditions ?? []) {
    const period = getMinCandlesForIndicator(condition.indicator);
    maxPeriod = Math.max(maxPeriod, period);
  }

  // Check nested groups
  for (const group of signal.groups ?? []) {
    const period = getMinCandlesForSignal(group);
    maxPeriod = Math.max(maxPeriod, period);
  }

  return maxPeriod;
}

/**
 * Get minimum candles needed for an indicator
 */
function getMinCandlesForIndicator(indicator: IndicatorName): number {
  switch (indicator) {
    case 'ema':
      return 20; // EMA20 is the default
    case 'sma':
      return 20; // SMA20 is the default
    case 'rsi':
      return 14; // Default RSI period
    case 'macd':
      return 26; // Slow EMA period
    case 'ichimoku_cloud':
      return 52; // Maximum of tenkan (9), kijun (26), senkou span B (52)
    case 'bbands':
      return 20; // Default period
    case 'atr':
      return 14; // Default ATR period
    case 'vwma':
      return 20; // Default period
    case 'price_change':
    case 'volume_change':
      return 1; // No warm-up needed
    default:
      return 20; // Conservative default
  }
}

/**
 * Calculate entry delay in minutes
 */
export function calculateEntryDelay(startTimestamp: number, entryTimestamp: number): number {
  return (entryTimestamp - startTimestamp) / (1000 * 60); // Convert milliseconds to minutes
}

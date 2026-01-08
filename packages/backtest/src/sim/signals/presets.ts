/**
 * Signal Presets
 * ===============
 * Predefined indicator-based signal groups for entry and exit triggers.
 * These can be combined to create complex trading strategies.
 */

import type { SignalGroup } from '../config.js';

/**
 * Signal preset registry
 */
const signalPresets = new Map<string, SignalGroup>();

// ============================================================================
// ENTRY SIGNAL PRESETS
// ============================================================================

/**
 * RSI Oversold Entry
 * Enters when RSI drops below 30 (oversold condition)
 */
signalPresets.set('entry-rsi-oversold', {
  id: 'entry-rsi-oversold',
  logic: 'AND',
  conditions: [
    {
      indicator: 'rsi',
      field: 'value',
      operator: '<',
      value: 30,
    },
  ],
});

/**
 * RSI Overbought Entry (for shorting/reversal)
 * Enters when RSI rises above 70 (overbought condition)
 */
signalPresets.set('entry-rsi-overbought', {
  id: 'entry-rsi-overbought',
  logic: 'AND',
  conditions: [
    {
      indicator: 'rsi',
      field: 'value',
      operator: '>',
      value: 70,
    },
  ],
});

/**
 * MACD Bullish Crossover Entry
 * Enters when MACD line crosses above signal line
 */
signalPresets.set('entry-macd-bullish-cross', {
  id: 'entry-macd-bullish-cross',
  logic: 'AND',
  conditions: [
    {
      indicator: 'macd',
      secondaryIndicator: 'macd',
      field: 'signal',
      operator: 'crosses_above',
    },
  ],
});

/**
 * MACD Bearish Crossover Entry (for shorting)
 * Enters when MACD line crosses below signal line
 */
signalPresets.set('entry-macd-bearish-cross', {
  id: 'entry-macd-bearish-cross',
  logic: 'AND',
  conditions: [
    {
      indicator: 'macd',
      secondaryIndicator: 'macd',
      field: 'signal',
      operator: 'crosses_below',
    },
  ],
});

/**
 * Price Above SMA20 Entry
 * Enters when price crosses above 20-period SMA
 */
signalPresets.set('entry-price-above-sma20', {
  id: 'entry-price-above-sma20',
  logic: 'AND',
  conditions: [
    {
      indicator: 'price_change',
      field: 'close',
      secondaryIndicator: 'sma',
      operator: 'crosses_above',
    },
  ],
});

/**
 * Price Below SMA20 Entry (for shorting)
 * Enters when price crosses below 20-period SMA
 */
signalPresets.set('entry-price-below-sma20', {
  id: 'entry-price-below-sma20',
  logic: 'AND',
  conditions: [
    {
      indicator: 'price_change',
      field: 'close',
      secondaryIndicator: 'sma',
      operator: 'crosses_below',
    },
  ],
});

/**
 * EMA Golden Cross Entry
 * Enters when fast EMA (20) crosses above slow EMA (50)
 */
signalPresets.set('entry-ema-golden-cross', {
  id: 'entry-ema-golden-cross',
  logic: 'AND',
  conditions: [
    {
      indicator: 'ema',
      secondaryIndicator: 'ema',
      field: 'value',
      operator: 'crosses_above',
    },
  ],
});

/**
 * Ichimoku Cloud Bullish Entry
 * Enters when price is above Ichimoku cloud and cloud is bullish
 */
signalPresets.set('entry-ichimoku-bullish', {
  id: 'entry-ichimoku-bullish',
  logic: 'AND',
  conditions: [
    {
      indicator: 'ichimoku_cloud',
      field: 'isBullish',
      operator: '==',
      value: 1,
    },
    {
      indicator: 'price_change',
      field: 'close',
      secondaryIndicator: 'ichimoku_cloud',
      operator: '>',
    },
  ],
});

/**
 * Volume Spike Entry
 * Enters when volume increases significantly (2x average)
 */
signalPresets.set('entry-volume-spike', {
  id: 'entry-volume-spike',
  logic: 'AND',
  conditions: [
    {
      indicator: 'volume_change',
      field: 'value',
      operator: '>',
      value: 2.0, // 2x average volume
    },
  ],
});

/**
 * Combined: RSI Oversold + Volume Spike
 * Enters when RSI is oversold AND volume spikes
 */
signalPresets.set('entry-rsi-oversold-volume-spike', {
  id: 'entry-rsi-oversold-volume-spike',
  logic: 'AND',
  conditions: [
    {
      indicator: 'rsi',
      field: 'value',
      operator: '<',
      value: 30,
    },
    {
      indicator: 'volume_change',
      field: 'value',
      operator: '>',
      value: 1.5,
    },
  ],
});

// ============================================================================
// EXIT SIGNAL PRESETS
// ============================================================================

/**
 * RSI Overbought Exit
 * Exits when RSI rises above 70 (overbought condition)
 */
signalPresets.set('exit-rsi-overbought', {
  id: 'exit-rsi-overbought',
  logic: 'AND',
  conditions: [
    {
      indicator: 'rsi',
      field: 'value',
      operator: '>',
      value: 70,
    },
  ],
});

/**
 * RSI Oversold Exit (for shorts)
 * Exits when RSI drops below 30 (oversold condition)
 */
signalPresets.set('exit-rsi-oversold', {
  id: 'exit-rsi-oversold',
  logic: 'AND',
  conditions: [
    {
      indicator: 'rsi',
      field: 'value',
      operator: '<',
      value: 30,
    },
  ],
});

/**
 * MACD Bearish Crossover Exit
 * Exits when MACD line crosses below signal line
 */
signalPresets.set('exit-macd-bearish-cross', {
  id: 'exit-macd-bearish-cross',
  logic: 'AND',
  conditions: [
    {
      indicator: 'macd',
      secondaryIndicator: 'macd',
      field: 'signal',
      operator: 'crosses_below',
    },
  ],
});

/**
 * Price Below SMA20 Exit
 * Exits when price crosses below 20-period SMA
 */
signalPresets.set('exit-price-below-sma20', {
  id: 'exit-price-below-sma20',
  logic: 'AND',
  conditions: [
    {
      indicator: 'price_change',
      field: 'close',
      secondaryIndicator: 'sma',
      operator: 'crosses_below',
    },
  ],
});

/**
 * EMA Death Cross Exit
 * Exits when fast EMA (20) crosses below slow EMA (50)
 */
signalPresets.set('exit-ema-death-cross', {
  id: 'exit-ema-death-cross',
  logic: 'AND',
  conditions: [
    {
      indicator: 'ema',
      secondaryIndicator: 'ema',
      field: 'value',
      operator: 'crosses_below',
    },
  ],
});

/**
 * Ichimoku Cloud Bearish Exit
 * Exits when price falls below Ichimoku cloud or cloud turns bearish
 */
signalPresets.set('exit-ichimoku-bearish', {
  id: 'exit-ichimoku-bearish',
  logic: 'OR',
  conditions: [
    {
      indicator: 'ichimoku_cloud',
      field: 'isBearish',
      operator: '==',
      value: 1,
    },
    {
      indicator: 'price_change',
      field: 'close',
      secondaryIndicator: 'ichimoku_cloud',
      operator: '<',
    },
  ],
});

/**
 * Volume Drying Up Exit
 * Exits when volume drops significantly (below 0.5x average)
 */
signalPresets.set('exit-volume-dry', {
  id: 'exit-volume-dry',
  logic: 'AND',
  conditions: [
    {
      indicator: 'volume_change',
      field: 'value',
      operator: '<',
      value: 0.5,
    },
  ],
});

// ============================================================================
// COMBINED PRESETS (Entry + Exit)
// ============================================================================

/**
 * Momentum Strategy: MACD Bullish Cross Entry + Bearish Cross Exit
 */
signalPresets.set('strategy-momentum-macd', {
  id: 'strategy-momentum-macd',
  logic: 'AND',
  groups: [
    signalPresets.get('entry-macd-bullish-cross')!,
    signalPresets.get('exit-macd-bearish-cross')!,
  ],
});

/**
 * Mean Reversion: RSI Oversold Entry + RSI Overbought Exit
 */
signalPresets.set('strategy-mean-reversion-rsi', {
  id: 'strategy-mean-reversion-rsi',
  logic: 'AND',
  groups: [signalPresets.get('entry-rsi-oversold')!, signalPresets.get('exit-rsi-overbought')!],
});

/**
 * Trend Following: EMA Golden Cross Entry + Death Cross Exit
 */
signalPresets.set('strategy-trend-ema', {
  id: 'strategy-trend-ema',
  logic: 'AND',
  groups: [
    signalPresets.get('entry-ema-golden-cross')!,
    signalPresets.get('exit-ema-death-cross')!,
  ],
});

// ============================================================================
// API
// ============================================================================

/**
 * Get a signal preset by name
 */
export function getSignalPreset(name: string): SignalGroup | null {
  return signalPresets.get(name) || null;
}

/**
 * List all available signal preset names
 */
export function listSignalPresets(): string[] {
  return Array.from(signalPresets.keys());
}

/**
 * Get signal presets by category
 */
export function getSignalPresetsByCategory(category: 'entry' | 'exit' | 'strategy'): string[] {
  return Array.from(signalPresets.keys()).filter((name) => name.startsWith(category + '-'));
}

/**
 * Register a new signal preset
 */
export function registerSignalPreset(name: string, signal: SignalGroup): void {
  signalPresets.set(name, signal);
}

/**
 * Combine multiple signal presets into a single group
 */
export function combineSignalPresets(
  names: string[],
  logic: 'AND' | 'OR' = 'AND'
): SignalGroup | null {
  const signals: SignalGroup[] = [];
  for (const name of names) {
    const preset = getSignalPreset(name);
    if (!preset) {
      return null; // Invalid preset name
    }
    signals.push(preset);
  }

  if (signals.length === 0) {
    return null;
  }

  if (signals.length === 1) {
    return signals[0]!;
  }

  return {
    id: `combined-${names.join('-')}`,
    logic,
    groups: signals,
  };
}

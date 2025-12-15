/**
 * Strategy Presets
 *
 * Predefined strategy configurations
 */

import { StrategyConfig, StrategyPresetName } from './types';

const presets: Map<StrategyPresetName, StrategyConfig> = new Map();

// Basic 6h strategy with 20% stop loss
presets.set('basic-6h-20pct-sl', {
  name: 'Basic_6h_20pctSL',
  profitTargets: [],
  stopLoss: {
    initial: -0.2,
  },
  holdHours: 6,
});

// Conservative 24h strategy
presets.set('conservative-24h', {
  name: 'Conservative_24h',
  profitTargets: [
    { target: 2.0, percent: 0.5 },
    { target: 3.0, percent: 0.3 },
    { target: 5.0, percent: 0.2 },
  ],
  stopLoss: {
    initial: -0.3,
    trailing: 2.0,
    trailingPercent: 0.2,
  },
  holdHours: 24,
});

// Aggressive multi-take-profit
presets.set('aggressive-multi-tp', {
  name: 'Aggressive_MultiTP',
  profitTargets: [
    { target: 2.0, percent: 0.2 },
    { target: 5.0, percent: 0.3 },
    { target: 10.0, percent: 0.5 },
  ],
  stopLoss: {
    initial: -0.4,
  },
  holdHours: 24,
});

// Trailing stop 20%
presets.set('trailing-stop-20pct', {
  name: 'Trailing_20pct',
  profitTargets: [
    { target: 2.0, percent: 0.3 },
    { target: 3.0, percent: 0.3 },
  ],
  stopLoss: {
    initial: -0.2,
    trailing: 2.0,
    trailingPercent: 0.2,
  },
  holdHours: 24,
});

// Buy the dip 30%
presets.set('buy-the-dip-30pct', {
  name: 'BuyTheDip_30pct',
  profitTargets: [
    { target: 2.0, percent: 0.5 },
    { target: 5.0, percent: 0.5 },
  ],
  stopLoss: {
    initial: -0.2,
  },
  entry: {
    initialEntry: -0.3,
    maxWaitTime: 60,
  },
  holdHours: 6,
});

/**
 * Get a strategy preset by name
 */
export function getPreset(name: StrategyPresetName): StrategyConfig | null {
  return presets.get(name) || null;
}

/**
 * Register a new preset
 */
export function registerPreset(name: StrategyPresetName, config: StrategyConfig): void {
  presets.set(name, config);
}

/**
 * List all available preset names
 */
export function listPresets(): StrategyPresetName[] {
  return Array.from(presets.keys());
}

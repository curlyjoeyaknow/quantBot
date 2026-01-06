/**
 * Strategy Builder
 *
 * Builds strategy configurations from various inputs
 */

import { StrategyConfig, StrategyPresetName, TakeProfitLevel } from '../types/index.js';
import { getPreset } from './presets.js';
import { Strategy } from '../engine.js';

/**
 * Converts StrategyConfig to the format expected by simulateStrategy
 */
export function buildStrategy(config: StrategyConfig): Strategy[] {
  // For now we continue to map profit targets directly to the engine's
  // Strategy representation. Laddered exits are handled separately and can
  // override or extend these at execution time.
  return config.profitTargets.map((tp: TakeProfitLevel) => ({
    target: tp.target,
    percent: tp.percent,
  }));
}

/**
 * Converts StrategyConfig to StopLossConfig format
 */
export function buildStopLossConfig(
  config: StrategyConfig
): import('../engine.js').StopLossConfig | undefined {
  if (!config.stopLoss) {
    return undefined;
  }

  return {
    initial: config.stopLoss.initial,
    trailing: config.stopLoss.trailing ?? 'none',
  };
}

/**
 * Converts StrategyConfig to EntryConfig format
 */
export function buildEntryConfig(
  config: StrategyConfig
): import('../engine.js').EntryConfig | undefined {
  if (!config.entry) {
    return undefined;
  }

  return {
    initialEntry: config.entry.initialEntry ?? 'none',
    trailingEntry: config.entry.trailingEntry ?? 'none',
    maxWaitTime: config.entry.maxWaitTime ?? 60,
  };
}

/**
 * Converts StrategyConfig to ReEntryConfig format
 */
export function buildReEntryConfig(
  config: StrategyConfig
): import('../engine.js').ReEntryConfig | undefined {
  if (!config.reEntry) {
    return undefined;
  }

  return {
    trailingReEntry: config.reEntry.trailingReEntry ?? 'none',
    maxReEntries: config.reEntry.maxReEntries ?? 0,
    sizePercent: config.reEntry.sizePercent ?? 0.5,
  };
}

/**
 * Build a strategy from a preset name
 */
export function buildFromPreset(presetName: StrategyPresetName): StrategyConfig | null {
  return getPreset(presetName);
}

/**
 * Validate a strategy configuration
 */
export function validateStrategy(config: StrategyConfig): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  // Validate name
  if (!config.name || config.name.trim() === '') {
    errors.push('Strategy name is required');
  }

  // Validate profit targets
  if (!config.profitTargets || config.profitTargets.length === 0) {
    errors.push('At least one profit target is required');
  } else {
    const totalPercent = config.profitTargets.reduce((sum, tp) => sum + tp.percent, 0);
    if (totalPercent > 1.0) {
      errors.push(`Total profit target percent (${totalPercent}) exceeds 1.0`);
    }
    if (totalPercent < 0) {
      errors.push('Profit target percent cannot be negative');
    }
    for (const tp of config.profitTargets) {
      if (tp.target <= 0) {
        errors.push(`Profit target multiplier must be positive, got ${tp.target}`);
      }
      if (tp.percent <= 0 || tp.percent > 1) {
        errors.push(`Profit target percent must be between 0 and 1, got ${tp.percent}`);
      }
    }
  }

  // Validate stop loss
  if (config.stopLoss) {
    if (config.stopLoss.initial > 0) {
      errors.push('Stop loss initial should be negative (e.g., -0.3 for -30%)');
    }
    if (config.stopLoss.trailing !== 'none' && config.stopLoss.trailing !== undefined) {
      if (typeof config.stopLoss.trailing === 'number' && config.stopLoss.trailing < 0) {
        errors.push('Trailing stop activation should be positive');
      }
      if (config.stopLoss.trailingPercent !== undefined) {
        if (config.stopLoss.trailingPercent <= 0 || config.stopLoss.trailingPercent >= 1) {
          errors.push('Trailing stop percent should be between 0 and 1');
        }
      }
    }
  }

  // Validate entry config
  if (config.entry) {
    if (config.entry.initialEntry !== 'none' && typeof config.entry.initialEntry === 'number') {
      if (config.entry.initialEntry > 0) {
        errors.push('Initial entry drop should be negative (e.g., -0.3 for 30% drop)');
      }
    }
    if (config.entry.trailingEntry !== 'none' && typeof config.entry.trailingEntry === 'number') {
      if (config.entry.trailingEntry < 0) {
        errors.push('Trailing entry rebound should be positive (e.g., 0.1 for 10% rebound)');
      }
    }
    if (config.entry.maxWaitTime !== undefined && config.entry.maxWaitTime < 0) {
      errors.push('Max wait time must be non-negative');
    }
  }

  // Validate re-entry config
  if (config.reEntry) {
    if (
      config.reEntry.trailingReEntry !== 'none' &&
      typeof config.reEntry.trailingReEntry === 'number'
    ) {
      if (config.reEntry.trailingReEntry <= 0 || config.reEntry.trailingReEntry >= 1) {
        errors.push('Trailing re-entry percent should be between 0 and 1');
      }
    }
    if (config.reEntry.maxReEntries !== undefined && config.reEntry.maxReEntries < 0) {
      errors.push('Max re-entries must be non-negative');
    }
  }

  // Validate hold hours
  if (config.holdHours !== undefined && config.holdHours < 0) {
    errors.push('Hold hours must be non-negative');
  }

  // Validate loss clamp
  if (config.lossClampPercent !== undefined) {
    if (config.lossClampPercent < 0 || config.lossClampPercent >= 1) {
      errors.push('Loss clamp percent should be between 0 and 1');
    }
  }

  // Validate min exit price
  if (config.minExitPrice !== undefined) {
    if (config.minExitPrice < 0 || config.minExitPrice >= 1) {
      errors.push('Min exit price should be between 0 and 1 (as fraction of entry)');
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

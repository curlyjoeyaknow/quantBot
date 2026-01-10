/**
 * Strategy DSL Validator
 *
 * Validates strategy DSL against schema and performs logical consistency checks.
 */

import type { StrategyDSL } from './dsl-schema.js';
import { validateStrategyDSL } from './dsl-schema.js';

/**
 * Logical consistency validation result
 */
export interface ConsistencyCheck {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate strategy DSL schema
 */
export function validateSchema(dsl: unknown): { valid: boolean; errors: string[] } {
  return validateStrategyDSL(dsl);
}

/**
 * Check logical consistency of strategy DSL
 */
export function validateConsistency(dsl: StrategyDSL): ConsistencyCheck {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check entry conditions
  if (dsl.entry.type === 'price_drop' && !dsl.entry.priceDropPercent) {
    errors.push('Entry type "price_drop" requires priceDropPercent');
  }

  if (dsl.entry.type === 'trailing_rebound' && !dsl.entry.reboundPercent) {
    errors.push('Entry type "trailing_rebound" requires reboundPercent');
  }

  if (dsl.entry.type === 'signal' && !dsl.entry.signal) {
    errors.push('Entry type "signal" requires signal configuration');
  }

  // Check exit conditions
  for (const exit of dsl.exit) {
    if (exit.type === 'profit_target' && exit.profitTarget === undefined) {
      errors.push('Exit type "profit_target" requires profitTarget');
    }

    if (exit.type === 'profit_target' && exit.percentToExit === undefined) {
      errors.push('Exit type "profit_target" requires percentToExit');
    }

    if (exit.type === 'stop_loss' && exit.stopLossPercent === undefined) {
      errors.push('Exit type "stop_loss" requires stopLossPercent');
    }

    if (exit.type === 'signal' && !exit.signal) {
      errors.push('Exit type "signal" requires signal configuration');
    }

    if (exit.type === 'time' && exit.holdHours === undefined) {
      errors.push('Exit type "time" requires holdHours');
    }

    if (exit.type === 'ladder' && !exit.ladder) {
      errors.push('Exit type "ladder" requires ladder configuration');
    }
  }

  // Check re-entry conditions
  if (dsl.reEntry?.enabled) {
    if (dsl.reEntry.type === 'trailing_retrace' && !dsl.reEntry.retracePercent) {
      errors.push('Re-entry type "trailing_retrace" requires retracePercent');
    }

    if (dsl.reEntry.type === 'signal' && !dsl.reEntry.signal) {
      errors.push('Re-entry type "signal" requires signal configuration');
    }

    if (!dsl.reEntry.maxReEntries) {
      warnings.push('Re-entry enabled but maxReEntries not set (defaults to unlimited)');
    }
  }

  // Check position sizing
  if (dsl.positionSizing) {
    if (dsl.positionSizing.type === 'percent_of_capital' && dsl.positionSizing.value > 1) {
      errors.push('Position sizing "percent_of_capital" value must be <= 1');
    }

    if (dsl.positionSizing.type === 'risk_based' && dsl.positionSizing.value > 1) {
      errors.push('Position sizing "risk_based" value should typically be <= 0.05 (5%)');
    }
  }

  // Check risk constraints
  if (dsl.risk) {
    if (dsl.risk.maxLossPercent && dsl.risk.maxLossPercent > 0) {
      errors.push('maxLossPercent must be negative (e.g., -0.2 for -20%)');
    }

    // Check if stop loss is more aggressive than max loss
    const stopLossPercent = dsl.exit.find(
      (e: { type: string }) => e.type === 'stop_loss'
    )?.stopLossPercent;
    if (stopLossPercent && dsl.risk.maxLossPercent) {
      if (stopLossPercent < dsl.risk.maxLossPercent) {
        warnings.push(
          `Stop loss (${stopLossPercent}) is more aggressive than max loss constraint (${dsl.risk.maxLossPercent})`
        );
      }
    }
  }

  // Check exit percentages sum to <= 1
  const exitPercentSum = dsl.exit
    .filter(
      (e: { type: string; percentToExit?: number }) => e.type === 'profit_target' && e.percentToExit
    )
    .reduce((sum: number, e: { percentToExit?: number }) => sum + (e.percentToExit || 0), 0);

  if (exitPercentSum > 1) {
    errors.push(`Exit percentages sum to ${exitPercentSum} (must be <= 1)`);
  }

  // Check ladder exit percentages sum to <= 1
  for (const exit of dsl.exit) {
    if (exit.type === 'ladder' && exit.ladder) {
      const ladderSum = exit.ladder.legs.reduce(
        (sum: number, leg: { sizePercent: number }) => sum + leg.sizePercent,
        0
      );
      if (ladderSum > 1) {
        errors.push(`Ladder exit percentages sum to ${ladderSum} (must be <= 1)`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Full validation: schema + consistency
 */
export function validateFull(dsl: unknown): {
  schemaValid: boolean;
  consistencyValid: boolean;
  schemaErrors: string[];
  consistencyErrors: string[];
  warnings: string[];
} {
  const schemaResult = validateSchema(dsl);

  if (!schemaResult.valid) {
    return {
      schemaValid: false,
      consistencyValid: false,
      schemaErrors: schemaResult.errors,
      consistencyErrors: [],
      warnings: [],
    };
  }

  const consistencyResult = validateConsistency(dsl as StrategyDSL);

  return {
    schemaValid: true,
    consistencyValid: consistencyResult.valid,
    schemaErrors: [],
    consistencyErrors: consistencyResult.errors,
    warnings: consistencyResult.warnings,
  };
}

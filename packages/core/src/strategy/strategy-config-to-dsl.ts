/**
 * Strategy Config to DSL Converter
 *
 * Converts old StrategyConfig format to new StrategyDSL format.
 */

import type { StrategyDSL } from './dsl-schema.js';
import type {
  StrategyConfig,
  StrategyLeg,
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
} from '@quantbot/simulation';

/**
 * Convert legacy StrategyConfig to StrategyDSL
 */
export function convertStrategyConfigToDSL(config: StrategyConfig): StrategyDSL {
  // Convert entry condition
  const entry = convertEntryConfig(config.entry, config.entrySignal);

  // Convert exit conditions
  const exit = convertExitConditions(
    config.profitTargets,
    config.stopLoss,
    config.exitSignal,
    config.holdHours,
    config.exitLadder
  );

  // Convert re-entry condition
  const reEntry = convertReEntryConfig(config.reEntry);

  // Convert risk constraints
  const risk = convertRiskConstraints(config.lossClampPercent, config.minExitPrice);

  // Build DSL
  const dsl: StrategyDSL = {
    version: '1.0.0',
    name: config.name,
    description: config.metadata?.description as string | undefined,
    tags: (config.metadata?.tags as string[] | undefined) || [],
    entry,
    exit,
  };

  if (reEntry) {
    dsl.reEntry = reEntry;
  }

  if (risk && (risk.maxLossPercent || risk.minExitPrice)) {
    dsl.risk = risk;
  }

  // Convert costs if present in metadata
  if (config.metadata?.costs) {
    dsl.costs = config.metadata.costs as StrategyDSL['costs'];
  }

  if (config.metadata) {
    dsl.metadata = config.metadata;
  }

  return dsl;
}

/**
 * Convert entry config to DSL entry condition
 */
function convertEntryConfig(
  entryConfig: EntryConfig | undefined,
  entrySignal: StrategyConfig['entrySignal']
): StrategyDSL['entry'] {
  // If signal-based entry, use signal type
  if (entrySignal) {
    return {
      type: 'signal',
      signal: entrySignal,
      maxWaitMinutes: entryConfig?.maxWaitTime || 1440,
    };
  }

  // If no entry config, use immediate
  if (!entryConfig) {
    return {
      type: 'immediate',
    };
  }

  // Check for price drop entry
  if (entryConfig.initialEntry !== undefined && entryConfig.initialEntry !== 'none') {
    return {
      type: 'price_drop',
      priceDropPercent: entryConfig.initialEntry,
      maxWaitMinutes: entryConfig.maxWaitTime,
    };
  }

  // Check for trailing rebound entry
  if (entryConfig.trailingEntry !== undefined && entryConfig.trailingEntry !== 'none') {
    return {
      type: 'trailing_rebound',
      reboundPercent: entryConfig.trailingEntry,
      maxWaitMinutes: entryConfig.maxWaitTime,
    };
  }

  // Default to immediate
  return {
    type: 'immediate',
  };
}

/**
 * Convert profit targets and stop loss to exit conditions
 */
function convertExitConditions(
  profitTargets: StrategyLeg[] | undefined,
  stopLoss: StopLossConfig | undefined,
  exitSignal: StrategyConfig['exitSignal'],
  holdHours: number | undefined,
  exitLadder: StrategyConfig['exitLadder']
): StrategyDSL['exit'] {
  const exits: StrategyDSL['exit'] = [];

  // Add profit targets
  if (profitTargets && profitTargets.length > 0) {
    for (const target of profitTargets) {
      exits.push({
        type: 'profit_target',
        profitTarget: target.target,
        percentToExit: target.percent,
      });
    }
  }

  // Add stop loss
  if (stopLoss) {
    exits.push({
      type: 'stop_loss',
      stopLossPercent: stopLoss.initial,
      trailingStopThreshold: stopLoss.trailing === 'none' ? undefined : stopLoss.trailing,
      trailingStopPercent: stopLoss.trailingPercent,
    });
  }

  // Add time-based exit if holdHours is specified
  if (holdHours !== undefined) {
    // Check if we already have a time exit (shouldn't happen, but be safe)
    const hasTimeExit = exits.some((e) => e.type === 'time');
    if (!hasTimeExit) {
      exits.push({
        type: 'time',
        holdHours,
      });
    }
  }

  // Add signal-based exit
  if (exitSignal) {
    exits.push({
      type: 'signal',
      signal: exitSignal,
    });
  }

  // Add ladder exit
  if (exitLadder) {
    exits.push({
      type: 'ladder',
      ladder: {
        legs: exitLadder.legs.map((leg) => ({
          id: leg.id,
          sizePercent: leg.sizePercent,
          priceOffset: leg.priceOffset,
          multiple: leg.multiple,
          signal: leg.signal,
        })),
        sequential: exitLadder.sequential,
      },
    });
  }

  // Ensure at least one exit (default to 2x target if none)
  if (exits.length === 0) {
    exits.push({
      type: 'profit_target',
      profitTarget: 2.0,
      percentToExit: 1.0,
    });
  }

  return exits;
}

/**
 * Convert re-entry config to DSL re-entry condition
 */
function convertReEntryConfig(
  reEntryConfig: ReEntryConfig | undefined
): StrategyDSL['reEntry'] | undefined {
  if (!reEntryConfig) {
    return undefined;
  }

  if (reEntryConfig.trailingReEntry === 'none' || reEntryConfig.maxReEntries === 0) {
    return {
      enabled: false,
    };
  }

  return {
    enabled: true,
    type: 'trailing_retrace',
    retracePercent:
      typeof reEntryConfig.trailingReEntry === 'number' ? reEntryConfig.trailingReEntry : undefined,
    maxReEntries: reEntryConfig.maxReEntries,
    sizePercent: reEntryConfig.sizePercent,
  };
}

/**
 * Convert risk constraints
 */
function convertRiskConstraints(
  lossClampPercent: number | undefined,
  minExitPrice: number | undefined
): StrategyDSL['risk'] | undefined {
  if (!lossClampPercent && !minExitPrice) {
    return undefined;
  }

  return {
    maxLossPercent: lossClampPercent,
    minExitPrice,
  };
}

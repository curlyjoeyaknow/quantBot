/**
 * DSL to SimInput Converter
 *
 * Converts Strategy DSL to SimInput format for simulation execution.
 */

import type { StrategyDSL } from './dsl-schema.js';

/**
 * Entry configuration (matches SimInput format)
 */
export interface EntryConfig {
  initialEntry: number | 'none';
  trailingEntry: number | 'none';
  maxWaitTime: number;
}

/**
 * Exit configuration (matches SimInput format)
 */
export interface ExitConfig {
  profit_targets: Array<{ target: number; percent: number }>;
  stop_loss?: {
    initial: number;
    trailing?: number | 'none';
    trailingPercent?: number;
    trailingWindowSize?: number;
  };
}

/**
 * Re-entry configuration (matches SimInput format)
 */
export interface ReEntryConfig {
  trailingReEntry: number | 'none';
  maxReEntries: number;
  sizePercent: number;
}

/**
 * Cost configuration (matches SimInput format)
 */
export interface CostConfig {
  entrySlippageBps?: number;
  exitSlippageBps?: number;
  takerFeeBps?: number;
  makerFeeBps?: number;
  borrowAprBps?: number;
}

/**
 * Convert Strategy DSL to SimInput format
 *
 * This is a complex mapping because:
 * - DSL has entry/exit as structured conditions with types
 * - SimInput expects specific config structures (entry_config, exit_config)
 * - Need to handle different entry/exit types and map them appropriately
 */
export function convertDSLToSimInput(
  dsl: StrategyDSL,
  runId: string,
  strategyId: string,
  mint: string,
  alertTimestamp: string,
  candles: Array<{ timestamp: number; open: number; high: number; low: number; close: number; volume: number }>
): {
  run_id: string;
  strategy_id: string;
  mint: string;
  alert_timestamp: string;
  candles: typeof candles;
  entry_config: EntryConfig;
  exit_config: ExitConfig;
  reentry_config?: ReEntryConfig;
  cost_config?: CostConfig;
  strategyVersion?: string;
} {
  // Convert entry condition
  const entry_config: EntryConfig = convertEntryCondition(dsl.entry);

  // Convert exit conditions
  const exit_config: ExitConfig = convertExitConditions(dsl.exit);

  // Convert re-entry condition
  const reentry_config: ReEntryConfig | undefined = dsl.reEntry?.enabled
    ? convertReEntryCondition(dsl.reEntry)
    : undefined;

  // Convert cost configuration
  const cost_config: CostConfig | undefined = dsl.costs
    ? convertCostConfig(dsl.costs)
    : undefined;

  return {
    run_id: runId,
    strategy_id: strategyId,
    mint,
    alert_timestamp: alertTimestamp,
    candles,
    entry_config,
    exit_config,
    reentry_config,
    cost_config,
    strategyVersion: dsl.version,
  };
}

/**
 * Convert DSL entry condition to EntryConfig
 */
function convertEntryCondition(
  entry: StrategyDSL['entry']
): EntryConfig {
  switch (entry.type) {
    case 'immediate':
      return {
        initialEntry: 'none',
        trailingEntry: 'none',
        maxWaitTime: 60, // Default
      };

    case 'price_drop':
      return {
        initialEntry: entry.priceDropPercent || -0.3,
        trailingEntry: 'none',
        maxWaitTime: entry.maxWaitMinutes || 60,
      };

    case 'trailing_rebound':
      return {
        initialEntry: 'none',
        trailingEntry: entry.reboundPercent || 0.1,
        maxWaitTime: entry.maxWaitMinutes || 60,
      };

    case 'signal':
      // Signal-based entries are handled separately in the engine
      // For now, use immediate entry with signal metadata
      return {
        initialEntry: 'none',
        trailingEntry: 'none',
        maxWaitTime: entry.maxWaitMinutes || 1440, // 24 hours default for signal-based
      };

    default:
      throw new Error(`Unsupported entry type: ${(entry as { type: string }).type}`);
  }
}

/**
 * Convert DSL exit conditions to ExitConfig
 */
function convertExitConditions(exits: StrategyDSL['exit']): ExitConfig {
  const profit_targets: Array<{ target: number; percent: number }> = [];
  let stop_loss: ExitConfig['stop_loss'] | undefined;

  for (const exit of exits) {
    switch (exit.type) {
      case 'profit_target':
        if (exit.profitTarget && exit.percentToExit) {
          profit_targets.push({
            target: exit.profitTarget,
            percent: exit.percentToExit,
          });
        }
        break;

      case 'stop_loss':
        stop_loss = {
          initial: exit.stopLossPercent || -0.5,
          trailing: exit.trailingStopThreshold || 'none',
          trailingPercent: exit.trailingStopPercent,
        };
        break;

      case 'signal':
        // Signal-based exits are handled separately in the engine
        // For now, we don't convert them here - they need to be handled in the engine
        break;

      case 'time':
        // Time-based exits are handled separately in the engine
        break;

      case 'ladder':
        // Ladder exits are handled separately in the engine
        // Could convert to multiple profit targets if sequential
        if (exit.ladder?.sequential) {
          for (const leg of exit.ladder.legs) {
            if (leg.multiple) {
              profit_targets.push({
                target: leg.multiple,
                percent: leg.sizePercent,
              });
            }
          }
        }
        break;
    }
  }

  // Ensure at least one profit target
  if (profit_targets.length === 0) {
    profit_targets.push({
      target: 2.0,
      percent: 1.0,
    });
  }

  return {
    profit_targets,
    stop_loss,
  };
}

/**
 * Convert DSL re-entry condition to ReEntryConfig
 */
function convertReEntryCondition(
  reEntry: NonNullable<StrategyDSL['reEntry']>
): ReEntryConfig {
  if (!reEntry.enabled) {
    return {
      trailingReEntry: 'none',
      maxReEntries: 0,
      sizePercent: 0.5,
    };
  }

  switch (reEntry.type) {
    case 'trailing_retrace':
      return {
        trailingReEntry: reEntry.retracePercent || 0.5,
        maxReEntries: reEntry.maxReEntries || 3,
        sizePercent: reEntry.sizePercent || 0.5,
      };

    case 'signal':
      // Signal-based re-entries are handled separately
      // Use a default trailing re-entry for now
      return {
        trailingReEntry: 0.5,
        maxReEntries: reEntry.maxReEntries || 3,
        sizePercent: reEntry.sizePercent || 0.5,
      };

    default:
      return {
        trailingReEntry: 'none',
        maxReEntries: reEntry.maxReEntries || 0,
        sizePercent: reEntry.sizePercent || 0.5,
      };
  }
}

/**
 * Convert DSL cost config to CostConfig
 */
function convertCostConfig(costs: NonNullable<StrategyDSL['costs']>): CostConfig {
  return {
    entrySlippageBps: costs.entrySlippageBps,
    exitSlippageBps: costs.exitSlippageBps,
    takerFeeBps: costs.feePercent ? costs.feePercent * 10000 : undefined,
    // Note: fixedFee is not directly supported in SimInput CostConfig
    // Would need to be converted to a percentage-based fee
  };
}


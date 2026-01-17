/**
 * Contract Adapter
 *
 * Adapts canonical SimInput/SimResult contracts to/from the internal simulator format.
 * This allows the simulator to work with the canonical contract format while
 * maintaining compatibility with existing code.
 */

import type { SimInput, SimResult, SimEvent } from '../types/contracts.js';
import { SimInputSchema, SimResultSchema } from '../types/contracts.js';
import type {
  Candle,
  StrategyLeg,
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  CostConfig,
} from '../types/index.js';
import type { ExecutionModel } from '../types/execution-model.js';
import { seedFromString } from '@quantbot/core';
import { simulateStrategy } from './simulator.js';

/**
 * Convert canonical SimInput to internal simulator format and run simulation
 *
 * @param input - Canonical simulation input
 * @returns Canonical simulation result
 */
export async function simulateFromInput(input: SimInput): Promise<SimResult> {
  // Validate input
  const validatedInput = SimInputSchema.parse(input);

  // Convert candles to internal format
  const candles: Candle[] = validatedInput.candles.map((c) => ({
    timestamp: c.timestamp,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));

  // Convert exit config to strategy legs
  const strategy: StrategyLeg[] = validatedInput.exit_config.profit_targets.map((pt) => ({
    target: pt.target,
    percent: pt.percent,
  }));

  // Convert stop loss config
  const stopLossConfig: StopLossConfig | undefined = validatedInput.exit_config.stop_loss
    ? {
        initial: validatedInput.exit_config.stop_loss.initial,
        trailing: validatedInput.exit_config.stop_loss.trailing ?? 'none',
        trailingPercent: validatedInput.exit_config.stop_loss.trailingPercent,
        trailingWindowSize: validatedInput.exit_config.stop_loss.trailingWindowSize,
      }
    : undefined;

  // Convert entry config
  const entryConfig: EntryConfig = {
    initialEntry:
      validatedInput.entry_config.initialEntry === 'none'
        ? 'none'
        : validatedInput.entry_config.initialEntry,
    trailingEntry:
      validatedInput.entry_config.trailingEntry === 'none'
        ? 'none'
        : validatedInput.entry_config.trailingEntry,
    maxWaitTime: validatedInput.entry_config.maxWaitTime,
  };

  // Convert re-entry config
  const reEntryConfig: ReEntryConfig | undefined = validatedInput.reentry_config
    ? {
        trailingReEntry:
          validatedInput.reentry_config.trailingReEntry === 'none'
            ? 'none'
            : validatedInput.reentry_config.trailingReEntry,
        maxReEntries: validatedInput.reentry_config.maxReEntries,
        sizePercent: validatedInput.reentry_config.sizePercent,
      }
    : undefined;

  // Convert cost config - provide defaults for missing fields
  const costConfig: CostConfig | undefined = validatedInput.cost_config
    ? {
        entrySlippageBps: validatedInput.cost_config.entrySlippageBps ?? 0,
        exitSlippageBps: validatedInput.cost_config.exitSlippageBps ?? 0,
        takerFeeBps: validatedInput.cost_config.takerFeeBps ?? 0,
        borrowAprBps: validatedInput.cost_config.borrowAprBps ?? 0,
      }
    : undefined;

  // Extract execution model from input if provided
  const executionModel: ExecutionModel | undefined = validatedInput.executionModel
    ? (validatedInput.executionModel as ExecutionModel)
    : undefined;

  // Extract seed from input if provided, otherwise generate from run_id for determinism
  const seed = validatedInput.seed ?? seedFromString(validatedInput.run_id);

  // Extract clock resolution from input (defaults to 'm' for minutes)
  const clockResolution = validatedInput.clockResolution ?? 'm';

  // Run simulation
  const result = await simulateStrategy(
    candles,
    strategy,
    stopLossConfig,
    entryConfig,
    reEntryConfig,
    costConfig,
    {
      executionModel,
      seed,
      clockResolution,
    }
  );

  // Convert to canonical result
  const canonicalResult: SimResult = {
    run_id: validatedInput.run_id,
    final_pnl: result.finalPnl,
    events: result.events.map((e) => {
      // Convert legacy event to canonical event
      const event: SimEvent = {
        event_type: e.type,
        timestamp: e.timestamp,
        price: e.price,
        quantity: e.type === 'entry' || e.type === 're_entry' ? 1.0 : 0.0, // Simplified
        value_usd: e.price * (e.type === 'entry' || e.type === 're_entry' ? 1.0 : 0.0),
        fee_usd: 0.0, // Will be calculated from cost config
        position_size: 'remainingPosition' in e ? e.remainingPosition : 0.0,
      };

      // Add PnL if available
      if ('pnlSoFar' in e) {
        event.pnl_usd = e.pnlSoFar;
        event.cumulative_pnl_usd = e.pnlSoFar;
      }

      return event;
    }),
    entry_price: result.entryPrice,
    final_price: result.finalPrice,
    total_candles: result.totalCandles,
    metrics: {
      max_drawdown: undefined, // Will be calculated from events if needed
      sharpe_ratio: undefined,
      win_rate: result.finalPnl > 1.0 ? 1.0 : 0.0, // Simplified
      total_trades: result.events.filter((e) => e.type === 'target_hit' || e.type === 'stop_loss')
        .length,
    },
    contractVersion: validatedInput.contractVersion || '1.0.0',
  };

  // Validate result
  return SimResultSchema.parse(canonicalResult);
}

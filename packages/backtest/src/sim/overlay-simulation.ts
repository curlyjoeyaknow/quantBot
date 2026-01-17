/**
 * Overlay Simulation - Clean entrypoint for overlay-based backtesting
 *
 * This is the single entrypoint for overlay-based simulations.
 * Workflows should use this, not the low-level simulateStrategy() directly.
 *
 * Architecture:
 * - Workflows define overlays (take_profit, stop_loss, etc.)
 * - This module maps overlays to simulation configs internally
 * - All trade mechanics live here, not in workflows
 */

import { simulateStrategy } from './core/simulator.js';
import type {
  Candle,
  StrategyLeg,
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  CostConfig,
  SimulationResult,
} from './types/index.js';

/**
 * Exit overlay strategies (workflow-level abstraction)
 */
export type ExitOverlay =
  | { kind: 'time_exit'; holdMs: number }
  | { kind: 'stop_loss'; stopPct: number }
  | { kind: 'take_profit'; takePct: number }
  | { kind: 'trailing_stop'; trailPct: number }
  | { kind: 'combo'; legs: ExitOverlay[] };

/**
 * Fee model (workflow-level abstraction)
 */
export type FeeModel = {
  takerFeeBps: number; // e.g., 30 = 0.30%
  slippageBps: number; // Constant slippage
};

/**
 * Position model (workflow-level abstraction)
 */
export type PositionModel = {
  notionalUsd: number;
};

/**
 * Trade point (entry or exit)
 */
export type TradePoint = {
  tsMs: number;
  px: number;
};

/**
 * PnL breakdown
 */
export type PnlBreakdown = {
  grossReturnPct: number;
  netReturnPct: number;
  feesUsd: number;
  slippageUsd: number;
};

/**
 * Simulation diagnostics
 */
export type SimulationDiagnostics = {
  candlesUsed: number;
  tradeable: boolean;
  skippedReason?: string;
};

/**
 * Overlay simulation result
 */
export type OverlaySimulationResult = {
  overlay: ExitOverlay;
  entry: TradePoint;
  exit: TradePoint;
  exitReason: string;
  pnl: PnlBreakdown;
  diagnostics: SimulationDiagnostics;
};

/**
 * Overlay simulation request
 */
export type OverlaySimulationRequest = {
  candles: Candle[];
  entry: TradePoint;
  overlays: ExitOverlay[];
  fees: FeeModel;
  position: PositionModel;
};

/**
 * Run overlay-based simulation
 *
 * This is the single entrypoint for overlay simulations.
 * Maps overlays to simulation configs internally, so workflows don't need to know about StrategyLeg[], StopLossConfig, etc.
 *
 * @param req - Simulation request with overlays
 * @returns Array of results (one per overlay)
 */
export async function runOverlaySimulation(
  req: OverlaySimulationRequest
): Promise<OverlaySimulationResult[]> {
  // Calculate candle interval from first two candles (or default to 5m)
  const candleIntervalMs =
    req.candles.length >= 2 && req.candles[0] && req.candles[1]
      ? (req.candles[1].timestamp - req.candles[0].timestamp) * 1000
      : 5 * 60 * 1000; // Default to 5 minutes

  // Map fee model to CostConfig
  const costConfig: CostConfig = {
    takerFeeBps: req.fees.takerFeeBps,
    entrySlippageBps: req.fees.slippageBps,
    exitSlippageBps: req.fees.slippageBps,
    borrowAprBps: 0,
  };

  // Entry config: immediate entry at first candle
  const entryConfig: EntryConfig = {
    initialEntry: 'none', // Enter immediately at first candle
    trailingEntry: 'none',
    maxWaitTime: 0,
  };

  // No re-entry for overlay evaluation
  const reEntryConfig: ReEntryConfig = {
    trailingReEntry: 'none',
    maxReEntries: 0,
    sizePercent: 0,
  };

  // Evaluate each overlay
  const results: OverlaySimulationResult[] = [];

  for (const overlay of req.overlays) {
    try {
      // Map overlay to simulation configs (internal to simulation module)
      const { strategy, stopLossConfig, maxCandles } = mapOverlayToSimulationConfig(
        overlay,
        req.candles.length,
        candleIntervalMs
      );

      // Slice candles if time-based exit
      const candlesToUse = maxCandles ? req.candles.slice(0, maxCandles) : req.candles;

      if (candlesToUse.length === 0) {
        results.push(createEmptyResult(req.entry, overlay, 'no_candles'));
        continue;
      }

      // Run simulation via simulateStrategy
      const simResult = await simulateStrategy(
        candlesToUse,
        strategy,
        stopLossConfig,
        entryConfig,
        reEntryConfig,
        costConfig
      );

      // Map SimulationResult to OverlaySimulationResult
      const result = mapSimulationResultToOverlayResult(
        overlay,
        req.entry,
        simResult,
        req.position.notionalUsd,
        costConfig
      );

      results.push(result);
    } catch (error) {
      // If simulation fails, return error result
      results.push({
        overlay,
        entry: req.entry,
        exit: req.entry,
        exitReason: 'simulation_error',
        pnl: {
          grossReturnPct: 0,
          netReturnPct: 0,
          feesUsd: 0,
          slippageUsd: 0,
        },
        diagnostics: {
          candlesUsed: req.candles.length,
          tradeable: true,
          skippedReason: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  return results;
}

/**
 * Map ExitOverlay to simulation configs (StrategyLeg[], StopLossConfig)
 *
 * This mapping logic lives in the simulation module, not workflows.
 * Workflows should not know about StrategyLeg[] or StopLossConfig.
 */
function mapOverlayToSimulationConfig(
  overlay: ExitOverlay,
  maxCandlesAvailable: number,
  candleIntervalMs: number
): {
  strategy: StrategyLeg[];
  stopLossConfig?: StopLossConfig;
  maxCandles?: number; // For time-based exits
} {
  if (overlay.kind === 'combo') {
    // For combo, combine all legs into strategy
    const strategy: StrategyLeg[] = [];
    let stopLossConfig: StopLossConfig | undefined;

    for (const leg of overlay.legs) {
      if (leg.kind === 'take_profit') {
        strategy.push({
          target: 1 + leg.takePct / 100, // Convert percentage to multiplier
          percent: 1.0 / overlay.legs.length, // Distribute evenly across legs
        });
      } else if (leg.kind === 'stop_loss') {
        stopLossConfig = {
          initial: -leg.stopPct / 100, // Convert percentage to negative decimal (e.g., 20% -> -0.2)
          trailing: 'none',
        };
      } else if (leg.kind === 'trailing_stop') {
        stopLossConfig = {
          initial: 0, // Will be set by trailing
          trailing: leg.trailPct / 100, // Convert percentage to decimal
        };
      }
      // time_exit is handled separately via maxCandles
    }

    return { strategy, stopLossConfig };
  }

  if (overlay.kind === 'take_profit') {
    return {
      strategy: [
        {
          target: 1 + overlay.takePct / 100, // e.g., 100% = 2x multiplier
          percent: 1.0, // Exit 100% at target
        },
      ],
    };
  }

  if (overlay.kind === 'stop_loss') {
    return {
      strategy: [], // No profit targets, just stop loss
      stopLossConfig: {
        initial: -overlay.stopPct / 100, // Convert percentage to negative decimal (e.g., 20% -> -0.2)
        trailing: 'none',
      },
    };
  }

  if (overlay.kind === 'trailing_stop') {
    return {
      strategy: [], // No profit targets, just trailing stop
      stopLossConfig: {
        initial: -0.5, // Initial stop (will be moved by trailing)
        trailing: 0.1, // Activate trailing after 10% gain
        trailingPercent: overlay.trailPct / 100, // Trailing stop percent from peak
      },
    };
  }

  if (overlay.kind === 'time_exit') {
    // For time-based exit, calculate how many candles to use based on interval
    const maxCandles = Math.min(Math.ceil(overlay.holdMs / candleIntervalMs), maxCandlesAvailable);

    return {
      strategy: [], // No profit targets, exit at end of time window
      maxCandles,
    };
  }

  // Fallback: empty strategy
  return { strategy: [] };
}

/**
 * Map SimulationResult to OverlaySimulationResult
 *
 * Extracts entry/exit info and PnL from simulation result.
 */
function mapSimulationResultToOverlayResult(
  overlay: ExitOverlay,
  requestedEntry: TradePoint,
  simResult: SimulationResult,
  notionalUsd: number,
  costConfig: CostConfig
): OverlaySimulationResult {
  // Find entry event
  const entryEvent = simResult.events.find((e) => e.type === 'entry');
  const entryPrice = entryEvent?.price ?? requestedEntry.px;
  const entryTsMs = entryEvent ? entryEvent.timestamp * 1000 : requestedEntry.tsMs;

  // Find exit event (final_exit, target_hit, or stop_loss)
  const exitEvent =
    simResult.events.find((e) => e.type === 'final_exit') ??
    simResult.events.find((e) => e.type === 'target_hit') ??
    simResult.events.find((e) => e.type === 'stop_loss') ??
    simResult.events[simResult.events.length - 1]; // Fallback to last event

  const exitPrice = exitEvent?.price ?? simResult.finalPrice;
  const exitTsMs = exitEvent ? exitEvent.timestamp * 1000 : requestedEntry.tsMs;
  const exitReason = exitEvent ? `${exitEvent.type}_${exitEvent.description}` : 'no_exit_event';

  // Calculate PnL from simulation result
  // finalPnl is already a multiplier (1.0 = break even)
  const grossReturnPct = (simResult.finalPnl - 1) * 100;
  const netReturnPct = grossReturnPct; // Simulation already includes costs

  // Calculate fees and slippage from cost config
  const entryFeeUsd = (notionalUsd * costConfig.takerFeeBps) / 10_000;
  const exitFeeUsd = (notionalUsd * costConfig.takerFeeBps) / 10_000;
  const entrySlippageUsd = (notionalUsd * costConfig.entrySlippageBps) / 10_000;
  const exitSlippageUsd = (notionalUsd * costConfig.exitSlippageBps) / 10_000;

  return {
    overlay,
    entry: { tsMs: entryTsMs, px: entryPrice },
    exit: { tsMs: exitTsMs, px: exitPrice },
    exitReason,
    pnl: {
      grossReturnPct,
      netReturnPct,
      feesUsd: entryFeeUsd + exitFeeUsd,
      slippageUsd: entrySlippageUsd + exitSlippageUsd,
    },
    diagnostics: {
      candlesUsed: simResult.totalCandles,
      tradeable: true,
    },
  };
}

/**
 * Create empty result for error cases
 */
function createEmptyResult(
  entry: TradePoint,
  overlay: ExitOverlay,
  reason: string
): OverlaySimulationResult {
  return {
    overlay,
    entry,
    exit: entry,
    exitReason: reason,
    pnl: {
      grossReturnPct: 0,
      netReturnPct: 0,
      feesUsd: 0,
      slippageUsd: 0,
    },
    diagnostics: {
      candlesUsed: 0,
      tradeable: false,
      skippedReason: reason,
    },
  };
}

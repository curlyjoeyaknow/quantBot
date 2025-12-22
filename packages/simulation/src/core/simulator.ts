/**
 * Core Simulator
 * ==============
 * The main simulation loop that processes candles and executes trades.
 */

import type {
  StopLossConfig,
  EntryConfig,
  ReEntryConfig,
  CostConfig,
  StrategyLeg,
  SignalGroup,
  LadderConfig,
  SimulationResult,
  LegacySimulationEvent,
} from '../types/index.js';
import type { Candle, SubCandleProvider as CandleProvider } from '../types/candle.js';
import {
  DEFAULT_STOP_LOSS,
  DEFAULT_ENTRY,
  DEFAULT_REENTRY,
  DEFAULT_COSTS,
} from '../types/strategy.js';
import { calculateIndicatorSeries, type LegacyIndicatorData } from '../indicators/registry.js';
import { calculateIndicatorSeriesOptimized } from '../performance/optimizations.js';
import { getPerformanceMonitor } from '../performance/monitor.js';
import { evaluateSignalGroup } from '../signals/evaluator.js';
import { getEntryCostMultiplier, getExitCostMultiplier } from '../execution/index.js';
import { logStep } from '../utils/progress.js';
import {
  checkStopLossSequential,
  initTrailingStopState,
  updateRollingTrailingStop,
  type TrailingStopState,
} from '../execution/exit.js';
import { validateReEntrySequence } from '../execution/reentry.js';

/**
 * Simulation options
 */
export interface SimulationOptions {
  /** Entry signal group */
  entrySignal?: SignalGroup;
  /** Exit signal group */
  exitSignal?: SignalGroup;
  /** Entry ladder configuration */
  entryLadder?: LadderConfig;
  /** Exit ladder configuration */
  exitLadder?: LadderConfig;
  /** Candle provider for sub-candle resolution */
  candleProvider?: CandleProvider;
}

/**
 * Run a strategy simulation on candle data
 *
 * This is the core simulation function that:
 * 1. Handles entry logic (immediate, drop-based, trailing)
 * 2. Processes profit targets
 * 3. Manages stop loss (initial and trailing)
 * 4. Handles re-entries
 * 5. Calculates fees and slippage
 *
 * @param candles - OHLCV candle data (sorted ascending by timestamp)
 * @param strategy - Strategy profit targets
 * @param stopLossConfig - Stop loss configuration
 * @param entryConfig - Entry configuration
 * @param reEntryConfig - Re-entry configuration
 * @param costConfig - Fee and slippage configuration
 * @param options - Additional options (signals, ladders)
 * @returns Simulation result with PnL and events
 */
export async function simulateStrategy(
  candles: readonly Candle[],
  strategy: StrategyLeg[],
  stopLossConfig?: StopLossConfig,
  entryConfig?: EntryConfig,
  reEntryConfig?: ReEntryConfig,
  costConfig?: CostConfig,
  options?: SimulationOptions
): Promise<SimulationResult> {
  // Handle empty candles
  if (!candles.length) {
    return createEmptyResult();
  }

  // Merge with defaults
  const entryCfg = entryConfig ? { ...DEFAULT_ENTRY, ...entryConfig } : { ...DEFAULT_ENTRY };
  const stopCfg = stopLossConfig
    ? { ...DEFAULT_STOP_LOSS, ...stopLossConfig }
    : { ...DEFAULT_STOP_LOSS };
  const reEntryCfg = reEntryConfig
    ? { ...DEFAULT_REENTRY, ...reEntryConfig }
    : { ...DEFAULT_REENTRY };
  const costs = costConfig ? { ...DEFAULT_COSTS, ...costConfig } : { ...DEFAULT_COSTS };

  const entrySignal = options?.entrySignal;
  const exitSignal = options?.exitSignal;

  // Precompute indicators (with caching optimization)
  if (candles.length > 100) {
    logStep(`Calculating indicators for ${candles.length} candles`);
  }
  const perfMonitor = getPerformanceMonitor();
  const indicatorSeries = await perfMonitor.measure(
    'calculateIndicators',
    async () => {
      return calculateIndicatorSeriesOptimized(candles, calculateIndicatorSeries);
    },
    { candleCount: candles.length }
  );
  if (candles.length > 100) {
    logStep(`Calculated indicators for ${indicatorSeries.length} candles`);
  }

  // Cost multipliers
  const entryCostMultiplier = getEntryCostMultiplier(costs);
  const exitCostMultiplier = getExitCostMultiplier(costs);

  // Initial state
  const initialPrice = candles[0].open;
  const finalPrice = candles[candles.length - 1].close;
  const events: LegacySimulationEvent[] = [];

  // Entry tracking
  const _lowestPrice = initialPrice;
  let _lowestPriceTimestamp = candles[0].timestamp;
  const _lowestPriceTimeFromEntry = 0;
  let actualEntryPrice = initialPrice;
  let entryDelay = 0;
  let trailingEntryUsed = false;
  let hasEntered = entryCfg.initialEntry === 'none';
  const _initialEntryTriggered = false;

  // Handle initial entry (wait for drop)
  if (entryCfg.initialEntry !== 'none') {
    const result = handleInitialEntry(
      candles,
      indicatorSeries,
      entryCfg.initialEntry as number,
      entrySignal,
      events
    );

    if (result.triggered) {
      actualEntryPrice = result.price;
      entryDelay = result.entryDelay;
      hasEntered = true;
    } else {
      // No trade - price never dropped enough
      return createNoTradeResult(candles, events, initialPrice, finalPrice);
    }
  }

  // Handle trailing entry
  if (!hasEntered && entryCfg.trailingEntry !== 'none') {
    const maxWaitTime = entryCfg.maxWaitTime ?? DEFAULT_ENTRY.maxWaitTime ?? 60;
    const result = handleTrailingEntry(
      candles,
      indicatorSeries,
      entryCfg.trailingEntry as number,
      maxWaitTime,
      entrySignal,
      events
    );

    if (result.triggered) {
      actualEntryPrice = result.price;
      entryDelay = result.entryDelay;
      trailingEntryUsed = true;
      hasEntered = true;
      _lowestPriceTimestamp = result.lowestPriceTimestamp;
    } else {
      // Fallback to end of wait period
      const maxWaitTimestamp = candles[0].timestamp + maxWaitTime * 60;
      const fallback =
        candles.find((c) => c.timestamp <= maxWaitTimestamp) ?? candles[candles.length - 1];
      actualEntryPrice = fallback.close;
      entryDelay = (fallback.timestamp - candles[0].timestamp) / 60;
    }
  }

  // Update lowest price tracking (unused for now)
  // lowestPriceTimeFromEntry = (lowestPriceTimestamp - candles[0].timestamp) / 60;

  // Add entry event if not already added
  if (!trailingEntryUsed && events.length === 0) {
    events.push({
      type: 'entry',
      timestamp: candles[0].timestamp,
      price: actualEntryPrice,
      description: `Entry at $${actualEntryPrice.toFixed(8)}`,
      remainingPosition: 1,
      pnlSoFar: 0,
    });
  }

  // Run main simulation loop
  const loopResult = await runSimulationLoop(
    candles,
    indicatorSeries,
    strategy,
    stopCfg,
    reEntryCfg,
    costs,
    actualEntryPrice,
    entryCostMultiplier,
    exitCostMultiplier,
    exitSignal,
    events,
    options?.candleProvider
  );

  return {
    finalPnl: loopResult.pnl,
    events,
    entryPrice: actualEntryPrice,
    finalPrice,
    totalCandles: candles.length,
    entryOptimization: {
      lowestPrice: loopResult.lowestPrice,
      lowestPriceTimestamp: loopResult.lowestPriceTimestamp,
      lowestPricePercent: (loopResult.lowestPrice / actualEntryPrice - 1) * 100,
      lowestPriceTimeFromEntry: loopResult.lowestPriceTimeFromEntry,
      trailingEntryUsed,
      actualEntryPrice,
      entryDelay,
    },
  };
}

/**
 * Handle initial entry (wait for price drop)
 */
function handleInitialEntry(
  candles: readonly Candle[],
  indicators: readonly LegacyIndicatorData[],
  dropPercent: number,
  entrySignal: SignalGroup | undefined,
  events: LegacySimulationEvent[]
): { triggered: boolean; price: number; entryDelay: number } {
  const initialPrice = candles[0].open;
  const triggerPrice = initialPrice * (1 + dropPercent);

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    if (candle.low <= triggerPrice) {
      // Check signal if required
      if (entrySignal) {
        const result = evaluateSignalGroup(entrySignal, {
          candle,
          indicators: indicators[i],
          prevIndicators: i > 0 ? indicators[i - 1] : undefined,
        });
        if (!result.satisfied) continue;
      }

      events.push({
        type: 'entry',
        timestamp: candle.timestamp,
        price: triggerPrice,
        description: `Initial entry at $${triggerPrice.toFixed(8)} (${(Math.abs(dropPercent) * 100).toFixed(0)}% drop)`,
        remainingPosition: 1,
        pnlSoFar: 0,
      });

      return {
        triggered: true,
        price: triggerPrice,
        entryDelay: (candle.timestamp - candles[0].timestamp) / 60,
      };
    }
  }

  // Add no-trade event
  events.push({
    type: 'entry',
    timestamp: candles[0].timestamp,
    price: initialPrice,
    description: `No trade: price never dropped ${(Math.abs(dropPercent) * 100).toFixed(0)}%`,
    remainingPosition: 0,
    pnlSoFar: 0,
  });

  return { triggered: false, price: initialPrice, entryDelay: 0 };
}

/**
 * Handle trailing entry (find low, enter on rebound)
 */
function handleTrailingEntry(
  candles: readonly Candle[],
  indicators: readonly LegacyIndicatorData[],
  trailingPercent: number,
  maxWaitTime: number,
  entrySignal: SignalGroup | undefined,
  events: LegacySimulationEvent[]
): {
  triggered: boolean;
  price: number;
  entryDelay: number;
  lowestPrice: number;
  lowestPriceTimestamp: number;
} {
  const maxWaitTimestamp = candles[0].timestamp + maxWaitTime * 60;
  let lowestPrice = candles[0].open;
  let lowestPriceTimestamp = candles[0].timestamp;

  // Find lowest price within wait period
  for (let i = 0; i < candles.length; i++) {
    if (candles[i].timestamp > maxWaitTimestamp) break;
    if (candles[i].low < lowestPrice) {
      lowestPrice = candles[i].low;
      lowestPriceTimestamp = candles[i].timestamp;
    }
  }

  const trailingTrigger = lowestPrice * (1 + trailingPercent);

  // Look for rebound
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    if (candle.timestamp > maxWaitTimestamp) break;

    if (candle.high >= trailingTrigger) {
      if (entrySignal) {
        const result = evaluateSignalGroup(entrySignal, {
          candle,
          indicators: indicators[i],
          prevIndicators: i > 0 ? indicators[i - 1] : undefined,
        });
        if (!result.satisfied) continue;
      }

      events.push({
        type: 'trailing_entry_triggered',
        timestamp: candle.timestamp,
        price: trailingTrigger,
        description: `Trailing entry at $${trailingTrigger.toFixed(8)} (${(trailingPercent * 100).toFixed(1)}% from low)`,
        remainingPosition: 1,
        pnlSoFar: 0,
      });

      return {
        triggered: true,
        price: trailingTrigger,
        entryDelay: (candle.timestamp - candles[0].timestamp) / 60,
        lowestPrice,
        lowestPriceTimestamp,
      };
    }
  }

  return {
    triggered: false,
    price: lowestPrice,
    entryDelay: 0,
    lowestPrice,
    lowestPriceTimestamp,
  };
}

/**
 * Main simulation loop with sequential detection and rolling trailing stop
 */
async function runSimulationLoop(
  candles: readonly Candle[],
  indicators: readonly LegacyIndicatorData[],
  strategy: StrategyLeg[],
  stopCfg: StopLossConfig,
  reEntryCfg: ReEntryConfig,
  costs: CostConfig,
  entryPrice: number,
  entryCostMultiplier: number,
  exitCostMultiplier: number,
  exitSignal: SignalGroup | undefined,
  events: LegacySimulationEvent[],
  candleProvider?: CandleProvider
): Promise<{
  pnl: number;
  lowestPrice: number;
  lowestPriceTimestamp: number;
  lowestPriceTimeFromEntry: number;
}> {
  const entryPriceWithCosts = entryPrice * entryCostMultiplier;
  let stopLoss = entryPrice * (1 + stopCfg.initial);
  let stopMovedToEntry = false;
  const hasTrailing = stopCfg.trailing !== 'none';
  const hasRollingTrailing = hasTrailing && stopCfg.trailingWindowSize !== undefined;

  // Initialize rolling trailing stop state
  let trailingStopState: TrailingStopState | undefined = undefined;
  if (hasRollingTrailing) {
    trailingStopState = initTrailingStopState(entryPrice, stopCfg);
  }

  let pnl = 0;
  let remaining = 1;
  let targetIndex = 0;

  let reEntryCount = 0;
  let currentPeakPrice = entryPrice;
  let waitingForReEntry = false;
  let reEntryTriggerPrice = 0;
  let lastExitIndex = -1; // Track last exit for sequential re-entry validation

  let lowestPrice = entryPrice;
  let lowestPriceTimestamp = candles[0].timestamp;
  let lowestPriceTimeFromEntry = 0;

  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];

    // Track price extremes
    if (candle.low < lowestPrice) {
      lowestPrice = candle.low;
      lowestPriceTimestamp = candle.timestamp;
      lowestPriceTimeFromEntry = (candle.timestamp - candles[0].timestamp) / 60;
    }
    if (candle.high > currentPeakPrice) {
      currentPeakPrice = candle.high;
    }

    // 1. Update rolling trailing stop first (affects stop loss price)
    if (hasRollingTrailing && trailingStopState) {
      const trailingPercent = stopCfg.trailingPercent ?? 0.25; // Default 25%
      trailingStopState = updateRollingTrailingStop(trailingStopState, candle, i, trailingPercent);
      stopLoss = trailingStopState.currentStop;
    } else if (hasTrailing && !stopMovedToEntry) {
      // Legacy trailing stop activation
      const trailingTrigger = entryPrice * (1 + (stopCfg.trailing as number));
      if (candle.high >= trailingTrigger) {
        stopLoss = entryPrice;
        stopMovedToEntry = true;
        events.push({
          type: 'stop_moved',
          timestamp: candle.timestamp,
          price: candle.high,
          description: `Trailing stop at $${candle.high.toFixed(8)} (${((stopCfg.trailing as number) * 100).toFixed(0)}% gain)`,
          remainingPosition: remaining,
          pnlSoFar: pnl,
        });
      }
    }

    // 2. Check re-entry with sequential validation
    if (waitingForReEntry && candle.low <= reEntryTriggerPrice) {
      // Validate sequential ordering
      if (lastExitIndex >= 0) {
        const isValid = validateReEntrySequence(candles, lastExitIndex, i, stopLoss);

        if (!isValid) {
          // Stop loss was hit between exit and re-entry, reject re-entry
          events.push({
            type: 're_entry_rejected',
            timestamp: candle.timestamp,
            price: reEntryTriggerPrice,
            description: `Re-entry rejected: stop loss hit between exit and re-entry attempt`,
            remainingPosition: remaining,
            pnlSoFar: pnl,
          });
          waitingForReEntry = false;
          break;
        }
      }

      remaining = Math.min(1, remaining + reEntryCfg.sizePercent);
      reEntryCount++;
      waitingForReEntry = false;
      stopLoss = reEntryTriggerPrice * (1 + stopCfg.initial);
      stopMovedToEntry = false;
      currentPeakPrice = reEntryTriggerPrice;

      // Reset trailing stop state for new entry
      if (hasRollingTrailing) {
        trailingStopState = initTrailingStopState(reEntryTriggerPrice, stopCfg);
      }

      events.push({
        type: 're_entry',
        timestamp: candle.timestamp,
        price: reEntryTriggerPrice,
        description: `Re-entry at $${reEntryTriggerPrice.toFixed(8)} (${((reEntryCfg.trailingReEntry as number) * 100).toFixed(0)}% retrace)`,
        remainingPosition: remaining,
        pnlSoFar: pnl,
      });
      continue;
    }

    // 3. Check stop loss with sequential detection
    if (remaining > 0) {
      const targetPrice =
        targetIndex < strategy.length ? entryPrice * strategy[targetIndex].target : Infinity;

      const sequentialResult = await checkStopLossSequential(
        candle,
        stopLoss,
        targetPrice,
        candleProvider
      );

      if (sequentialResult.outcome === 'stop_loss') {
        const stopComponent = (stopLoss * exitCostMultiplier) / entryPriceWithCosts;
        const stopPnl = remaining * stopComponent;
        pnl += stopPnl;

        events.push({
          type: 'stop_loss',
          timestamp: candle.timestamp,
          price: stopLoss,
          description: `Stop loss at $${stopLoss.toFixed(8)} (${((stopLoss / entryPrice - 1) * 100).toFixed(1)}%) [${sequentialResult.resolutionMethod}]`,
          remainingPosition: 0,
          pnlSoFar: pnl,
        });
        remaining = 0;
        lastExitIndex = i;

        // Check for re-entry possibility
        if (reEntryCfg.trailingReEntry !== 'none' && reEntryCount < reEntryCfg.maxReEntries) {
          reEntryTriggerPrice = entryPrice * (1 - (reEntryCfg.trailingReEntry as number));
          waitingForReEntry = true;
        } else {
          break;
        }
        continue; // Skip target check since stop was hit first
      }
    }

    // 4. Check profit targets (only if stop not hit)
    if (remaining > 0 && targetIndex < strategy.length) {
      const { percent, target } = strategy[targetIndex];
      const targetPrice = entryPrice * target;

      if (candle.high >= targetPrice) {
        const realizedPrice = targetPrice * exitCostMultiplier;
        const targetPnl = percent * (realizedPrice / entryPriceWithCosts);
        pnl += targetPnl;
        remaining = Math.max(0, remaining - percent);

        events.push({
          type: 'target_hit',
          timestamp: candle.timestamp,
          price: targetPrice,
          description: `Target ${target}x hit (sold ${(percent * 100).toFixed(0)}%)`,
          remainingPosition: remaining,
          pnlSoFar: pnl,
        });
        targetIndex++;
        lastExitIndex = i;

        // Setup re-entry after target
        if (reEntryCfg.trailingReEntry !== 'none' && reEntryCount < reEntryCfg.maxReEntries) {
          reEntryTriggerPrice = targetPrice * (1 - (reEntryCfg.trailingReEntry as number));
          waitingForReEntry = true;
        }
      }
    }

    // 5. Check exit signal
    if (exitSignal && remaining > 0) {
      const lookbackContext = {
        candles,
        indicators,
        currentIndex: i,
      };

      const result = evaluateSignalGroup(
        exitSignal,
        {
          candle,
          indicators: indicators[i],
          prevIndicators: i > 0 ? indicators[i - 1] : undefined,
        },
        lookbackContext
      );

      if (result.satisfied) {
        const exitComponent = (candle.close * exitCostMultiplier) / entryPriceWithCosts;
        const finalComponent = remaining * exitComponent;
        pnl += finalComponent;

        events.push({
          type: 'final_exit',
          timestamp: candle.timestamp,
          price: candle.close,
          description: `Signal-based exit ${(remaining * 100).toFixed(0)}% at $${candle.close.toFixed(8)}`,
          remainingPosition: 0,
          pnlSoFar: pnl,
        });
        remaining = 0;
        break;
      }
    }
  }

  // Final exit if position remains
  if (remaining > 0) {
    const finalPrice = candles[candles.length - 1].close;
    const exitComponent = (finalPrice * exitCostMultiplier) / entryPriceWithCosts;
    const finalComponent = remaining * exitComponent;
    pnl += finalComponent;

    events.push({
      type: 'final_exit',
      timestamp: candles[candles.length - 1].timestamp,
      price: finalPrice,
      description: `Final exit ${(remaining * 100).toFixed(0)}% at $${finalPrice.toFixed(8)}`,
      remainingPosition: 0,
      pnlSoFar: pnl,
    });
  }

  return { pnl, lowestPrice, lowestPriceTimestamp, lowestPriceTimeFromEntry };
}

/**
 * Create empty simulation result
 */
function createEmptyResult(): SimulationResult {
  return {
    finalPnl: 0,
    events: [],
    entryPrice: 0,
    finalPrice: 0,
    totalCandles: 0,
    entryOptimization: {
      lowestPrice: 0,
      lowestPriceTimestamp: 0,
      lowestPricePercent: 0,
      lowestPriceTimeFromEntry: 0,
      trailingEntryUsed: false,
      actualEntryPrice: 0,
      entryDelay: 0,
    },
  };
}

/**
 * Create no-trade result
 */
function createNoTradeResult(
  candles: readonly Candle[],
  events: LegacySimulationEvent[],
  initialPrice: number,
  finalPrice: number
): SimulationResult {
  return {
    finalPnl: 0,
    events,
    entryPrice: initialPrice,
    finalPrice,
    totalCandles: candles.length,
    entryOptimization: {
      lowestPrice: initialPrice,
      lowestPriceTimestamp: candles[0].timestamp,
      lowestPricePercent: 0,
      lowestPriceTimeFromEntry: 0,
      trailingEntryUsed: false,
      actualEntryPrice: 0,
      entryDelay: 0,
    },
  };
}

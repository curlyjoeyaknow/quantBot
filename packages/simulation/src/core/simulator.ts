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
import type {
  Candle,
  SubCandleProvider as CandleProvider,
  CandleInterval,
} from '../types/candle.js';
import { getIntervalSeconds } from '../types/candle.js';
import type { CausalCandleAccessor } from '../types/causal-accessor.js';
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
import {
  getEntryCostMultiplier,
  getExitCostMultiplier,
  type ExecutionModelInterface,
  createExecutionModel,
  type TradeRequest,
} from '../execution/index.js';
import type { ExecutionModel } from '../types/execution-model.js';
import { createDeterministicRNG, type DeterministicRNG } from '@quantbot/core';
import { logStep } from '../utils/progress.js';
import { type SimulationClock, type ClockResolution, createClock } from './clock.js';
import {
  checkStopLossSequential,
  initTrailingStopState,
  updateRollingTrailingStop,
  type TrailingStopState,
} from '../execution/exit.js';
import { validateReEntrySequence } from '../execution/reentry.js';
import { detectEntry } from '../execution/entry.js';
import { updateIndicatorsIncremental } from '../indicators/incremental.js';

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
  /** Execution model for realistic trade execution */
  executionModel?: ExecutionModel;
  /** Seed for deterministic execution model behavior */
  seed?: number;
  /** Clock resolution for time-based calculations */
  clockResolution?: ClockResolution;
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

  // Create execution model if provided, otherwise use cost multipliers (backward compatibility)
  const _executionModel: ExecutionModelInterface | undefined = options?.executionModel
    ? createExecutionModel(options.executionModel)
    : undefined;

  // Create RNG for execution model (deterministic if seed provided)
  // If seed is provided, use it; otherwise generate from first candle timestamp (deterministic fallback)
  // Note: For full determinism, always provide a seed. The candle timestamp fallback is deterministic
  // for the same candle data but may vary across different runs with different data.
  const _rng =
    options?.executionModel && options?.seed !== undefined
      ? createDeterministicRNG(options.seed)
      : options?.executionModel
        ? createDeterministicRNG(candles[0]?.timestamp ?? 0) // Deterministic fallback from candle data
        : undefined;

  // Create simulation clock based on resolution
  const clockResolution: ClockResolution = options?.clockResolution ?? 'm'; // Default to minutes
  const clock: SimulationClock = createClock(clockResolution, candles[0]?.timestamp ?? 0);

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
      events,
      clock
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
      events,
      clock
    );

    if (result.triggered) {
      actualEntryPrice = result.price;
      entryDelay = result.entryDelay;
      trailingEntryUsed = true;
      hasEntered = true;
      _lowestPriceTimestamp = result.lowestPriceTimestamp;
    } else {
      // Fallback to end of wait period
      const maxWaitTimestamp = candles[0].timestamp + clock.toMilliseconds(maxWaitTime);
      const fallback =
        candles.find((c) => c.timestamp <= maxWaitTimestamp) ?? candles[candles.length - 1];
      actualEntryPrice = fallback.close;
      entryDelay = clock.fromMilliseconds(fallback.timestamp - candles[0].timestamp);
    }
  }

  // Handle signal-only entry (when entrySignal is provided but no other entry method)
  if (!hasEntered && entrySignal && entryCfg.initialEntry === 'none' && entryCfg.trailingEntry === 'none') {
    const maxWaitTime = entryCfg.maxWaitTime ?? DEFAULT_ENTRY.maxWaitTime ?? 60;
    const maxWaitTimestamp = candles[0].timestamp + clock.toMilliseconds(maxWaitTime);
    const result = detectEntry(
      candles,
      0,
      entryCfg,
      indicatorSeries,
      entrySignal
    );

    if (result.shouldEnter && result.timestamp <= maxWaitTimestamp) {
      actualEntryPrice = result.price;
      entryDelay = clock.fromMilliseconds(result.timestamp - candles[0].timestamp);
      hasEntered = true;
      events.push({
        type: 'entry',
        timestamp: result.timestamp,
        price: result.price,
        description: result.description,
        remainingPosition: 1,
        pnlSoFar: 0,
      });
    } else {
      // No entry signal triggered within wait period
      return createNoTradeResult(candles, events, initialPrice, finalPrice);
    }
  }

  // Update lowest price tracking (unused for now)
  // lowestPriceTimeFromEntry = (lowestPriceTimestamp - candles[0].timestamp) / 60;

  // Add entry event if not already added (only if no signal-only entry was attempted)
  if (!trailingEntryUsed && events.length === 0 && !(entrySignal && entryCfg.initialEntry === 'none' && entryCfg.trailingEntry === 'none')) {
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
  events: LegacySimulationEvent[],
  clock: SimulationClock
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
        entryDelay: clock.fromMilliseconds(candle.timestamp - candles[0].timestamp),
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
  events: LegacySimulationEvent[],
  clock: SimulationClock
): {
  triggered: boolean;
  price: number;
  entryDelay: number;
  lowestPrice: number;
  lowestPriceTimestamp: number;
} {
  const maxWaitTimestamp = candles[0].timestamp + clock.toMilliseconds(maxWaitTime);
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
        entryDelay: clock.fromMilliseconds(candle.timestamp - candles[0].timestamp),
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
 * Execute a trade using execution model or cost multiplier (fallback)
 *
 * @param side - Trade side ('buy' or 'sell')
 * @param price - Requested price
 * @param quantity - Trade quantity
 * @param marketPrice - Current market price (for execution model)
 * @param executionModel - Optional execution model
 * @param rng - Deterministic RNG (required if executionModel is provided)
 * @param entryCostMultiplier - Fallback cost multiplier for entry
 * @param exitCostMultiplier - Fallback cost multiplier for exit
 * @returns Executed price and fees
 */
function executeTrade(
  side: 'buy' | 'sell',
  price: number,
  quantity: number,
  marketPrice: number,
  executionModel: ExecutionModelInterface | undefined,
  rng: DeterministicRNG | undefined,
  entryCostMultiplier: number,
  exitCostMultiplier: number
): { executedPrice: number; fees: number } {
  if (executionModel && rng) {
    // Use execution model
    const tradeRequest: TradeRequest = {
      side,
      quantity,
      price,
      marketState: {
        price: marketPrice,
      },
    };
    const result = executionModel.execute(tradeRequest, rng);
    return {
      executedPrice: result.executedPrice,
      fees: result.fees,
    };
  } else {
    // Fallback to cost multiplier
    const costMultiplier = side === 'buy' ? entryCostMultiplier : exitCostMultiplier;
    const executedPrice = price * costMultiplier;
    // Fees are included in the multiplier, so we return 0 here
    // (fees are already baked into the price via multiplier)
    return {
      executedPrice,
      fees: 0,
    };
  }
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
  candleProvider?: CandleProvider,
  executionModel?: ExecutionModelInterface,
  rng?: DeterministicRNG,
  clock?: SimulationClock
): Promise<{
  pnl: number;
  lowestPrice: number;
  lowestPriceTimestamp: number;
  lowestPriceTimeFromEntry: number;
}> {
  // Calculate entry price with costs (for backward compatibility PnL calculation)
  const entryPriceWithCosts =
    executionModel && rng
      ? executeTrade(
          'buy',
          entryPrice,
          1.0,
          entryPrice,
          executionModel,
          rng,
          entryCostMultiplier,
          exitCostMultiplier
        ).executedPrice
      : entryPrice * entryCostMultiplier;
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
      lowestPriceTimeFromEntry = clock
        ? clock.fromMilliseconds(candle.timestamp - candles[0].timestamp)
        : (candle.timestamp - candles[0].timestamp) / 60; // Fallback for backward compatibility
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
        // Execute stop loss trade using execution model or cost multiplier
        const stopExecution = executeTrade(
          'sell',
          stopLoss,
          remaining,
          candle.close,
          executionModel,
          rng,
          entryCostMultiplier,
          exitCostMultiplier
        );
        const stopComponent = stopExecution.executedPrice / entryPriceWithCosts;
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
        // Execute profit target trade using execution model or cost multiplier
        const targetExecution = executeTrade(
          'sell',
          targetPrice,
          percent,
          candle.close,
          executionModel,
          rng,
          entryCostMultiplier,
          exitCostMultiplier
        );
        const realizedPrice = targetExecution.executedPrice;
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
        // Execute signal-based exit using execution model or cost multiplier
        const exitExecution = executeTrade(
          'sell',
          candle.close,
          remaining,
          candle.close,
          executionModel,
          rng,
          entryCostMultiplier,
          exitCostMultiplier
        );
        const exitComponent = exitExecution.executedPrice / entryPriceWithCosts;
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
    // Execute final exit using execution model or cost multiplier
    const finalExitExecution = executeTrade(
      'sell',
      finalPrice,
      remaining,
      finalPrice,
      executionModel,
      rng,
      entryCostMultiplier,
      exitCostMultiplier
    );
    const exitComponent = finalExitExecution.executedPrice / entryPriceWithCosts;
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

/**
 * Run a strategy simulation using causal candle accessor (Gate 2 compliant)
 *
 * This version uses incremental candle fetching to ensure causality:
 * at simulation time t, only candles with closeTime <= t are accessible.
 *
 * @param candleAccessor - Causal candle accessor
 * @param mint - Token mint address
 * @param startTime - Simulation start time (Unix timestamp in seconds)
 * @param endTime - Simulation end time (Unix timestamp in seconds)
 * @param strategy - Strategy profit targets
 * @param stopLossConfig - Stop loss configuration
 * @param entryConfig - Entry configuration
 * @param reEntryConfig - Re-entry configuration
 * @param costConfig - Fee and slippage configuration
 * @param options - Additional options (signals, ladders)
 * @returns Simulation result with PnL and events
 */
export async function simulateStrategyWithCausalAccessor(
  candleAccessor: CausalCandleAccessor,
  mint: string,
  startTime: number,
  endTime: number,
  strategy: StrategyLeg[],
  stopLossConfig?: StopLossConfig,
  entryConfig?: EntryConfig,
  reEntryConfig?: ReEntryConfig,
  costConfig?: CostConfig,
  options?: SimulationOptions & { interval?: CandleInterval }
): Promise<SimulationResult> {
  const interval: CandleInterval = options?.interval ?? '5m';
  const timeStep = getIntervalSeconds(interval);

  // Lookback window for indicators (e.g., 50 candles = 250 minutes for 5m)
  const indicatorLookback = 50 * timeStep;

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

  // Create execution model if provided
  const executionModel: ExecutionModelInterface | undefined = options?.executionModel
    ? createExecutionModel(options.executionModel)
    : undefined;

  // Create RNG for execution model
  const rng =
    options?.executionModel && options?.seed !== undefined
      ? createDeterministicRNG(options.seed)
      : options?.executionModel
        ? createDeterministicRNG(startTime) // Use startTime as seed fallback
        : undefined;

  // Create simulation clock
  const clockResolution: ClockResolution = options?.clockResolution ?? 'm';
  const clock: SimulationClock = createClock(clockResolution, startTime);

  // Cost multipliers
  const entryCostMultiplier = getEntryCostMultiplier(costs);
  const exitCostMultiplier = getExitCostMultiplier(costs);

  // Pre-fetch initial lookback window for indicators
  const initialCandles = await candleAccessor.getCandlesAtTime(
    mint,
    startTime,
    indicatorLookback,
    interval
  );

  if (initialCandles.length === 0) {
    return createEmptyResult();
  }

  // Calculate initial indicators
  const perfMonitor = getPerformanceMonitor();
  let indicatorSeries = await perfMonitor.measure(
    'calculateIndicators',
    async () => {
      return calculateIndicatorSeriesOptimized(initialCandles, calculateIndicatorSeries);
    },
    { candleCount: initialCandles.length }
  );

  let candles: Candle[] = [...initialCandles];
  const events: LegacySimulationEvent[] = [];

  // Initial state
  const initialPrice = initialCandles[0].open;
  let actualEntryPrice = initialPrice;
  let entryDelay = 0;
  let trailingEntryUsed = false;
  let hasEntered = entryCfg.initialEntry === 'none';

  // Handle initial entry (wait for drop)
  if (entryCfg.initialEntry !== 'none') {
    const result = await handleInitialEntryWithCausalAccessor(
      candleAccessor,
      mint,
      startTime,
      endTime,
      indicatorSeries,
      entryCfg.initialEntry as number,
      entrySignal,
      events,
      clock,
      interval,
      timeStep,
      indicatorLookback
    );

    if (result.triggered) {
      actualEntryPrice = result.price;
      entryDelay = result.entryDelay;
      hasEntered = true;
      // Update candles and indicators if we advanced in time
      if (result.currentTime > startTime) {
        const newCandles = await candleAccessor.getCandlesAtTime(
          mint,
          result.currentTime,
          indicatorLookback,
          interval
        );
        if (newCandles.length > candles.length) {
          const _newCandleSlice = newCandles.slice(candles.length);
          indicatorSeries = updateIndicatorsIncremental(
            indicatorSeries,
            _newCandleSlice,
            newCandles
          );
          candles = newCandles;
        }
      }
    } else {
      // No trade - price never dropped enough
      const finalCandle = await candleAccessor.getLastClosedCandle(mint, endTime, interval);
      const finalPrice = finalCandle?.close ?? initialPrice;
      return createNoTradeResult(candles, events, initialPrice, finalPrice);
    }
  }

  // Handle trailing entry
  if (!hasEntered && entryCfg.trailingEntry !== 'none') {
    const maxWaitTime = entryCfg.maxWaitTime ?? DEFAULT_ENTRY.maxWaitTime ?? 60;
    const result = await handleTrailingEntryWithCausalAccessor(
      candleAccessor,
      mint,
      startTime,
      endTime,
      indicatorSeries,
      entryCfg.trailingEntry as number,
      maxWaitTime,
      entrySignal,
      events,
      clock,
      interval,
      timeStep,
      indicatorLookback
    );

    if (result.triggered) {
      actualEntryPrice = result.price;
      entryDelay = result.entryDelay;
      trailingEntryUsed = true;
      hasEntered = true;
      // Update candles and indicators
      if (result.currentTime > startTime) {
        const newCandles = await candleAccessor.getCandlesAtTime(
          mint,
          result.currentTime,
          indicatorLookback,
          interval
        );
        if (newCandles.length > candles.length) {
          const _newCandleSlice = newCandles.slice(candles.length);
          indicatorSeries = updateIndicatorsIncremental(
            indicatorSeries,
            _newCandleSlice,
            newCandles
          );
          candles = newCandles;
        }
      }
    }
  }

  // Add entry event if not already added
  if (!trailingEntryUsed && events.length === 0) {
    events.push({
      type: 'entry',
      timestamp: startTime,
      price: actualEntryPrice,
      description: `Entry at $${actualEntryPrice.toFixed(8)}`,
      remainingPosition: 1,
      pnlSoFar: 0,
    });
  }

  // Run main simulation loop with causal accessor
  const entryTime = events.length > 0 ? events[0].timestamp : startTime;
  const loopResult = await runSimulationLoopWithCausalAccessor(
    candleAccessor,
    mint,
    entryTime,
    endTime,
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
    options?.candleProvider,
    executionModel,
    rng,
    clock,
    interval,
    timeStep,
    indicatorLookback
  );

  // Get final price
  const finalCandle = await candleAccessor.getLastClosedCandle(mint, endTime, interval);
  const finalPrice =
    finalCandle?.close ?? (candles.length > 0 ? candles[candles.length - 1].close : initialPrice);

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
 * Handle initial entry with causal accessor (simplified - uses time-based iteration)
 */
async function handleInitialEntryWithCausalAccessor(
  candleAccessor: CausalCandleAccessor,
  mint: string,
  startTime: number,
  endTime: number,
  indicators: readonly LegacyIndicatorData[],
  dropPercent: number,
  entrySignal: SignalGroup | undefined,
  events: LegacySimulationEvent[],
  clock: SimulationClock,
  interval: CandleInterval,
  timeStep: number,
  indicatorLookback: number
): Promise<{
  triggered: boolean;
  price: number;
  entryDelay: number;
  currentTime: number;
}> {
  // Get initial candle
  const initialCandle = await candleAccessor.getLastClosedCandle(mint, startTime, interval);
  if (!initialCandle) {
    return { triggered: false, price: 0, entryDelay: 0, currentTime: startTime };
  }

  const initialPrice = initialCandle.open;
  const triggerPrice = initialPrice * (1 + dropPercent);

  let currentTime = startTime;
  let candles: Candle[] = [initialCandle];
  let indicatorIndex = 0;

  while (currentTime <= endTime) {
    const currentCandle = await candleAccessor.getLastClosedCandle(mint, currentTime, interval);
    if (!currentCandle) {
      currentTime += timeStep;
      continue;
    }

    // Update candles if new one arrived
    if (currentCandle.timestamp > candles[candles.length - 1]?.timestamp) {
      candles.push(currentCandle);
      // Update indicators incrementally
      const newCandles = await candleAccessor.getCandlesAtTime(
        mint,
        currentTime,
        indicatorLookback,
        interval
      );
      if (newCandles.length > candles.length) {
        const _newCandleSlice = newCandles.slice(candles.length);
        // Note: We'd need to update indicators here, but for simplicity, we'll use the existing ones
        candles = newCandles;
        indicatorIndex = candles.length - 1;
      }
    }

    if (currentCandle.low <= triggerPrice) {
      // Check signal if required
      if (entrySignal && indicatorIndex < indicators.length) {
        const result = evaluateSignalGroup(entrySignal, {
          candle: currentCandle,
          indicators: indicators[Math.min(indicatorIndex, indicators.length - 1)],
          prevIndicators: indicatorIndex > 0 ? indicators[indicatorIndex - 1] : undefined,
        });
        if (!result.satisfied) {
          currentTime += timeStep;
          continue;
        }
      }

      events.push({
        type: 'entry',
        timestamp: currentCandle.timestamp,
        price: triggerPrice,
        description: `Initial entry at $${triggerPrice.toFixed(8)} (${(Math.abs(dropPercent) * 100).toFixed(0)}% drop)`,
        remainingPosition: 1,
        pnlSoFar: 0,
      });

      return {
        triggered: true,
        price: triggerPrice,
        entryDelay: clock.fromMilliseconds(currentCandle.timestamp - startTime),
        currentTime: currentCandle.timestamp,
      };
    }

    currentTime += timeStep;
  }

  // No trade
  events.push({
    type: 'entry',
    timestamp: startTime,
    price: initialPrice,
    description: `No trade: price never dropped ${(Math.abs(dropPercent) * 100).toFixed(0)}%`,
    remainingPosition: 0,
    pnlSoFar: 0,
  });

  return { triggered: false, price: initialPrice, entryDelay: 0, currentTime };
}

/**
 * Handle trailing entry with causal accessor (simplified)
 */
async function handleTrailingEntryWithCausalAccessor(
  candleAccessor: CausalCandleAccessor,
  mint: string,
  startTime: number,
  endTime: number,
  indicators: readonly LegacyIndicatorData[],
  trailingPercent: number,
  maxWaitTime: number,
  entrySignal: SignalGroup | undefined,
  events: LegacySimulationEvent[],
  clock: SimulationClock,
  interval: CandleInterval,
  timeStep: number,
  _indicatorLookback: number
): Promise<{
  triggered: boolean;
  price: number;
  entryDelay: number;
  lowestPrice: number;
  lowestPriceTimestamp: number;
  currentTime: number;
}> {
  const maxWaitTimestamp = startTime + clock.toMilliseconds(maxWaitTime);
  let lowestPrice =
    (await candleAccessor.getLastClosedCandle(mint, startTime, interval))?.open ?? 0;
  let lowestPriceTimestamp = startTime;
  let currentTime = startTime;

  // Find lowest price within wait period
  while (currentTime <= Math.min(maxWaitTimestamp, endTime)) {
    const candle = await candleAccessor.getLastClosedCandle(mint, currentTime, interval);
    if (candle && candle.low < lowestPrice) {
      lowestPrice = candle.low;
      lowestPriceTimestamp = candle.timestamp;
    }
    currentTime += timeStep;
  }

  const trailingTrigger = lowestPrice * (1 + trailingPercent);
  currentTime = startTime;

  // Look for rebound
  while (currentTime <= Math.min(maxWaitTimestamp, endTime)) {
    const candle = await candleAccessor.getLastClosedCandle(mint, currentTime, interval);
    if (candle && candle.high >= trailingTrigger) {
      if (entrySignal) {
        // Simplified signal check
        const result = evaluateSignalGroup(entrySignal, {
          candle,
          indicators: indicators[indicators.length - 1] ?? indicators[0],
          prevIndicators: indicators.length > 1 ? indicators[indicators.length - 2] : undefined,
        });
        if (!result.satisfied) {
          currentTime += timeStep;
          continue;
        }
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
        entryDelay: clock.fromMilliseconds(candle.timestamp - startTime),
        lowestPrice,
        lowestPriceTimestamp,
        currentTime: candle.timestamp,
      };
    }
    currentTime += timeStep;
  }

  return {
    triggered: false,
    price: lowestPrice,
    entryDelay: 0,
    lowestPrice,
    lowestPriceTimestamp,
    currentTime,
  };
}

/**
 * Main simulation loop with causal accessor (time-based iteration)
 */
async function runSimulationLoopWithCausalAccessor(
  candleAccessor: CausalCandleAccessor,
  mint: string,
  startTime: number,
  endTime: number,
  initialCandles: Candle[],
  initialIndicators: LegacyIndicatorData[],
  strategy: StrategyLeg[],
  stopCfg: StopLossConfig,
  reEntryCfg: ReEntryConfig,
  costs: CostConfig,
  entryPrice: number,
  entryCostMultiplier: number,
  exitCostMultiplier: number,
  exitSignal: SignalGroup | undefined,
  events: LegacySimulationEvent[],
  candleProvider?: CandleProvider,
  executionModel?: ExecutionModelInterface,
  rng?: DeterministicRNG,
  clock?: SimulationClock,
  interval: CandleInterval = '5m',
  timeStep: number = 300,
  _indicatorLookback: number = 15000
): Promise<{
  pnl: number;
  lowestPrice: number;
  lowestPriceTimestamp: number;
  lowestPriceTimeFromEntry: number;
}> {
  // Calculate entry price with costs
  const entryPriceWithCosts =
    executionModel && rng
      ? executeTrade(
          'buy',
          entryPrice,
          1.0,
          entryPrice,
          executionModel,
          rng,
          entryCostMultiplier,
          exitCostMultiplier
        ).executedPrice
      : entryPrice * entryCostMultiplier;

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
  let lastExitTime = -1; // Track last exit time for sequential re-entry validation

  let lowestPrice = entryPrice;
  let lowestPriceTimestamp = startTime;
  let lowestPriceTimeFromEntry = 0;

  let candles: Candle[] = [...initialCandles];
  let indicatorSeries: LegacyIndicatorData[] = [...initialIndicators];
  let candleIndex = 0; // Track current candle index

  let currentTime = startTime;

  while (currentTime <= endTime) {
    // Fetch candles available at current time (causal gate)
    const availableCandles = await candleAccessor.getCandlesAtTime(
      mint,
      currentTime,
      _indicatorLookback,
      interval
    );

    // Update candles and indicators if new ones arrived
    if (availableCandles.length > candles.length) {
      const newCandles = availableCandles.slice(candles.length);
      indicatorSeries = updateIndicatorsIncremental(indicatorSeries, newCandles, availableCandles);
      candles = availableCandles;
    }

    // Get current candle (last closed at currentTime)
    const currentCandle = await candleAccessor.getLastClosedCandle(mint, currentTime, interval);
    if (!currentCandle) {
      currentTime += timeStep;
      continue;
    }

    // Find candle index
    const candleIdx = candles.findIndex((c) => c.timestamp === currentCandle.timestamp);
    if (candleIdx < 0) {
      currentTime += timeStep;
      continue;
    }

    candleIndex = candleIdx;

    // Track price extremes
    if (currentCandle.low < lowestPrice) {
      lowestPrice = currentCandle.low;
      lowestPriceTimestamp = currentCandle.timestamp;
      lowestPriceTimeFromEntry = clock
        ? clock.fromMilliseconds(currentCandle.timestamp - startTime)
        : (currentCandle.timestamp - startTime) / 60;
    }
    if (currentCandle.high > currentPeakPrice) {
      currentPeakPrice = currentCandle.high;
    }

    // 1. Update rolling trailing stop
    if (hasRollingTrailing && trailingStopState) {
      const trailingPercent = stopCfg.trailingPercent ?? 0.25;
      trailingStopState = updateRollingTrailingStop(
        trailingStopState,
        currentCandle,
        candleIndex,
        trailingPercent
      );
      stopLoss = trailingStopState.currentStop;
    } else if (hasTrailing && !stopMovedToEntry) {
      const trailingTrigger = entryPrice * (1 + (stopCfg.trailing as number));
      if (currentCandle.high >= trailingTrigger) {
        stopLoss = entryPrice;
        stopMovedToEntry = true;
        events.push({
          type: 'stop_moved',
          timestamp: currentCandle.timestamp,
          price: currentCandle.high,
          description: `Trailing stop at $${currentCandle.high.toFixed(8)} (${((stopCfg.trailing as number) * 100).toFixed(0)}% gain)`,
          remainingPosition: remaining,
          pnlSoFar: pnl,
        });
      }
    }

    // 2. Check re-entry with sequential validation
    if (waitingForReEntry && currentCandle.low <= reEntryTriggerPrice) {
      // Validate sequential ordering (simplified - check if stop loss was hit)
      if (lastExitTime >= 0) {
        // Check if stop loss was hit between exit and re-entry
        let stopLossHit = false;
        let checkTime = lastExitTime;
        while (checkTime < currentCandle.timestamp) {
          const checkCandle = await candleAccessor.getLastClosedCandle(mint, checkTime, interval);
          if (checkCandle && checkCandle.low <= stopLoss) {
            stopLossHit = true;
            break;
          }
          checkTime += timeStep;
        }

        if (stopLossHit) {
          events.push({
            type: 're_entry_rejected',
            timestamp: currentCandle.timestamp,
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

      if (hasRollingTrailing) {
        trailingStopState = initTrailingStopState(reEntryTriggerPrice, stopCfg);
      }

      events.push({
        type: 're_entry',
        timestamp: currentCandle.timestamp,
        price: reEntryTriggerPrice,
        description: `Re-entry at $${reEntryTriggerPrice.toFixed(8)} (${((reEntryCfg.trailingReEntry as number) * 100).toFixed(0)}% retrace)`,
        remainingPosition: remaining,
        pnlSoFar: pnl,
      });
      currentTime += timeStep;
      continue;
    }

    // 3. Check stop loss
    if (remaining > 0) {
      const targetPrice =
        targetIndex < strategy.length ? entryPrice * strategy[targetIndex].target : Infinity;

      const sequentialResult = await checkStopLossSequential(
        currentCandle,
        stopLoss,
        targetPrice,
        candleProvider
      );

      if (sequentialResult.outcome === 'stop_loss') {
        const stopExecution = executeTrade(
          'sell',
          stopLoss,
          remaining,
          currentCandle.close,
          executionModel,
          rng,
          entryCostMultiplier,
          exitCostMultiplier
        );
        const stopComponent = stopExecution.executedPrice / entryPriceWithCosts;
        const stopPnl = remaining * stopComponent;
        pnl += stopPnl;

        events.push({
          type: 'stop_loss',
          timestamp: currentCandle.timestamp,
          price: stopLoss,
          description: `Stop loss at $${stopLoss.toFixed(8)} (${((stopLoss / entryPrice - 1) * 100).toFixed(1)}%) [${sequentialResult.resolutionMethod}]`,
          remainingPosition: 0,
          pnlSoFar: pnl,
        });
        remaining = 0;
        lastExitTime = currentCandle.timestamp;

        if (reEntryCfg.trailingReEntry !== 'none' && reEntryCount < reEntryCfg.maxReEntries) {
          reEntryTriggerPrice = entryPrice * (1 - (reEntryCfg.trailingReEntry as number));
          waitingForReEntry = true;
        } else {
          break;
        }
        currentTime += timeStep;
        continue;
      }
    }

    // 4. Check profit targets
    if (remaining > 0 && targetIndex < strategy.length) {
      const { percent, target } = strategy[targetIndex];
      const targetPrice = entryPrice * target;

      if (currentCandle.high >= targetPrice) {
        const targetExecution = executeTrade(
          'sell',
          targetPrice,
          percent,
          currentCandle.close,
          executionModel,
          rng,
          entryCostMultiplier,
          exitCostMultiplier
        );
        const realizedPrice = targetExecution.executedPrice;
        const targetPnl = percent * (realizedPrice / entryPriceWithCosts);
        pnl += targetPnl;
        remaining = Math.max(0, remaining - percent);

        events.push({
          type: 'target_hit',
          timestamp: currentCandle.timestamp,
          price: targetPrice,
          description: `Target ${target}x hit (sold ${(percent * 100).toFixed(0)}%)`,
          remainingPosition: remaining,
          pnlSoFar: pnl,
        });
        targetIndex++;
        lastExitTime = currentCandle.timestamp;

        if (reEntryCfg.trailingReEntry !== 'none' && reEntryCount < reEntryCfg.maxReEntries) {
          reEntryTriggerPrice = targetPrice * (1 - (reEntryCfg.trailingReEntry as number));
          waitingForReEntry = true;
        }
      }
    }

    // 5. Check exit signal
    if (exitSignal && remaining > 0 && candleIndex < indicatorSeries.length) {
      const lookbackContext = {
        candles,
        indicators: indicatorSeries,
        currentIndex: candleIndex,
      };

      const result = evaluateSignalGroup(
        exitSignal,
        {
          candle: currentCandle,
          indicators: indicatorSeries[candleIndex],
          prevIndicators: candleIndex > 0 ? indicatorSeries[candleIndex - 1] : undefined,
        },
        lookbackContext
      );

      if (result.satisfied) {
        const exitExecution = executeTrade(
          'sell',
          currentCandle.close,
          remaining,
          currentCandle.close,
          executionModel,
          rng,
          entryCostMultiplier,
          exitCostMultiplier
        );
        const exitComponent = exitExecution.executedPrice / entryPriceWithCosts;
        const finalComponent = remaining * exitComponent;
        pnl += finalComponent;

        events.push({
          type: 'final_exit',
          timestamp: currentCandle.timestamp,
          price: currentCandle.close,
          description: `Signal-based exit ${(remaining * 100).toFixed(0)}% at $${currentCandle.close.toFixed(8)}`,
          remainingPosition: 0,
          pnlSoFar: pnl,
        });
        remaining = 0;
        break;
      }
    }

    currentTime += timeStep;
  }

  // Final exit if position remains
  if (remaining > 0) {
    const finalCandle = await candleAccessor.getLastClosedCandle(mint, endTime, interval);
    const finalPrice =
      finalCandle?.close ?? (candles.length > 0 ? candles[candles.length - 1].close : entryPrice);
    const finalExitExecution = executeTrade(
      'sell',
      finalPrice,
      remaining,
      finalPrice,
      executionModel,
      rng,
      entryCostMultiplier,
      exitCostMultiplier
    );
    const exitComponent = finalExitExecution.executedPrice / entryPriceWithCosts;
    const finalComponent = remaining * exitComponent;
    pnl += finalComponent;

    events.push({
      type: 'final_exit',
      timestamp: finalCandle?.timestamp ?? endTime,
      price: finalPrice,
      description: `Final exit ${(remaining * 100).toFixed(0)}% at $${finalPrice.toFixed(8)}`,
      remainingPosition: 0,
      pnlSoFar: pnl,
    });
  }

  return { pnl, lowestPrice, lowestPriceTimestamp, lowestPriceTimeFromEntry };
}

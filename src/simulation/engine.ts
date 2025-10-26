import { Candle } from './candles';

/* ============================================================================
 * STRATEGY SIMULATION TYPES AND CONFIGURATION
 * ============================================================================
 */

/**
 * Defines a single take-profit level in the strategy.
 * - percent: Fraction of position to sell at the specific target (0-1)
 * - target: Multiple of entry price to trigger this take profit (e.g. 2 for 2x)
 */
export type Strategy = { 
  percent: number;
  target: number;
};

/**
 * Configuration for stop-loss management.
 * - initial: Sets the stop-loss below entry (e.g. -0.3 for -30%)
 * - trailing: Percentage gain to activate trailing stop-loss to break-even (number or 'none')
 */
export type StopLossConfig = {
  initial: number;
  trailing: number | 'none';
};

/**
 * Describes parameters for entry optimization.
 * - initialEntry: Percentage drop from alert price before initial entry (e.g. -0.3 for 30% drop, 'none' to enter immediately)
 * - trailingEntry: Enables a "wait for rebound from low" entry (number or 'none')
 * - maxWaitTime: Minutes to wait maximum for the entry conditions
 */
export type EntryConfig = {
  initialEntry: number | 'none';
  trailingEntry: number | 'none';
  maxWaitTime: number;
};

/**
 * Re-entry configuration for after hitting profit targets.
 * - trailingReEntry: percent retrace from peak to trigger re-entry (e.g. 0.5 for 50% retrace)
 * - maxReEntries: maximum number of re-entries allowed per simulation
 */
export type ReEntryConfig = {
  trailingReEntry: number | 'none';
  maxReEntries: number;
};

/**
 * Structure for the detailed result of the simulation, including key stats
 * and every major event throughout the trade's lifetime.
 */
export type SimulationResult = {
  finalPnl: number;        // Final PnL, sum of all realized/finalized gains and losses (relative)
  events: SimulationEvent[]; // Chronological simulation event log for auditability
  entryPrice: number;      // Simulated entry price
  finalPrice: number;      // Final candle close price in simulation window
  totalCandles: number;    // Number of candles processed in simulation
  entryOptimization: {     // Detailed stats regarding entry price optimization
    lowestPrice: number;
    lowestPriceTimestamp: number;
    lowestPricePercent: number; // Percent lower than entry price reached during wait
    lowestPriceTimeFromEntry: number; // Minutes from entry to lowest
    trailingEntryUsed: boolean; // Was a trailing entry used
    actualEntryPrice: number;   // The actual executed entry price
    entryDelay: number;         // Minutes spent waiting for the entry in optimization
  };
};

/**
 * Every major simulation occurrence (entry, TP, SL, exit, etc)
 */
export type SimulationEvent = {
  type:
    | 'entry'
    | 'stop_moved'
    | 'target_hit'
    | 'stop_loss'
    | 'final_exit'
    | 'trailing_entry_triggered'
    | 're_entry';
  timestamp: number;           // Unix timestamp of the event
  price: number;               // Price at event occurrence
  description: string;         // Human-readable single-line description for logs
  remainingPosition: number;   // What fraction of original position is still open
  pnlSoFar: number;            // Cumulative PnL up to this event
};

/* ============================================================================
 * MAIN STRATEGY SIMULATION FUNCTION
 * ============================================================================
 */

/**
 * Simulates a multi-part trading strategy with optional stop-loss/trailing stops
 * and entry optimization (such as trailing entries). Generates a detailed
 * event log and statistics for backtesting, strategy design, and review.
 * 
 * @param candles        Chronological price series (candlestick data)
 * @param strategy       Array of take-profit levels and sell sizes
 * @param stopLossConfig (optional) Stop-loss and trailing configuration
 * @param entryConfig    (optional) Entry optimization configuration
 * @param reEntryConfig  (optional) Re-entry configuration after profit targets
 * @returns              SimulationResult - Complete stats and audit trail
 */
export function simulateStrategy(
  candles: Candle[],
  strategy: Strategy[],
  stopLossConfig?: StopLossConfig,
  entryConfig?: EntryConfig,
  reEntryConfig?: ReEntryConfig
): SimulationResult {

  // --------------------------------------------------------------------------
  // 0. HANDLE EDGE CASE OF NO PRICE DATA
  // --------------------------------------------------------------------------
  if (!candles.length) {
    // No data available: Return empty result
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

  // --------------------------------------------------------------------------
  // 1. INITIAL CORE VARIABLES AND DEFAULTS
  // --------------------------------------------------------------------------
  const caDropPrice = candles[0].open; // Default entry: Coin announcement drop
  const finalPrice = candles[candles.length - 1].close; // Price for forced exit at the end

  // Apply entry config or default
  const entryCfg: EntryConfig = entryConfig || { initialEntry: 'none', trailingEntry: 'none', maxWaitTime: 60 };

  // Entry price optimization trackers
  let lowestPrice = caDropPrice;
  let lowestPriceTimestamp = candles[0].timestamp;
  let lowestPriceTimeFromEntry = 0;
  let actualEntryPrice = caDropPrice;
  let entryDelay = 0;                 // Time delayed for "optimized" entry, in mins
  let trailingEntryUsed = false;      // Did we use trailing entry wait?
  let hasEntered = false;             // Entry flag for trailing entry logic
  let initialEntryTriggered = false; // Whether initial entry drop has been triggered

  // Track alert price for initial entry optimization
  const alertPrice = caDropPrice;

  // Chronological trade events timeline
  const events: SimulationEvent[] = [];

  // --------------------------------------------------------------------------
  // 2. ENTRY OPTIMIZATION AND TRAILING ENTRY LOGIC
  // --------------------------------------------------------------------------
  
  // Check if initial entry optimization is enabled (wait for drop from alert price)
  if (entryCfg.initialEntry !== 'none') {
    const dropPercent = entryCfg.initialEntry as number; // e.g. -0.3 for 30% drop
    const entryTriggerPrice = alertPrice * (1 + dropPercent); // Price to drop to before entry
    
    // Wait for price to drop to trigger level
    for (const candle of candles) {
      if (candle.low <= entryTriggerPrice) {
        // Entry triggered after drop
        actualEntryPrice = entryTriggerPrice;
        entryDelay = (candle.timestamp - candles[0].timestamp) / 60;
        initialEntryTriggered = true;
        hasEntered = true;
        
        // Document initial entry event
        events.push({
          type: 'entry',
          timestamp: candle.timestamp,
          price: actualEntryPrice,
          description: `Initial entry at $${actualEntryPrice.toFixed(8)} (${(Math.abs(dropPercent) * 100).toFixed(0)}% drop from alert)`,
          remainingPosition: 1,
          pnlSoFar: 0,
        });
        break;
      }
    }
    
    // If initial entry wasn't triggered, don't enter at all
    if (!initialEntryTriggered) {
      // Mark that we never entered
      events.push({
        type: 'entry',
        timestamp: candles[0].timestamp,
        price: alertPrice,
        description: `Never entered - price did not drop ${(Math.abs(dropPercent) * 100).toFixed(0)}% from alert`,
        remainingPosition: 0,
        pnlSoFar: 0,
      });
      return { 
        finalPnl: 0, 
        totalCandles: candles.length, 
        events, 
        entryOptimization: { lowestPrice, lowestPriceTimestamp, lowestPricePercent: 0, lowestPriceTimeFromEntry, trailingEntryUsed: false, actualEntryPrice, entryDelay },
        entryPrice: alertPrice,
        finalPrice: candles[candles.length - 1].close
      };
    }
  } else {
    // Default immediate entry
    hasEntered = true;
  }
  
  // Trailing entry logic (for re-entries after exits)
  if (entryCfg.trailingEntry !== 'none') {
    // Trailing entry percent as decimal (e.g. 0.1 for 10%)
    const trailingEntryPercent = entryCfg.trailingEntry as number;
    // After maxWaitTime mins, must enter by that candle
    const maxWaitTimestamp = candles[0].timestamp + (entryCfg.maxWaitTime * 60);

    // Step 1: Find lowest low reached within waiting period
    for (const candle of candles) {
      if (candle.timestamp > maxWaitTimestamp) break;
      if (candle.low < lowestPrice) {
        lowestPrice = candle.low;
        lowestPriceTimestamp = candle.timestamp;
      }
    }

    // Step 2: Watch for price action rebounding trailingEntryPercent above the low
    const trailingEntryTrigger = lowestPrice * (1 + trailingEntryPercent);

    for (const candle of candles) {
      if (candle.timestamp > maxWaitTimestamp) break;
      if (candle.high >= trailingEntryTrigger) {
        // Entry triggered post-rebound from lowest
        actualEntryPrice = trailingEntryTrigger;
        entryDelay = (candle.timestamp - candles[0].timestamp) / 60;
        trailingEntryUsed = true;
        hasEntered = true;

        // Document trailing entry event explicitly for logs
        events.push({
          type: 'trailing_entry_triggered',
          timestamp: candle.timestamp,
          price: actualEntryPrice,
          description: `Trailing entry triggered at $${actualEntryPrice.toFixed(8)} (${(trailingEntryPercent * 100).toFixed(1)}% from lowest $${lowestPrice.toFixed(8)})`,
          remainingPosition: 1,
          pnlSoFar: 0,
        });
        break;
      }
    }

    // Step 3: If rebound doesn't occur before maxWait, enter at last candle's close before timeout
    if (!hasEntered) {
      const lastCandleBeforeTimeout = candles.find(c => c.timestamp <= maxWaitTimestamp) || candles[candles.length - 1];
      actualEntryPrice = lastCandleBeforeTimeout.close;
      entryDelay = (lastCandleBeforeTimeout.timestamp - candles[0].timestamp) / 60;
    }
  }

  // Calculate the time in minutes from start to the post-optimization low
  lowestPriceTimeFromEntry = (lowestPriceTimestamp - candles[0].timestamp) / 60;

  // --------------------------------------------------------------------------
  // 3. STOP LOSS AND TRAILING STOP SETUP
  // --------------------------------------------------------------------------
  // Use configured params or defaults (very wide SL & trailing)
  const stopConfig: StopLossConfig = stopLossConfig || { initial: -0.5, trailing: 0.5 };
  let stopLoss = actualEntryPrice * (1 + stopConfig.initial); // Price at which to exit remaining if hit
  let stopMovedToEntry = false;                               // Tracks if trailing has moved SL to entry
  const hasTrailing = stopConfig.trailing !== 'none';         // Is trailing enabled

  // --------------------------------------------------------------------------
  // 4. SIMULATION STATE MANAGEMENT (POS/NEXT TARGETS/PnL)
  // --------------------------------------------------------------------------
  let pnl = 0;                      // Accumulated performance (includes forced final exit)
  let remaining = 1;                // Position still open (1 = all open, 0 = all sold)
  let targetIndex = 0;              // Which take-profit target to aim for next

  // Re-entry configuration and state
  const reEntryCfg: ReEntryConfig = reEntryConfig || { trailingReEntry: 'none', maxReEntries: 0 };
  let reEntryCount = 0;
  let currentPeakPrice = actualEntryPrice; // Track highest price since last entry/re-entry
  let waitingForReEntry = false;
  let reEntryTriggerPrice = 0;

  // --------------------------------------------------------------------------
  // 5. INITIAL ENTRY EVENT LOGGING
  // --------------------------------------------------------------------------
  // If we DID NOT just do a trailing entry event, log a classic entry
  if (!trailingEntryUsed) {
    events.push({
      type: 'entry',
      timestamp: candles[0].timestamp,
      price: actualEntryPrice,
      description: `Entry at $${actualEntryPrice.toFixed(8)}`,
      remainingPosition: 1,
      pnlSoFar: 0,
    });
  }

  // --------------------------------------------------------------------------
  // 6. MAIN SIMULATION (CANDLE BY CANDLE PROCESSING)
  // --------------------------------------------------------------------------
  for (const candle of candles) {

    // ------------------------
    // ENTRY ANALYTICS - TRACK LOWEST LOW POST-ENTRY (for metrics)
    // ------------------------
    if (candle.low < lowestPrice) {
      lowestPrice = candle.low;
      lowestPriceTimestamp = candle.timestamp;
      lowestPriceTimeFromEntry = (candle.timestamp - candles[0].timestamp) / 60;
    }
    
    // Update peak price tracking for re-entry logic
    if (candle.high > currentPeakPrice) {
      currentPeakPrice = candle.high;
    }

    // ------------------------
    // TRAILING STOP CHECK - IF ENABLED AND NOT YET FIRED
    // ------------------------
    if (hasTrailing && !stopMovedToEntry) {
      const trailingTrigger = actualEntryPrice * (1 + (stopConfig.trailing as number));
      if (candle.high >= trailingTrigger) {
        // Price reached trailing level: move stop-loss to entry/break-even
        stopLoss = actualEntryPrice;
        stopMovedToEntry = true;

        events.push({
          type: 'stop_moved',
          timestamp: candle.timestamp,
          price: candle.high, // Use the actual high price that triggered the trailing stop
          description: `Trailing stop activated at $${candle.high.toFixed(8)} (${((stopConfig.trailing as number) * 100).toFixed(0)}% gain hit)`,
          remainingPosition: remaining,
          pnlSoFar: pnl,
        });
      }
    }

    // ------------------------
    // STOP LOSS HIT? IMMEDIATE EXIT AND END SIMULATION
    // ------------------------
    if (candle.low <= stopLoss) {
      // Calculate PNL as multiplier (consistent with take-profit calculation)
      const stopPnl = remaining * (stopLoss / actualEntryPrice);
      pnl += stopPnl;
      events.push({
        type: 'stop_loss',
        timestamp: candle.timestamp,
        price: stopLoss,
        description: `STOP LOSS triggered at $${stopLoss.toFixed(8)} (${((stopLoss / actualEntryPrice - 1) * 100).toFixed(1)}%)`,
        remainingPosition: 0,
        pnlSoFar: pnl,
      });
      // Final exit due to stop -- short circuit and return; ensure all stats are filled
      return {
        finalPnl: pnl,
        events,
        entryPrice: actualEntryPrice,
        finalPrice,
        totalCandles: candles.length,
        entryOptimization: {
          lowestPrice,
          lowestPriceTimestamp,
          lowestPricePercent: (lowestPrice / actualEntryPrice - 1) * 100,
          lowestPriceTimeFromEntry,
          trailingEntryUsed,
          actualEntryPrice,
          entryDelay,
        },
      };
    }

    // ------------------------
    // TARGET PROFIT LEVELS - SELL PARTIALS IF TARGET(S) REACHED
    // ------------------------
    // Only proceed if there are unsold targets left
    if (targetIndex < strategy.length) {
      const { percent, target } = strategy[targetIndex];
      const targetPrice = actualEntryPrice * target;

      if (candle.high >= targetPrice) {
        // Target price hit: sell this percent of position
        const targetPnl = percent * target; // "Relative" PnL for this position segment
        pnl += targetPnl;
        remaining -= percent;

        events.push({
          type: 'target_hit',
          timestamp: candle.timestamp,
          price: targetPrice,
          description: `Target ${target}x hit! Sold ${(percent * 100).toFixed(0)}% at $${targetPrice.toFixed(8)}`,
          remainingPosition: remaining,
          pnlSoFar: pnl,
        });
        targetIndex++; // Focus on next sell target now
        
        // Check for re-entry opportunity after hitting a target
        if (reEntryCfg.trailingReEntry !== 'none' && reEntryCount < reEntryCfg.maxReEntries) {
          const retracePercent = reEntryCfg.trailingReEntry as number;
          reEntryTriggerPrice = targetPrice * (1 - retracePercent); // Price to retrace to for re-entry
          waitingForReEntry = true;
        }
      }
    }
    
    // Check for re-entry trigger if we're waiting for one
    if (waitingForReEntry && candle.low <= reEntryTriggerPrice) {
      // Re-entry triggered!
      const reEntryPrice = reEntryTriggerPrice;
      remaining += 0.5; // Re-enter with 50% of original position (adjustable)
      reEntryCount++;
      waitingForReEntry = false;
      
      // Reset stop loss for new entry
      stopLoss = reEntryPrice * (1 + stopConfig.initial);
      stopMovedToEntry = false; // Reset trailing stop state
      currentPeakPrice = reEntryPrice; // Reset peak tracking
      
      events.push({
        type: 're_entry',
        timestamp: candle.timestamp,
        price: reEntryPrice,
        description: `Re-entry at $${reEntryPrice.toFixed(8)} (${((reEntryCfg.trailingReEntry as number) * 100).toFixed(0)}% retrace from peak)`,
        remainingPosition: remaining,
        pnlSoFar: pnl
      });
    }
  }

  // --------------------------------------------------------------------------
  // 7. FINAL EXIT: ANY UNSOLD (REMAINING) PORTION IS EXITED AT FINAL CANDLE CLOSE
  // --------------------------------------------------------------------------
  if (remaining > 0) {
    const finalPnl = remaining * (finalPrice / actualEntryPrice);
    pnl += finalPnl;
    events.push({
      type: 'final_exit',
      timestamp: candles[candles.length - 1].timestamp,
      price: finalPrice,
      description: `Final exit: ${(remaining * 100).toFixed(0)}% at $${finalPrice.toFixed(8)} (${((finalPrice / actualEntryPrice - 1) * 100).toFixed(1)}%)`,
      remainingPosition: 0,
      pnlSoFar: pnl,
    });
  }

  // --------------------------------------------------------------------------
  // 8. COMPLETE RESULT: DETAIL ALL COLLECTED METRICS FOR THE CALLER
  // --------------------------------------------------------------------------
  return {
    finalPnl: pnl,
    events,
    entryPrice: actualEntryPrice,
    finalPrice,
    totalCandles: candles.length,
    entryOptimization: {
      lowestPrice,
      lowestPriceTimestamp,
      lowestPricePercent: (lowestPrice / actualEntryPrice - 1) * 100,
      lowestPriceTimeFromEntry,
      trailingEntryUsed,
      actualEntryPrice,
      entryDelay,
    },
  };
}

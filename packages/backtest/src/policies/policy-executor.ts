/**
 * Policy Executor (Phase 4 - MVP 2)
 *
 * Guardrail 3: Policy Execution Replays Candles
 * - Executes policies by iterating through candle stream
 * - Knows exactly what would have triggered when
 * - Path metrics are for evaluation only (tail capture calculation)
 *
 * Invariants:
 * - realizedReturnBps <= peakMultiple * 10000 (can't exceed peak)
 * - tailCapture <= 1.0 (can't capture more than peak)
 */

import type { Candle, DeterministicRNG } from '@quantbot/core';
import type {
  RiskPolicy,
  FixedStopPolicy,
  TimeStopPolicy,
  TrailingStopPolicy,
  LadderPolicy,
  ComboPolicy,
  WashReboundPolicy,
  PolicyExecutionResult,
} from './risk-policy.js';

// =============================================================================
// Re-export execution models from simulation for convenience
// =============================================================================
export {
  // Execution model types
  type ExecutionModel,
  type LatencyDistribution,
  type SlippageModel,
  type CostModel,
  type FailureModel,
  type PartialFillModel,
  // Model factories
  createPumpfunExecutionModel,
  createPumpswapExecutionModel,
  createMinimalExecutionModel,
  // Slippage utilities
  calculateSlippage,
  calculateEntrySlippage,
  calculateExitSlippage,
  // Latency utilities
  sampleLatency,
  sampleTotalLatency,
  // Cost utilities
  calculateTotalTransactionCost,
  calculateEffectiveCostPerTrade,
  // Adapters
  convertExecutionModelToCostConfig,
  calculateEffectiveSlippageBps,
} from '../sim/execution-models/index.js';

/**
 * Fee configuration (simple model)
 */
export interface FeeConfig {
  takerFeeBps: number;
  slippageBps: number;
}

/**
 * Extended fee configuration with execution model
 */
export interface ExecutionConfig extends FeeConfig {
  /**
   * Optional execution model for realistic fills.
   * If provided, overrides simple takerFeeBps/slippageBps with venue-specific models.
   */
  executionModel?: import('../sim/execution-models/types.js').ExecutionModel;
  /**
   * RNG for stochastic execution (latency, partial fills).
   * Required if executionModel is provided.
   */
  rng?: DeterministicRNG;
}

// =============================================================================
// Policy Executor
// =============================================================================

/**
 * Execute a policy against a candle stream
 *
 * @param candles Candle stream (chronological, timestamp in seconds)
 * @param alertTsMs Alert timestamp in milliseconds (entry point)
 * @param policy Risk policy to execute
 * @param fees Fee structure { takerFeeBps, slippageBps } or ExecutionConfig with execution model
 * @returns Policy execution result
 */
export function executePolicy(
  candles: Candle[],
  alertTsMs: number,
  policy: RiskPolicy,
  fees: FeeConfig | ExecutionConfig = { takerFeeBps: 30, slippageBps: 10 }
): PolicyExecutionResult {
  // Find entry candle (first candle at/after alert)
  let entryIdx = -1;
  for (let i = 0; i < candles.length; i++) {
    const tsMs = candles[i].timestamp * 1000;
    if (tsMs >= alertTsMs) {
      entryIdx = i;
      break;
    }
  }

  // No valid entry
  if (entryIdx === -1 || candles.length === 0) {
    return createNoEntryResult(alertTsMs);
  }

  const entryCandle = candles[entryIdx];
  const entryTsMs = entryCandle.timestamp * 1000;
  const entryPx = entryCandle.close;

  // Invalid entry price
  if (!isFinite(entryPx) || entryPx <= 0) {
    return createNoEntryResult(alertTsMs);
  }

  // Execute based on policy type
  switch (policy.kind) {
    case 'fixed_stop':
      return executeFixedStop(candles, entryIdx, entryPx, entryTsMs, policy, fees);
    case 'time_stop':
      return executeTimeStop(candles, entryIdx, entryPx, entryTsMs, policy, fees);
    case 'trailing_stop':
      return executeTrailingStop(candles, entryIdx, entryPx, entryTsMs, policy, fees);
    case 'ladder':
      return executeLadder(candles, entryIdx, entryPx, entryTsMs, policy, fees);
    case 'combo':
      return executeCombo(candles, entryIdx, entryPx, entryTsMs, policy, fees);
    case 'wash_rebound': {
      return executeWashRebound(candles, entryIdx, entryPx, entryTsMs, policy, fees);
    }
    default: {
      // Type guard - should never reach here
      const _exhaustive: never = policy;
      throw new Error(`Unknown policy kind: ${(_exhaustive as RiskPolicy).kind}`);
    }
  }
}

// =============================================================================
// Policy Executors
// =============================================================================

function executeFixedStop(
  candles: Candle[],
  entryIdx: number,
  entryPx: number,
  entryTsMs: number,
  policy: FixedStopPolicy,
  fees: FeeConfig | ExecutionConfig
): PolicyExecutionResult {
  const stopPrice = entryPx * (1 - policy.stopPct);
  const takeProfitPrice = policy.takeProfitPct
    ? entryPx * (1 + policy.takeProfitPct)
    : Number.POSITIVE_INFINITY;

  let exitIdx = candles.length - 1;
  let exitReason = 'end_of_data';
  let maxAdverseExcursionBps = 0;
  let peakHigh = entryPx;

  for (let i = entryIdx; i < candles.length; i++) {
    const c = candles[i];

    // Track peak
    if (c.high > peakHigh) peakHigh = c.high;

    // Track max adverse excursion
    const lowReturn = (c.low / entryPx - 1) * 10000;
    if (lowReturn < maxAdverseExcursionBps) {
      maxAdverseExcursionBps = lowReturn;
    }

    // Check stop (using low)
    if (c.low <= stopPrice) {
      exitIdx = i;
      exitReason = 'stop_loss';
      break;
    }

    // Check take profit (using high)
    if (c.high >= takeProfitPrice) {
      exitIdx = i;
      exitReason = 'take_profit';
      break;
    }
  }

  return buildResult(
    candles,
    entryIdx,
    exitIdx,
    entryPx,
    entryTsMs,
    exitReason,
    maxAdverseExcursionBps,
    peakHigh,
    fees,
    exitReason === 'stop_loss',
    exitReason === 'stop_loss' ? stopPrice : undefined,
    exitReason === 'take_profit' ? takeProfitPrice : undefined
  );
}

function executeTimeStop(
  candles: Candle[],
  entryIdx: number,
  entryPx: number,
  entryTsMs: number,
  policy: TimeStopPolicy,
  fees: FeeConfig | ExecutionConfig
): PolicyExecutionResult {
  const maxExitTsMs = entryTsMs + policy.maxHoldMs;
  const takeProfitPrice = policy.takeProfitPct
    ? entryPx * (1 + policy.takeProfitPct)
    : Number.POSITIVE_INFINITY;

  let exitIdx = candles.length - 1;
  let exitReason = 'end_of_data';
  let maxAdverseExcursionBps = 0;
  let peakHigh = entryPx;

  for (let i = entryIdx; i < candles.length; i++) {
    const c = candles[i];
    const tsMs = c.timestamp * 1000;

    // Track peak
    if (c.high > peakHigh) peakHigh = c.high;

    // Track max adverse excursion
    const lowReturn = (c.low / entryPx - 1) * 10000;
    if (lowReturn < maxAdverseExcursionBps) {
      maxAdverseExcursionBps = lowReturn;
    }

    // Check time stop
    if (tsMs >= maxExitTsMs) {
      exitIdx = i;
      exitReason = 'time_stop';
      break;
    }

    // Check take profit (using high)
    if (c.high >= takeProfitPrice) {
      exitIdx = i;
      exitReason = 'take_profit';
      break;
    }
  }

  return buildResult(
    candles,
    entryIdx,
    exitIdx,
    entryPx,
    entryTsMs,
    exitReason,
    maxAdverseExcursionBps,
    peakHigh,
    fees,
    false,
    undefined,
    exitReason === 'take_profit' ? takeProfitPrice : undefined
  );
}

function executeTrailingStop(
  candles: Candle[],
  entryIdx: number,
  entryPx: number,
  entryTsMs: number,
  policy: TrailingStopPolicy,
  fees: FeeConfig | ExecutionConfig
): PolicyExecutionResult {
  const activationPrice = entryPx * (1 + policy.activationPct);
  const hardStopPrice = policy.hardStopPct ? entryPx * (1 - policy.hardStopPct) : 0;

  let trailingActive = false;
  let trailPeak = entryPx;
  let trailStopPrice = 0;

  let exitIdx = candles.length - 1;
  let exitReason = 'end_of_data';
  let maxAdverseExcursionBps = 0;
  let peakHigh = entryPx;
  let stoppedOut = false;

  for (let i = entryIdx; i < candles.length; i++) {
    const c = candles[i];

    // Track peak
    if (c.high > peakHigh) peakHigh = c.high;

    // Track max adverse excursion
    const lowReturn = (c.low / entryPx - 1) * 10000;
    if (lowReturn < maxAdverseExcursionBps) {
      maxAdverseExcursionBps = lowReturn;
    }

    // Check hard stop first (always active)
    if (hardStopPrice > 0 && c.low <= hardStopPrice) {
      exitIdx = i;
      exitReason = 'hard_stop';
      stoppedOut = true;
      break;
    }

    // Activate trailing if not yet active
    if (!trailingActive && c.high >= activationPrice) {
      trailingActive = true;
      trailPeak = c.high;
      trailStopPrice = trailPeak * (1 - policy.trailPct);
    }

    // Update trailing stop if active
    if (trailingActive) {
      if (c.high > trailPeak) {
        trailPeak = c.high;
        trailStopPrice = trailPeak * (1 - policy.trailPct);
      }

      // Check trailing stop
      if (c.low <= trailStopPrice) {
        exitIdx = i;
        exitReason = 'trailing_stop';
        stoppedOut = true;
        break;
      }
    }
  }

  return buildResult(
    candles,
    entryIdx,
    exitIdx,
    entryPx,
    entryTsMs,
    exitReason,
    maxAdverseExcursionBps,
    peakHigh,
    fees,
    stoppedOut,
    stoppedOut ? (exitReason === 'hard_stop' ? hardStopPrice : trailStopPrice) : undefined
  );
}

function executeLadder(
  candles: Candle[],
  entryIdx: number,
  entryPx: number,
  entryTsMs: number,
  policy: LadderPolicy,
  fees: FeeConfig | ExecutionConfig
): PolicyExecutionResult {
  const stopPrice = policy.stopPct ? entryPx * (1 - policy.stopPct) : 0;

  // Sort levels by multiple ascending
  const levels = [...policy.levels].sort((a, b) => a.multiple - b.multiple);

  // Track which levels have been hit
  const levelHits = levels.map(() => false);
  let remainingPosition = 1.0;
  let totalReturn = 0;

  let lastExitIdx = entryIdx;
  let maxAdverseExcursionBps = 0;
  let peakHigh = entryPx;
  let stoppedOut = false;

  for (let i = entryIdx; i < candles.length; i++) {
    const c = candles[i];

    // Track peak
    if (c.high > peakHigh) peakHigh = c.high;

    // Track max adverse excursion
    const lowReturn = (c.low / entryPx - 1) * 10000;
    if (lowReturn < maxAdverseExcursionBps) {
      maxAdverseExcursionBps = lowReturn;
    }

    // Check stop (only on remaining position)
    if (stopPrice > 0 && c.low <= stopPrice && remainingPosition > 0) {
      // Close remaining at stop
      const exitReturn = (stopPrice / entryPx - 1) * 10000 * remainingPosition;
      totalReturn += exitReturn;
      remainingPosition = 0;
      lastExitIdx = i;
      stoppedOut = true;
      break;
    }

    // Check levels (using high)
    for (let lvlIdx = 0; lvlIdx < levels.length; lvlIdx++) {
      if (levelHits[lvlIdx]) continue;

      const level = levels[lvlIdx];
      const levelPrice = entryPx * level.multiple;

      if (c.high >= levelPrice) {
        levelHits[lvlIdx] = true;
        const exitFraction = Math.min(level.fraction, remainingPosition);
        const exitReturn = (level.multiple - 1) * 10000 * exitFraction;
        totalReturn += exitReturn;
        remainingPosition -= exitFraction;
        lastExitIdx = i;

        if (remainingPosition <= 0) break;
      }
    }

    if (remainingPosition <= 0) break;
  }

  // If position remains, close at last candle
  if (remainingPosition > 0) {
    const lastCandle = candles[candles.length - 1];
    const exitReturn = (lastCandle.close / entryPx - 1) * 10000 * remainingPosition;
    totalReturn += exitReturn;
    lastExitIdx = candles.length - 1;
  }

  const lastCandle = candles[lastExitIdx];
  const exitTsMs = lastCandle.timestamp * 1000;
  const exitPx = stoppedOut ? stopPrice : lastCandle.close;

  // Apply fees
  const totalFeeBps = getTotalFeeBps(fees);
  const netReturnBps = totalReturn - totalFeeBps * 2; // Entry + exit fees

  // Calculate tail capture
  const peakMultiple = peakHigh / entryPx;
  const peakReturnBps = (peakMultiple - 1) * 10000;
  const tailCapture = peakReturnBps > 0 ? totalReturn / peakReturnBps : null;

  return {
    realizedReturnBps: netReturnBps,
    stopOut: stoppedOut,
    maxAdverseExcursionBps,
    timeExposedMs: exitTsMs - entryTsMs,
    tailCapture: tailCapture !== null ? Math.min(tailCapture, 1.0) : null,
    entryTsMs,
    exitTsMs,
    entryPx,
    exitPx,
    exitReason: stoppedOut
      ? 'stop_loss'
      : remainingPosition <= 0
        ? 'ladder_complete'
        : 'end_of_data',
  };
}

function executeCombo(
  candles: Candle[],
  entryIdx: number,
  entryPx: number,
  entryTsMs: number,
  policy: ComboPolicy,
  fees: FeeConfig | ExecutionConfig
): PolicyExecutionResult {
  // Execute all policies and take the one that exits first
  const results = policy.policies.map((p) =>
    executePolicy(candles.slice(entryIdx), entryTsMs, p, fees)
  );

  // Find earliest exit
  let earliest = results[0];
  for (const r of results) {
    if (r.exitTsMs < earliest.exitTsMs) {
      earliest = r;
    }
  }

  return earliest;
}

function executeWashRebound(
  candles: Candle[],
  entryIdx: number,
  entryPx: number,
  entryTsMs: number,
  policy: WashReboundPolicy,
  fees: FeeConfig | ExecutionConfig
): PolicyExecutionResult {
  type State = 'IN_POSITION' | 'WAIT_FOR_WASH' | 'WAIT_FOR_REBOUND';

  const maxReentries = policy.maxReentries ?? 3;
  const cooldownCandles = policy.cooldownCandles ?? 1;

  // State machine state
  let state: State = 'IN_POSITION';
  let peak = entryPx;
  let peakAtExit: number | null = null;
  let washLow: number | null = null;
  let washLowCandleIdx: number | null = null; // Track which candle established wash_low to avoid same-candle rebound

  // Trade tracking
  let reentryCount = 0;
  let currentEntryPx = entryPx;
  let cooldownUntilIdx: number | null = null;

  // Aggregate metrics
  // Track cumulative return as a multiplier (1.0 = no change, 1.2 = +20%)
  let cumulativeMultiplier = 1.0;
  let maxAdverseExcursionBps = 0;
  let lastExitTsMs = entryTsMs;
  let lastExitPx = entryPx;
  let exitReason = 'end_of_data';
  let stoppedOut = false;

  // Track overall peak for tail capture calculation
  let overallPeakHigh = entryPx;

  for (let i = entryIdx; i < candles.length; i++) {
    const c = candles[i];
    const tsMs = c.timestamp * 1000;

    // Track overall peak
    if (c.high > overallPeakHigh) overallPeakHigh = c.high;

    // Track max adverse excursion (worst drawdown from any entry)
    const lowReturn = (c.low / currentEntryPx - 1) * 10000;
    if (lowReturn < maxAdverseExcursionBps) {
      maxAdverseExcursionBps = lowReturn;
    }

    if (state === 'IN_POSITION') {
      // Update peak since entry
      if (c.high > peak) {
        peak = c.high;
      }

      // Check trailing stop exit: if candle.low <= peak * (1 - trailPct)
      const trailingStopPrice = peak * (1 - policy.trailPct);
      if (c.low <= trailingStopPrice) {
        // Exit at stop price (deterministic fill)
        const exitPx = trailingStopPrice;
        // Apply fees to this trade: entry fee increases effective entry, exit fee decreases effective exit
        const totalFeeBps = getTotalFeeBps(fees);
        const entryFeeFactor = 1 + totalFeeBps / 10000;
        const exitFeeFactor = 1 - totalFeeBps / 10000;
        const netEntryPx = currentEntryPx * entryFeeFactor;
        const netExitPx = exitPx * exitFeeFactor;
        // Compound return: multiply by net return for this trade
        const tradeReturn = netExitPx / netEntryPx;
        cumulativeMultiplier *= tradeReturn;
        lastExitTsMs = tsMs;
        lastExitPx = exitPx;
        exitReason = 'trailing_stop';
        stoppedOut = true;

        // Record peak_at_exit and transition to WAIT_FOR_WASH
        peakAtExit = peak;
        state = 'WAIT_FOR_WASH';
        washLow = null;
        washLowCandleIdx = null;
        cooldownUntilIdx = i + cooldownCandles;

        // Check if we can re-enter (haven't hit max reentries)
        if (reentryCount >= maxReentries) {
          // No more re-entries allowed, we're done
          break;
        }
        continue;
      }
    } else if (state === 'WAIT_FOR_WASH') {
      // Check if cooldown is still active
      if (cooldownUntilIdx !== null && i < cooldownUntilIdx) {
        continue;
      }

      // Wash condition: if candle.low <= peak_at_exit * (1 - washPct)
      if (peakAtExit !== null) {
        const washThreshold = peakAtExit * (1 - policy.washPct);
        if (c.low <= washThreshold) {
          // Wash triggered - set wash_low and transition to WAIT_FOR_REBOUND
          washLow = c.low;
          washLowCandleIdx = i;
          state = 'WAIT_FOR_REBOUND';
          continue;
        }
      }
    } else if (state === 'WAIT_FOR_REBOUND') {
      // Update wash_low if price dips further
      if (washLow !== null && c.low < washLow) {
        washLow = c.low;
        washLowCandleIdx = i;
      }

      // Re-entry rule: if candle.high >= wash_low * (1 + reboundPct)
      // BUT: avoid same-candle rebound (must be after the candle that established wash_low)
      if (washLow !== null && washLowCandleIdx !== null && i > washLowCandleIdx) {
        const reboundThreshold = washLow * (1 + policy.reboundPct);
        if (c.high >= reboundThreshold) {
          // Re-enter at trigger price (deterministic fill)
          const reentryPx = reboundThreshold;
          currentEntryPx = reentryPx;
          reentryCount++;

          // Reset state for new position
          state = 'IN_POSITION';
          peak = Math.max(reentryPx, c.high); // Start tracking peak from re-entry
          peakAtExit = null;
          washLow = null;
          washLowCandleIdx = null;
          cooldownUntilIdx = null;
          continue;
        }
      }
    }
  }

  // If still in position at end, close at last candle
  if (state === 'IN_POSITION') {
    const lastCandle = candles[candles.length - 1];
    const exitPx = lastCandle.close;
    // Apply fees to final trade
    const totalFeeBps = getTotalFeeBps(fees);
    const entryFeeFactor = 1 + totalFeeBps / 10000;
    const exitFeeFactor = 1 - totalFeeBps / 10000;
    const netEntryPx = currentEntryPx * entryFeeFactor;
    const netExitPx = exitPx * exitFeeFactor;
    // Compound return for final trade
    const tradeReturn = netExitPx / netEntryPx;
    cumulativeMultiplier *= tradeReturn;
    lastExitTsMs = lastCandle.timestamp * 1000;
    lastExitPx = exitPx;
    exitReason = 'end_of_data';
  }

  // Convert cumulative multiplier (already has fees applied) to basis points
  const netReturnBps = (cumulativeMultiplier - 1) * 10000;

  // Calculate tail capture (based on overall peak from first entry)
  // Use gross return (before fees) for tail capture calculation
  const grossReturnBps = (cumulativeMultiplier - 1) * 10000;
  const peakMultiple = overallPeakHigh / entryPx;
  const peakReturnBps = (peakMultiple - 1) * 10000;
  const tailCapture = peakReturnBps > 0 ? Math.min(grossReturnBps / peakReturnBps, 1.0) : null;

  return {
    realizedReturnBps: netReturnBps,
    stopOut: stoppedOut,
    maxAdverseExcursionBps,
    timeExposedMs: lastExitTsMs - entryTsMs,
    tailCapture,
    entryTsMs,
    exitTsMs: lastExitTsMs,
    entryPx,
    exitPx: lastExitPx,
    exitReason,
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Extract total fee in basis points from fee config.
 * If execution model is present, uses its cost model; otherwise uses simple takerFeeBps + slippageBps.
 */
function getTotalFeeBps(fees: FeeConfig | ExecutionConfig): number {
  // If execution model is present, use its cost model
  if ('executionModel' in fees && fees.executionModel) {
    const model = fees.executionModel;
    // Use cost model taker fee + average slippage estimate
    // The new ExecutionModel structure has costs directly
    const takerFee = model.costs?.takerFeeBps ?? 25; // Default 0.25%
    // For slippage, use the fixed component from entry slippage model
    // The new structure has slippage.entrySlippage with fixedBps
    const entrySlippage = model.slippage?.entrySlippage;
    const slippageFee = entrySlippage?.fixedBps ?? entrySlippage?.minBps ?? 0;
    return takerFee + slippageFee;
  }
  // Simple fee model
  return fees.takerFeeBps + fees.slippageBps;
}

function createNoEntryResult(alertTsMs: number): PolicyExecutionResult {
  return {
    realizedReturnBps: 0,
    stopOut: false,
    maxAdverseExcursionBps: 0,
    timeExposedMs: 0,
    tailCapture: null,
    entryTsMs: alertTsMs,
    exitTsMs: alertTsMs,
    entryPx: 0,
    exitPx: 0,
    exitReason: 'no_entry',
  };
}

function buildResult(
  candles: Candle[],
  entryIdx: number,
  exitIdx: number,
  entryPx: number,
  entryTsMs: number,
  exitReason: string,
  maxAdverseExcursionBps: number,
  peakHigh: number,
  fees: FeeConfig | ExecutionConfig,
  stoppedOut: boolean,
  stopExitPrice?: number,
  takeProfitExitPrice?: number
): PolicyExecutionResult {
  const exitCandle = candles[exitIdx];
  const exitTsMs = exitCandle.timestamp * 1000;

  // Determine exit price
  let exitPx: number;
  if (stopExitPrice !== undefined) {
    exitPx = stopExitPrice;
  } else if (takeProfitExitPrice !== undefined) {
    exitPx = takeProfitExitPrice;
  } else {
    exitPx = exitCandle.close;
  }

  // Calculate return
  const grossReturnBps = (exitPx / entryPx - 1) * 10000;
  const totalFeeBps = getTotalFeeBps(fees);
  const netReturnBps = grossReturnBps - totalFeeBps * 2; // Entry + exit fees

  // Calculate tail capture
  const peakMultiple = peakHigh / entryPx;
  const peakReturnBps = (peakMultiple - 1) * 10000;
  const tailCapture = peakReturnBps > 0 ? Math.min(grossReturnBps / peakReturnBps, 1.0) : null;

  return {
    realizedReturnBps: netReturnBps,
    stopOut: stoppedOut,
    maxAdverseExcursionBps,
    timeExposedMs: exitTsMs - entryTsMs,
    tailCapture,
    entryTsMs,
    exitTsMs,
    entryPx,
    exitPx,
    exitReason,
  };
}

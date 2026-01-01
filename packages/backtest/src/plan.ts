/**
 * Backtest Planner - Requirements derivation for CALLS
 *
 * Pure function: computes what data is required for each call.
 * Entry points come from call timestamps, not arbitrary tokens.
 * No DB access, no I/O, no side effects.
 */

import type { BacktestRequest, BacktestPlan, Interval, StrategyV1 } from './types.js';

/**
 * Convert interval string to seconds
 */
function intervalToSeconds(interval: Interval): number {
  switch (interval) {
    case '1s':
      return 1;
    case '15s':
      return 15;
    case '1m':
      return 60;
    case '5m':
      return 300;
    case '15m':
      return 900;
    case '1h':
      return 3600;
    case '4h':
      return 14400;
    case '1d':
      return 86400;
    default:
      throw new Error(`Unsupported interval: ${interval}`);
  }
}

/**
 * Determine indicator warmup requirement (candles)
 */
function calculateIndicatorWarmup(strategy: BacktestRequest['strategy']): number {
  return strategy.indicatorWarmup ?? 52;
}

/**
 * Determine max hold requirement (candles), derived from overlays if not explicitly set.
 * Important: must scale with intervalSeconds (not hardcoded to 1m).
 */
function calculateMaxHold(strategy: StrategyV1, intervalSeconds: number): number {
  let maxHoldMs = 0;

  const walk = (overlay: any) => {
    if (!overlay) return;
    if (overlay.kind === 'time_exit') {
      maxHoldMs = Math.max(maxHoldMs, overlay.holdMs ?? 0);
    } else if (overlay.kind === 'combo' && Array.isArray(overlay.legs)) {
      for (const leg of overlay.legs) walk(leg);
    }
  };

  for (const overlay of strategy.overlays) walk(overlay);

  // If no explicit time exit, default to 24h window.
  if (maxHoldMs <= 0) {
    maxHoldMs = 24 * 60 * 60 * 1000;
  }

  const intervalMs = intervalSeconds * 1000;
  return Math.ceil(maxHoldMs / intervalMs);
}

/**
 * Plan backtest requirements per call
 */
export function planBacktest(req: BacktestRequest): BacktestPlan {
  const intervalSeconds = intervalToSeconds(req.interval);
  const indicatorWarmupCandles = calculateIndicatorWarmup(req.strategy);
  const entryDelayCandles = req.strategy.entryDelay ?? 0;

  const maxHoldCandles = req.strategy.maxHold ?? calculateMaxHold(req.strategy, intervalSeconds);

  const totalRequiredCandles = indicatorWarmupCandles + entryDelayCandles + maxHoldCandles;

  const perCallWindow = req.calls.map((call) => {
    // NOTE: chain detection can be upgraded later. For now assume solana.
    const chain: any = 'solana';

    // Entry time = call timestamp + delay
    const entryTime = call.createdAt.plus({ seconds: entryDelayCandles * intervalSeconds });

    // Window from = (entry - warmup), to = (entry + maxHold)
    const from = entryTime.minus({ seconds: indicatorWarmupCandles * intervalSeconds });
    const to = entryTime.plus({ seconds: maxHoldCandles * intervalSeconds });

    return {
      callId: call.id,
      tokenAddress: call.mint,
      chain,
      callTimestamp: call.createdAt,
      from,
      to,
    };
  });

  return {
    intervalSeconds,
    indicatorWarmupCandles,
    entryDelayCandles,
    maxHoldCandles,
    totalRequiredCandles,
    perCallWindow,
  };
}

/**
 * Run Planning Service
 *
 * Calculates candle requirements before simulation.
 * Pure logic - no DB calls, no I/O.
 */

import { DateTime } from 'luxon';
import type { StrategyConfig } from '@quantbot/simulation/engine';
import type { CallRecord } from '../types.js';

export interface TokenRequirement {
  token: string;
  alertTime: DateTime;
  requiredFromTs: DateTime;
  requiredToTs: DateTime;
  requiredCandleCount: number;
}

export interface RunPlan {
  requiredWarmupCandles: number;
  requiredLookback: number; // in candles
  requiredDelay: number; // in candles
  maxHoldingCandles: number;
  interval: string;
  tokenRequirements: TokenRequirement[];
}

/**
 * Calculate maximum indicator period from strategy config
 */
function calculateMaxIndicatorPeriod(strategy: StrategyConfig): number {
  let maxPeriod = 0;

  const entry = strategy.entry;
  if (entry.mode === 'signal' && entry.signal) {
    if (entry.signal.type === 'rsi_below' && entry.signal.period) {
      maxPeriod = Math.max(maxPeriod, entry.signal.period);
    }
    if (entry.signal.type === 'ema_cross') {
      if (entry.signal.fast) maxPeriod = Math.max(maxPeriod, entry.signal.fast);
      if (entry.signal.slow) maxPeriod = Math.max(maxPeriod, entry.signal.slow);
    }
  }

  // Add 1 to account for the fact that we need at least period candles to compute
  // (e.g., RSI(14) needs 15 candles: 14 for calculation + 1 for the signal)
  return maxPeriod > 0 ? maxPeriod + 1 : 0;
}

/**
 * Calculate maximum holding horizon from strategy config
 */
function calculateMaxHoldingCandles(strategy: StrategyConfig): number {
  const timeExit = strategy.exits?.time_exit;
  if (timeExit?.enabled && timeExit.max_candles_in_trade) {
    return timeExit.max_candles_in_trade;
  }

  // Default: assume worst-case holding period
  // If no time exit, we still need to account for potential long holds
  // Use a conservative default (e.g., 1000 candles = ~83 hours for 5m candles)
  return 1000;
}

/**
 * Calculate delay in candles
 */
function calculateDelayCandles(strategy: StrategyConfig): number {
  const delay = strategy.entry.delay;
  if (delay?.mode === 'candles' && delay.n) {
    return delay.n;
  }
  return 0;
}

/**
 * Convert interval string to seconds
 */
function intervalToSeconds(interval: string): number {
  const normalized = interval.toLowerCase();
  if (normalized === '1s') return 1;
  if (normalized === '15s') return 15;
  if (normalized === '1m') return 60;
  if (normalized === '5m') return 300;
  if (normalized === '15m') return 900;
  if (normalized === '1h') return 3600;
  if (normalized === '4h') return 14400;
  if (normalized === '1d') return 86400;
  // Default to 5m if unknown
  return 300;
}

/**
 * Plan run requirements
 *
 * @param strategy - Strategy configuration
 * @param calls - Array of call records (token universe)
 * @param interval - Candle interval (e.g., '5m', '1m')
 * @param preWindowMinutes - Pre-window minutes (default: 0)
 * @param postWindowMinutes - Post-window minutes (default: 0)
 * @returns Run plan with requirements per token
 */
export function planRun(
  strategy: StrategyConfig,
  calls: CallRecord[],
  interval: string,
  preWindowMinutes: number = 0,
  postWindowMinutes: number = 0
): RunPlan {
  const requiredWarmupCandles = calculateMaxIndicatorPeriod(strategy);
  const requiredDelay = calculateDelayCandles(strategy);
  const maxHoldingCandles = calculateMaxHoldingCandles(strategy);
  const requiredLookback = requiredWarmupCandles + requiredDelay;

  const intervalSeconds = intervalToSeconds(interval);

  // Calculate requirements per token
  const tokenRequirements: TokenRequirement[] = [];

  // Group calls by token
  const callsByToken = new Map<string, CallRecord[]>();
  for (const call of calls) {
    const existing = callsByToken.get(call.mint) || [];
    existing.push(call);
    callsByToken.set(call.mint, existing);
  }

  for (const [token, tokenCalls] of callsByToken) {
    // Find earliest and latest call times for this token
    const callTimes = tokenCalls.map((c) => c.createdAt);
    const earliestCall = DateTime.min(...callTimes);
    const latestCall = DateTime.max(...callTimes);

    // Calculate required time range
    // Start: earliest call - preWindow - warmup - delay
    // End: latest call + postWindow + max holding
    if (!earliestCall || !latestCall) {
      continue; // Skip if no calls found
    }

    const requiredFromTs = earliestCall
      .minus({ minutes: preWindowMinutes })
      .minus({ seconds: requiredWarmupCandles * intervalSeconds })
      .minus({ seconds: requiredDelay * intervalSeconds });

    const requiredToTs = latestCall
      .plus({ minutes: postWindowMinutes })
      .plus({ seconds: maxHoldingCandles * intervalSeconds });

    // Calculate required candle count
    const timeRangeSeconds = requiredToTs.diff(requiredFromTs, 'seconds').seconds;
    const requiredCandleCount = Math.ceil(timeRangeSeconds / intervalSeconds);

    tokenRequirements.push({
      token,
      alertTime: earliestCall,
      requiredFromTs,
      requiredToTs,
      requiredCandleCount,
    });
  }

  return {
    requiredWarmupCandles,
    requiredLookback,
    requiredDelay,
    maxHoldingCandles,
    interval,
    tokenRequirements,
  };
}

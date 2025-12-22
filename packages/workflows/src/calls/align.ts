/**
 * Call Alignment - Map calls to OHLCV windows and entry timestamps
 *
 * Pure, deterministic functions that align CallSignal events to:
 * - OHLCV fetch windows (from/to timestamps)
 * - Entry timestamps (with lag variants)
 * - Candle indices for entry
 *
 * No ports here. Pure. Deterministic.
 */

import type { CallSignal } from '@quantbot/core';
import type { Candle } from '@quantbot/core';

/**
 * Alignment parameters
 */
export type AlignParams = {
  lagMs: number; // e.g., 0, 10_000, 30_000, 60_000 (delay before entry)
  entryRule: 'next_candle_open' | 'next_candle_close' | 'call_time_close';
  timeframeMs: number; // How long to fetch candles for evaluation window
  interval: '1s' | '1m' | '5m' | '15m' | '1h'; // Candle interval type
};

/**
 * Aligned call with window and entry information
 */
export type AlignedCall = {
  call: CallSignal;
  window: {
    fromMs: number; // Request start for OHLCV
    toMs: number; // Request end
  };
  entry: {
    tsMs: number; // Chosen entry time
    candleIndex?: number; // Where entry lands in the candle array (set after candles are fetched)
    reason: string; // Human-readable reason for entry time
  };
  eligibility: {
    tradeable: boolean;
    reason?: string; // "missing_candles", "no_chain", etc.
  };
};

/**
 * Align a call to an OHLCV window and determine entry timestamp
 *
 * Pure function: no I/O, deterministic output for given inputs.
 *
 * @param call - The CallSignal to align
 * @param params - Alignment parameters (lag, entry rule, timeframe)
 * @returns Aligned call with window and entry information
 */
export function alignCallToOhlcvWindow(call: CallSignal, params: AlignParams): AlignedCall {
  const callTimeMs = call.tsMs;
  const lagMs = params.lagMs;
  const timeframeMs = params.timeframeMs;

  // Calculate entry time based on lag
  let entryTimeMs = callTimeMs + lagMs;

  // Apply entry rule
  let entryReason = `call_time_plus_lag_${lagMs}ms`;
  if (params.entryRule === 'next_candle_open') {
    // Round up to next candle boundary
    const intervalMs = intervalToMs(params.interval);
    entryTimeMs = Math.ceil(entryTimeMs / intervalMs) * intervalMs;
    entryReason = `next_candle_open_after_lag_${lagMs}ms`;
  } else if (params.entryRule === 'next_candle_close') {
    // Round up to next candle close
    const intervalMs = intervalToMs(params.interval);
    entryTimeMs = Math.ceil(entryTimeMs / intervalMs) * intervalMs + intervalMs - 1;
    entryReason = `next_candle_close_after_lag_${lagMs}ms`;
  } else if (params.entryRule === 'call_time_close') {
    // Use call time rounded to current candle close
    const intervalMs = intervalToMs(params.interval);
    const callCandleStart = Math.floor(callTimeMs / intervalMs) * intervalMs;
    entryTimeMs = callCandleStart + intervalMs - 1;
    entryReason = `call_time_candle_close`;
  }

  // Calculate OHLCV window
  // Fetch from entry time backwards (for indicators) and forwards (for simulation)
  const windowFromMs = entryTimeMs - timeframeMs / 2; // Half before entry
  const windowToMs = entryTimeMs + timeframeMs / 2; // Half after entry

  // Determine eligibility
  const tradeable = call.token.chain !== 'unknown';
  const eligibilityReason = tradeable
    ? undefined
    : call.token.chain === 'unknown'
      ? 'chain_unknown'
      : 'invalid_token_ref';

  return {
    call,
    window: {
      fromMs: windowFromMs,
      toMs: windowToMs,
    },
    entry: {
      tsMs: entryTimeMs,
      reason: entryReason,
    },
    eligibility: {
      tradeable,
      reason: eligibilityReason,
    },
  };
}

/**
 * Find candle index for entry timestamp
 *
 * Pure function: finds the candle that contains or is closest to the entry timestamp.
 *
 * @param aligned - Aligned call (entry.tsMs must be set)
 * @param candles - Array of candles (must be sorted by timestamp ascending)
 * @returns Updated aligned call with candleIndex set
 */
export function findEntryCandleIndex(aligned: AlignedCall, candles: Candle[]): AlignedCall {
  if (candles.length === 0) {
    return aligned;
  }

  const entryTimeSeconds = Math.floor(aligned.entry.tsMs / 1000);

  // Find the candle that contains the entry time, or the closest one after
  let candleIndex: number | undefined;
  for (let i = 0; i < candles.length; i++) {
    const candle = candles[i];
    if (!candle) continue;

    // Check if entry time is within this candle's interval
    // For simplicity, we check if entry time >= candle timestamp
    // (assuming candles are sorted ascending)
    if (candle.timestamp >= entryTimeSeconds) {
      candleIndex = i;
      break;
    }
  }

  // If no candle found after entry time, use the last candle
  if (candleIndex === undefined) {
    candleIndex = candles.length - 1;
  }

  return {
    ...aligned,
    entry: {
      ...aligned.entry,
      candleIndex,
    },
  };
}

/**
 * Convert interval string to milliseconds
 */
function intervalToMs(interval: AlignParams['interval']): number {
  switch (interval) {
    case '1s':
      return 1000;
    case '1m':
      return 60 * 1000;
    case '5m':
      return 5 * 60 * 1000;
    case '15m':
      return 15 * 60 * 1000;
    case '1h':
      return 60 * 60 * 1000;
    default:
      throw new Error(`Unknown interval: ${interval}`);
  }
}

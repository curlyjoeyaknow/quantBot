import type { Candle } from '@quantbot/core';

export type PathMetrics = {
  // anchor
  t0_ms: number;
  p0: number;

  // multiples
  hit_2x: boolean;
  t_2x_ms: number | null;

  hit_3x: boolean;
  t_3x_ms: number | null;

  hit_4x: boolean;
  t_4x_ms: number | null;

  // drawdown (bps, negative = bad)
  dd_bps: number | null;
  dd_to_2x_bps: number | null;

  // activity
  alert_to_activity_ms: number | null;

  // summary
  peak_multiple: number | null;
};

export type PathMetricOptions = {
  /**
   * Activity definition (price move from anchor).
   * Example: 0.10 means "first ±10% move from p0"
   */
  activity_move_pct?: number; // default 0.10

  /**
   * If true, dd_to_2x uses window [t0, t_2x] inclusive.
   */
  dd_to_2x_inclusive?: boolean; // default true
};

/**
 * Candles are expected to be in chronological order.
 * Candle.timestamp is UNIX seconds; Trade timestamps are ms. We normalize to ms here.
 *
 * Anchor:
 * - t0_ms: the alert timestamp (or alert+delay) in milliseconds
 * - p0: close of first candle with ts_ms >= t0_ms
 *
 * Multiples:
 * - Uses candle.high to detect "touch" of 2x/3x/4x
 *
 * Drawdown:
 * - dd_bps: min(low) from t0 onward vs p0
 * - dd_to_2x_bps: min(low) from t0 to first 2x hit (only if hit)
 *
 * Activity:
 * - First candle where high >= p0*(1+move) OR low <= p0*(1-move)
 */
export function computePathMetrics(
  candles: Candle[],
  t0_ms: number,
  opts: PathMetricOptions = {}
): PathMetrics {
  const activity_move_pct = opts.activity_move_pct ?? 0.1;
  const dd_to_2x_inclusive = opts.dd_to_2x_inclusive ?? true;

  // Find anchor candle (first candle at/after t0)
  let anchorIdx = -1;
  for (let i = 0; i < candles.length; i++) {
    const ts_ms = candles[i].timestamp * 1000;
    if (ts_ms >= t0_ms) {
      anchorIdx = i;
      break;
    }
  }

  if (anchorIdx === -1) {
    return {
      t0_ms,
      p0: NaN,

      hit_2x: false,
      t_2x_ms: null,
      hit_3x: false,
      t_3x_ms: null,
      hit_4x: false,
      t_4x_ms: null,

      dd_bps: null,
      dd_to_2x_bps: null,
      alert_to_activity_ms: null,
      peak_multiple: null,
    };
  }

  const p0 = candles[anchorIdx].close;
  if (!isFinite(p0) || p0 <= 0) {
    return {
      t0_ms,
      p0,

      hit_2x: false,
      t_2x_ms: null,
      hit_3x: false,
      t_3x_ms: null,
      hit_4x: false,
      t_4x_ms: null,

      dd_bps: null,
      dd_to_2x_bps: null,
      alert_to_activity_ms: null,
      peak_multiple: null,
    };
  }

  const t2 = 2 * p0;
  const t3 = 3 * p0;
  const t4 = 4 * p0;

  let t_2x_ms: number | null = null;
  let t_3x_ms: number | null = null;
  let t_4x_ms: number | null = null;

  let minLow = Number.POSITIVE_INFINITY;
  let minLowTo2x = Number.POSITIVE_INFINITY;

  let alert_to_activity_ms: number | null = null;
  let peakHigh = 0;

  const upThresh = p0 * (1 + activity_move_pct);
  const dnThresh = p0 * (1 - activity_move_pct);

  for (let i = anchorIdx; i < candles.length; i++) {
    const c = candles[i];
    const ts_ms = c.timestamp * 1000;

    // peak
    if (c.high > peakHigh) peakHigh = c.high;

    // global min low
    if (c.low < minLow) minLow = c.low;

    // activity (first meaningful move)
    if (alert_to_activity_ms === null) {
      if (c.high >= upThresh || c.low <= dnThresh) {
        alert_to_activity_ms = ts_ms - t0_ms;
      }
    }

    // 2x/3x/4x first touch (using high)
    if (t_2x_ms === null && c.high >= t2) t_2x_ms = ts_ms;
    if (t_3x_ms === null && c.high >= t3) t_3x_ms = ts_ms;
    if (t_4x_ms === null && c.high >= t4) t_4x_ms = ts_ms;

    // min low until 2x (if not yet hit)
    const withinTo2x =
      t_2x_ms === null || (dd_to_2x_inclusive ? ts_ms <= t_2x_ms : ts_ms < t_2x_ms);

    if (withinTo2x) {
      if (c.low < minLowTo2x) minLowTo2x = c.low;
    }
  }

  const dd_bps = isFinite(minLow) && minLow > 0 ? (minLow / p0 - 1) * 10_000 : null;

  const dd_to_2x_bps =
    t_2x_ms !== null && isFinite(minLowTo2x) && minLowTo2x > 0
      ? (minLowTo2x / p0 - 1) * 10_000
      : null;

  const peak_multiple = peakHigh > 0 ? peakHigh / p0 : null;

  return {
    t0_ms,
    p0,

    hit_2x: t_2x_ms !== null,
    t_2x_ms,
    hit_3x: t_3x_ms !== null,
    t_3x_ms,
    hit_4x: t_4x_ms !== null,
    t_4x_ms,

    dd_bps,
    dd_to_2x_bps,
    alert_to_activity_ms,
    peak_multiple,
  };
}

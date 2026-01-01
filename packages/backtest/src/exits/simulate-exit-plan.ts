import type { Candle } from '@quantbot/core';
import type {
  ExitFill,
  ExitPlan,
  ExitSimParams,
  ExitSimResult,
  IntrabarPolicy,
  LadderLevel,
} from './exit-plan.js';
import { candleTsMs } from './exit-plan.js';
import { buildIndicatorExitSignal } from './indicator-eval.js';

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

function levelPrice(entryPx: number, lvl: LadderLevel): number {
  if (lvl.kind === 'multiple') return entryPx * lvl.multiple;
  return entryPx * (1 + lvl.pct / 100);
}

function sortLevels(
  entryPx: number,
  lvls: LadderLevel[]
): Array<{ px: number; fraction: number; label: string }> {
  const mapped = lvls.map((l) => ({
    px: levelPrice(entryPx, l),
    fraction: l.fraction,
    label: l.kind === 'multiple' ? `${l.multiple}x` : `+${l.pct}%`,
  }));
  mapped.sort((a, b) => a.px - b.px);
  return mapped;
}

function applyFriction(px: number, slippage_bps: number, side: 'sell' | 'buy'): number {
  // For sell, slippage makes you worse: price down. For buy, price up.
  const s = slippage_bps / 10_000;
  return side === 'sell' ? px * (1 - s) : px * (1 + s);
}

function computeVwap(fills: ExitFill[]): number {
  let num = 0;
  let den = 0;
  for (const f of fills) {
    num += f.px * f.fraction;
    den += f.fraction;
  }
  return den === 0 ? NaN : num / den;
}

export function simulateExitPlan(params: ExitSimParams): ExitSimResult {
  const { candles, entryTsMs, entryPx, plan, taker_fee_bps, slippage_bps } = params;

  // Find entry candle index (first candle >= entryTsMs)
  let entryIdx = -1;
  for (let i = 0; i < candles.length; i++) {
    if (candleTsMs(candles[i]) >= entryTsMs) {
      entryIdx = i;
      break;
    }
  }

  if (entryIdx === -1) {
    return {
      fills: [],
      exitTsMs: entryTsMs,
      exitPxVwap: NaN,
      exitReason: 'no_candles_after_entry',
      remainingFraction: 1,
    };
  }

  const ladder = plan.ladder?.enabled ? plan.ladder : undefined;
  const trailing = plan.trailing?.enabled ? plan.trailing : undefined;
  const indicator = plan.indicator?.enabled ? plan.indicator : undefined;

  const intrabar: IntrabarPolicy = trailing?.intrabar_policy ?? 'STOP_FIRST';

  const indicatorSignal = indicator
    ? buildIndicatorExitSignal(candles, indicator)
    : new Array<boolean>(candles.length).fill(false);
  const minHoldForIndicator = plan.min_hold_candles_for_indicator ?? 0;

  // Ladder schedule
  const ladderLevels = ladder ? sortLevels(entryPx, ladder.levels) : [];
  // Validate fractions (don't blow up; clamp and normalize if slightly off)
  const totalLadderFrac = ladderLevels.reduce((s, l) => s + l.fraction, 0);
  if (totalLadderFrac > 1.001) {
    // normalize down to 1
    for (const l of ladderLevels) l.fraction /= totalLadderFrac;
  }
  for (const l of ladderLevels) l.fraction = clamp01(l.fraction);

  let remaining = 1.0;
  const fills: ExitFill[] = [];

  // Trailing state (on remaining)
  let trailActive = false;
  let peak = entryPx;
  const hardStopPx: number | null = trailing?.hard_stop_bps
    ? entryPx * (1 - trailing.hard_stop_bps / 10_000)
    : null;
  let trailingStopPx: number | null = null;

  const trailDist = trailing ? trailing.trail_bps / 10_000 : 0;

  const maxHoldMs = plan.max_hold_ms ?? null;
  const entryCandleTsMs = candleTsMs(candles[entryIdx]);

  const tryFill = (tsMs: number, px: number, frac: number, reason: string) => {
    if (frac <= 0 || remaining <= 0) return;
    const f = Math.min(frac, remaining);
    const slipped = applyFriction(px, slippage_bps, 'sell');
    // Fees are handled in pnl calc elsewhere; but for ranking you often want net prices.
    // If you want to reflect fees in effective price, you can reduce by fee bps here:
    const feeFactor = 1 - taker_fee_bps / 10_000;
    const netPx = slipped * feeFactor;

    fills.push({ tsMs, px: netPx, fraction: f, reason });
    remaining -= f;
  };

  // ladder cursor
  let ladderCursor = 0;

  const activateTrailingIfNeeded = (high: number) => {
    if (!trailing) return;

    if (trailActive) return;

    if (!trailing.activation) {
      trailActive = true;
      peak = Math.max(peak, high);
      trailingStopPx = peak * (1 - trailDist);
      return;
    }

    if (trailing.activation.kind === 'multiple') {
      if (high >= entryPx * trailing.activation.multiple) {
        trailActive = true;
        peak = Math.max(peak, high);
        trailingStopPx = peak * (1 - trailDist);
      }
      return;
    }

    // pct activation
    if (high >= entryPx * (1 + trailing.activation.pct / 100)) {
      trailActive = true;
      peak = Math.max(peak, high);
      trailingStopPx = peak * (1 - trailDist);
    }
  };

  const updateTrailingPeak = (high: number) => {
    if (!trailing || !trailActive) return;
    if (high > peak) {
      peak = high;
      trailingStopPx = peak * (1 - trailDist);
    }
  };

  const checkHardOrTrailStop = (c: Candle, tsMs: number): boolean => {
    if (!trailing) return false;
    if (remaining <= 0) return true;

    // Hard stop (check first, as it's more aggressive)
    if (hardStopPx !== null && c.low <= hardStopPx) {
      tryFill(tsMs, hardStopPx, remaining, 'stop_loss');
      return remaining <= 0;
    }

    // Trailing stop (only if activated and price hit)
    if (trailActive && trailingStopPx !== null && c.low <= trailingStopPx) {
      tryFill(tsMs, trailingStopPx, remaining, 'trailing_stop');
      return remaining <= 0;
    }

    return false;
  };

  const checkLadder = (c: Candle, tsMs: number): void => {
    if (!ladder || remaining <= 0) return;

    // multiple ladder levels might be hit in one candle (high)
    while (ladderCursor < ladderLevels.length && remaining > 0) {
      const lvl = ladderLevels[ladderCursor];
      if (c.high >= lvl.px) {
        tryFill(tsMs, lvl.px, lvl.fraction, `tp_${lvl.label}`);
        ladderCursor++;
        continue;
      }
      break;
    }
  };

  const checkIndicator = (i: number, c: Candle, tsMs: number): boolean => {
    if (!indicator || remaining <= 0) return false;
    if (i < entryIdx + minHoldForIndicator) return false;

    if (indicatorSignal[i]) {
      // assume exit at close
      tryFill(tsMs, c.close, remaining, 'indicator_exit');
      return remaining <= 0;
    }
    return false;
  };

  // Main loop: after entry
  for (let i = entryIdx; i < candles.length; i++) {
    if (remaining <= 0) break;

    const c = candles[i];
    const tsMs = candleTsMs(c);

    // timeout max hold
    if (maxHoldMs !== null && tsMs - entryCandleTsMs >= maxHoldMs) {
      tryFill(tsMs, c.close, remaining, 'timeout');
      break;
    }

    // Trailing activation and intrabar policy
    if (trailing) {
      if (intrabar === 'LOW_THEN_HIGH' || intrabar === 'STOP_FIRST') {
        // conservative: check stop on current stopPx before updating peak
        if (checkHardOrTrailStop(c, tsMs)) break;
        activateTrailingIfNeeded(c.high);
        updateTrailingPeak(c.high);
      } else {
        // optimistic-ish: update peak first, then check stop
        activateTrailingIfNeeded(c.high);
        updateTrailingPeak(c.high);
        if (checkHardOrTrailStop(c, tsMs)) break;
      }
    }

    // Ladder
    if (ladder) {
      if (intrabar === 'STOP_FIRST') {
        // if stop triggers, we already exited above
        checkLadder(c, tsMs);
      } else if (intrabar === 'TP_FIRST' || intrabar === 'HIGH_THEN_LOW') {
        checkLadder(c, tsMs);
        // optional: re-check stop after taking profits (rarely matters for remaining)
        if (trailing && remaining > 0) {
          if (checkHardOrTrailStop(c, tsMs)) break;
        }
      } else {
        checkLadder(c, tsMs);
      }
    }

    // Indicator exit (end-of-candle)
    if (checkIndicator(i, c, tsMs)) break;
  }

  const exitPxVwap = computeVwap(fills);
  const exitTsMs = fills.length ? fills[fills.length - 1].tsMs : entryTsMs;
  const exitReason = fills.length ? fills[fills.length - 1].reason : 'no_exit';

  return {
    fills,
    exitTsMs,
    exitPxVwap,
    exitReason,
    remainingFraction: remaining,
  };
}

import type { Candle } from '@quantbot/core';

export type IntrabarPolicy =
  | 'STOP_FIRST' // conservative: if stop + TP both possible in candle, assume stop triggers first
  | 'TP_FIRST' // optimistic
  | 'HIGH_THEN_LOW' // update high-based rules then check low
  | 'LOW_THEN_HIGH'; // check low first then high

export type LadderLevel =
  | { kind: 'multiple'; multiple: number; fraction: number } // e.g. 2.0x
  | { kind: 'pct'; pct: number; fraction: number }; // e.g. +50%

export type TrailingStopSpec = {
  enabled: boolean;

  /** trailing distance in bps (e.g. 500 = 5%) */
  trail_bps: number;

  /** start trailing immediately, or only after a profit threshold is reached */
  activation?: { kind: 'multiple'; multiple: number } | { kind: 'pct'; pct: number };

  /** optional hard stop from entry (bps). If omitted, no fixed SL. */
  hard_stop_bps?: number; // e.g. 2000 = 20% stop

  /** intrabar behavior for updating trail + checking stop */
  intrabar_policy?: IntrabarPolicy;
};

export type IndicatorRule =
  | {
      type: 'ichimoku_cross';
      tenkan: number; // 9
      kijun: number; // 26
      direction: 'bearish' | 'bullish';
      source?: 'close' | 'hl2'; // default "hl2"
    }
  | {
      type: 'ema_cross';
      fast: number;
      slow: number;
      direction: 'bearish' | 'bullish';
      source?: 'close';
    }
  | {
      type: 'rsi_cross';
      period: number; // 14
      level: number; // 70 or 50 etc
      direction: 'down' | 'up'; // cross down through level or up through level
      source?: 'close';
    }
  | {
      type: 'volume_spike';
      window: number; // rolling window
      z: number; // spike threshold
    };

export type IndicatorExitSpec = {
  enabled: boolean;
  rules: IndicatorRule[];
  /** if true, any rule triggers exit. if false, all rules must be true */
  mode?: 'ANY' | 'ALL'; // default ANY
};

export type LadderExitSpec = {
  enabled: boolean;
  levels: LadderLevel[];
};

export type ExitPlan = {
  ladder?: LadderExitSpec;
  trailing?: TrailingStopSpec;
  indicator?: IndicatorExitSpec;

  /** max hold after entry (ms). if exceeded, exit remainder at close */
  max_hold_ms?: number;

  /** minimum candles after entry before indicator exits can trigger (avoid instant flips) */
  min_hold_candles_for_indicator?: number; // default 0
};

export type ExitFill = {
  tsMs: number;
  px: number;
  fraction: number; // fraction of ORIGINAL position
  reason: string;
};

export type ExitSimParams = {
  candles: Candle[]; // chronologically sorted
  entryTsMs: number; // ms
  entryPx: number;
  plan: ExitPlan;

  /** Fees/slippage in bps applied per fill (simple model). */
  taker_fee_bps: number;
  slippage_bps: number;
};

export type ExitSimResult = {
  fills: ExitFill[]; // partial exits
  exitTsMs: number;
  exitPxVwap: number; // VWAP of fills
  exitReason: string; // final reason (what closed remainder)
  remainingFraction: number; // should be 0 if fully exited, else >0 (only if no exit happened)
};

/** Utility: candle timestamp seconds -> ms */
export function candleTsMs(c: Candle): number {
  return c.timestamp * 1000;
}

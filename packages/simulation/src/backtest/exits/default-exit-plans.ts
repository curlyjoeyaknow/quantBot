import type { ExitPlan } from './exit-plan.js';

export const defaultPumpLadderTrail: ExitPlan = {
  ladder: {
    enabled: true,
    levels: [
      { kind: 'multiple', multiple: 2.0, fraction: 0.25 },
      { kind: 'multiple', multiple: 3.0, fraction: 0.25 },
      { kind: 'multiple', multiple: 4.0, fraction: 0.25 },
    ],
  },
  trailing: {
    enabled: true,
    trail_bps: 1500, // 15%
    activation: { kind: 'multiple', multiple: 2.0 },
    hard_stop_bps: 2500, // 25% SL from entry (optional)
    intrabar_policy: 'STOP_FIRST',
  },
  indicator: {
    enabled: true,
    mode: 'ANY',
    rules: [
      { type: 'ichimoku_cross', tenkan: 9, kijun: 26, direction: 'bearish' },
      { type: 'ema_cross', fast: 9, slow: 21, direction: 'bearish' },
      { type: 'rsi_cross', period: 14, level: 50, direction: 'down' },
      { type: 'volume_spike', window: 30, z: 3.0 }, // optional (usually for "get out on frenzy")
    ],
  },
  max_hold_ms: 60 * 60 * 1000, // 1 hour
  min_hold_candles_for_indicator: 3,
};

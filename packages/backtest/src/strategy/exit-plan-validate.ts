import { z } from 'zod';

const LadderLevel = z.union([
  z.object({
    kind: z.literal('multiple'),
    multiple: z.number().positive(),
    fraction: z.number().min(0).max(1),
  }),
  z.object({ kind: z.literal('pct'), pct: z.number(), fraction: z.number().min(0).max(1) }),
]);

const LadderExitSpec = z.object({
  enabled: z.boolean(),
  levels: z.array(LadderLevel).default([]),
});

const TrailingActivation = z.union([
  z.object({ kind: z.literal('multiple'), multiple: z.number().positive() }),
  z.object({ kind: z.literal('pct'), pct: z.number() }),
]);

const TrailingStopSpec = z.object({
  enabled: z.boolean(),
  trail_bps: z.number().positive(),
  activation: TrailingActivation.optional(),
  hard_stop_bps: z.number().positive().optional(),
  intrabar_policy: z.enum(['STOP_FIRST', 'TP_FIRST', 'HIGH_THEN_LOW', 'LOW_THEN_HIGH']).optional(),
});

const IndicatorRule = z.union([
  z.object({
    type: z.literal('ichimoku_cross'),
    tenkan: z.number().int().positive(),
    kijun: z.number().int().positive(),
    direction: z.enum(['bearish', 'bullish']),
    source: z.enum(['close', 'hl2']).optional(),
  }),
  z.object({
    type: z.literal('ema_cross'),
    fast: z.number().int().positive(),
    slow: z.number().int().positive(),
    direction: z.enum(['bearish', 'bullish']),
    source: z.enum(['close']).optional(),
  }),
  z.object({
    type: z.literal('rsi_cross'),
    period: z.number().int().positive(),
    level: z.number(),
    direction: z.enum(['down', 'up']),
    source: z.enum(['close']).optional(),
  }),
  z.object({
    type: z.literal('volume_spike'),
    window: z.number().int().positive(),
    z: z.number().positive(),
  }),
]);

const IndicatorExitSpec = z.object({
  enabled: z.boolean(),
  rules: z.array(IndicatorRule).default([]),
  mode: z.enum(['ANY', 'ALL']).optional(),
});

export const ExitPlanZ = z.object({
  ladder: LadderExitSpec.optional(),
  trailing: TrailingStopSpec.optional(),
  indicator: IndicatorExitSpec.optional(),
  max_hold_ms: z.number().int().positive().optional(),
  min_hold_candles_for_indicator: z.number().int().min(0).optional(),
});

export type ExitPlan = z.infer<typeof ExitPlanZ>;

export function parseExitPlan(json: string): ExitPlan {
  const obj = JSON.parse(json);
  return ExitPlanZ.parse(obj);
}

import { z } from 'zod';
import type { ExitOverlay } from '@quantbot/simulation';

/**
 * Exit overlay schema (supports all overlay kinds)
 */
const exitOverlaySchema: z.ZodType<ExitOverlay> = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('time_exit'),
    holdMs: z.number().int().positive(),
  }),
  z.object({
    kind: z.literal('stop_loss'),
    stopPct: z.number().positive().max(100),
  }),
  z.object({
    kind: z.literal('take_profit'),
    takePct: z.number().positive(),
  }),
  z.object({
    kind: z.literal('trailing_stop'),
    trailPct: z.number().positive().max(100),
  }),
  z.object({
    kind: z.literal('combo'),
    legs: z.array(z.lazy(() => exitOverlaySchema)),
  }),
]);

export const evaluateCallsSchema = z.object({
  callsFile: z.string().min(1, 'Calls file path is required'),
  lagMs: z.coerce.number().int().min(0).default(10_000),
  entryRule: z.enum(['next_candle_open', 'next_candle_close', 'call_time_close']).default('next_candle_open'),
  timeframeMs: z.coerce.number().int().positive().default(24 * 60 * 60 * 1000), // 24 hours
  interval: z.enum(['1s', '1m', '5m', '1h']).default('5m'),
  takerFeeBps: z.coerce.number().int().min(0).max(10000).default(30), // 0.30%
  slippageBps: z.coerce.number().int().min(0).max(10000).default(10), // 0.10%
  overlays: z.array(exitOverlaySchema).min(1, 'At least one overlay is required'),
  notionalUsd: z.coerce.number().positive().default(1000),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export type EvaluateCallsArgs = z.infer<typeof evaluateCallsSchema>;

export const sweepCallsSchema = z.object({
  'calls-file': z.string().min(1, 'Calls file path is required'),
  intervals: z.array(z.enum(['1s', '1m', '5m', '1h'])).min(1, 'At least one interval is required'),
  'lags-ms': z.array(z.coerce.number().int().min(0)).min(1, 'At least one lag is required'),
  'overlays-file': z.string().optional(),
  'overlay-sets-file': z.string().optional(),
  out: z.string().min(1, 'Output directory is required'),
  'entry-rule': z.enum(['next_candle_open', 'next_candle_close', 'call_time_close']).default('next_candle_open'),
  'timeframe-ms': z.coerce.number().int().positive().default(24 * 60 * 60 * 1000), // 24 hours
  'taker-fee-bps': z.coerce.number().int().min(0).max(10000).default(30), // 0.30%
  'slippage-bps': z.coerce.number().int().min(0).max(10000).default(10), // 0.10%
  'notional-usd': z.coerce.number().positive().default(1000),
  format: z.enum(['json', 'table', 'csv']).default('table'),
}).refine(
  (data) => data['overlays-file'] || data['overlay-sets-file'],
  {
    message: 'Either overlays-file or overlay-sets-file is required',
    path: ['overlays-file'],
  }
);

export type SweepCallsArgs = z.infer<typeof sweepCallsSchema>;

export const exportCallsSchema = z.object({
  'duckdb-path': z.string().min(1, 'DuckDB path is required'),
  'from-iso': z.string().min(1, 'from-iso is required'),
  'to-iso': z.string().min(1, 'to-iso is required'),
  'caller-name': z.string().optional(),
  limit: z.coerce.number().int().min(1).max(10000).default(200),
  out: z.string().min(1, 'Output file path is required'),
  format: z.enum(['json', 'table', 'csv']).default('json'),
});

export type ExportCallsArgs = z.infer<typeof exportCallsSchema>;


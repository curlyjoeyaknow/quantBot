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
  entryRule: z
    .enum(['next_candle_open', 'next_candle_close', 'call_time_close'])
    .default('next_candle_open'),
  timeframeMs: z.coerce
    .number()
    .int()
    .positive()
    .default(24 * 60 * 60 * 1000), // 24 hours
  interval: z.enum(['1s', '1m', '5m', '1h']).default('5m'),
  takerFeeBps: z.coerce.number().int().min(0).max(10000).default(30), // 0.30%
  slippageBps: z.coerce.number().int().min(0).max(10000).default(10), // 0.10%
  overlays: z.array(exitOverlaySchema).min(1, 'At least one overlay is required'),
  notionalUsd: z.coerce.number().positive().default(1000),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export type EvaluateCallsArgs = z.infer<typeof evaluateCallsSchema>;

export const sweepCallsSchema = z
  .object({
    config: z.string().optional(), // Config file path (YAML/JSON)
    callsFile: z.string().min(1, 'Calls file path is required').optional(),
    intervals: z
      .array(z.enum(['1s', '1m', '5m', '1h']))
      .min(1, 'At least one interval is required')
      .optional(),
    lagsMs: z
      .array(z.coerce.number().int().min(0))
      .min(1, 'At least one lag is required')
      .optional(),
    overlaysFile: z.string().optional(),
    overlaySetsFile: z.string().optional(),
    out: z.string().min(1, 'Output directory is required').optional(),
    entryRule: z
      .enum(['next_candle_open', 'next_candle_close', 'call_time_close'])
      .default('next_candle_open'),
    timeframeMs: z.coerce
      .number()
      .int()
      .positive()
      .default(24 * 60 * 60 * 1000), // 24 hours
    takerFeeBps: z.coerce.number().int().min(0).max(10000).default(30), // 0.30%
    slippageBps: z.coerce.number().int().min(0).max(10000).default(10), // 0.10%
    notionalUsd: z.coerce.number().positive().default(1000),
    format: z.enum(['json', 'table', 'csv']).default('table'),
    resume: z.boolean().default(false), // Resume from previous run
  })
  .refine(
    (data) => {
      // If config is provided, these fields will be loaded from config
      if (data.config) return true;
      // If no config, require these fields
      return data.callsFile && data.intervals && data.lagsMs && data.out;
    },
    {
      message: 'Either provide --config, or all of: --calls-file, --intervals, --lags-ms, --out',
      path: ['config'],
    }
  )
  .refine(
    (data) => {
      // If config is provided, overlay files will be loaded from config
      if (data.config) return true;
      // If no config, require overlay files
      return data.overlaysFile || data.overlaySetsFile;
    },
    {
      message: 'Either provide --config, or one of: --overlays-file, --overlay-sets-file',
      path: ['overlaysFile'],
    }
  );

export type SweepCallsArgs = z.infer<typeof sweepCallsSchema>;

export const exportCallsSchema = z.object({
  duckdbPath: z.string().min(1, 'DuckDB path is required'),
  fromIso: z.string().min(1, 'from-iso is required'),
  toIso: z.string().min(1, 'to-iso is required'),
  callerName: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(10000).default(200),
  out: z.string().min(1, 'Output file path is required'),
  format: z.enum(['json', 'table', 'csv']).default('json'),
});

export type ExportCallsArgs = z.infer<typeof exportCallsSchema>;

export const exportCallsWithSimulationSchema = z.object({
  duckdbPath: z.string().min(1, 'DuckDB path is required'),
  fromIso: z.string().min(1, 'from-iso is required'),
  toIso: z.string().min(1, 'to-iso is required'),
  callerName: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(10000).default(1000),
  out: z.string().min(1, 'Output CSV file path is required'),
  // Simulation parameters
  lagMs: z.coerce.number().int().min(0).default(10_000),
  entryRule: z
    .enum(['next_candle_open', 'next_candle_close', 'call_time_close'])
    .default('next_candle_open'),
  timeframeMs: z.coerce.number().int().positive().default(24 * 60 * 60 * 1000),
  interval: z.enum(['1s', '1m', '5m', '15m', '1h']).default('5m'),
  takerFeeBps: z.coerce.number().int().min(0).max(10000).default(30),
  slippageBps: z.coerce.number().int().min(0).max(10000).default(10),
  notionalUsd: z.coerce.number().positive().default(1000),
  overlays: z
    .union([z.string(), z.array(z.any())])
    .optional()
    .transform((val) => {
      if (!val) return undefined;
      if (typeof val === 'string') return JSON.parse(val);
      return val;
    }),
});

export type ExportCallsWithSimulationArgs = z.infer<typeof exportCallsWithSimulationSchema>;

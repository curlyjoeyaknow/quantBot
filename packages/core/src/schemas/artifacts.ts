/**
 * Simulator Artifact Contract Schemas
 *
 * Zod schemas for RunPlanV1, CoverageReportV1, SliceManifestV1, and ReplayFrameV1
 * as defined in the Simulator Architecture Plan.
 */

import { z } from 'zod';

/**
 * RunPlanV1 Schema
 *
 * Preflight artifact that defines candle requirements for a simulation run.
 */
export const RunPlanV1Schema = z.object({
  schema_version: z.literal(1),
  run_id: z.string(),
  interval_seconds: z.number().int().positive(),
  requested_range: z.object({
    from_ts: z.string(), // ISO timestamp
    to_ts: z.string(), // ISO timestamp
  }),
  requirements: z.object({
    indicator_warmup_candles: z.number().int().nonnegative(),
    entry_delay_candles: z.number().int().nonnegative(),
    max_hold_candles: z.number().int().positive(),
    pre_entry_context_candles: z.number().int().nonnegative(),
    total_required_candles: z.number().int().positive(),
  }),
  per_token_windows: z.array(
    z.object({
      token: z.string(),
      from_ts: z.string(), // ISO timestamp
      to_ts: z.string(), // ISO timestamp
      required_candles: z.number().int().positive(),
    })
  ),
});

export type RunPlanV1 = z.infer<typeof RunPlanV1Schema>;

/**
 * CoverageReportV1 Schema
 *
 * Gate artifact that reports eligible and excluded tokens.
 */
export const CoverageReportV1Schema = z.object({
  schema_version: z.literal(1),
  run_id: z.string(),
  interval_seconds: z.number().int().positive(),
  eligible: z.array(z.string()),
  excluded: z.array(
    z.object({
      token: z.string(),
      reason: z.enum(['too_new', 'insufficient_range', 'missing_interval', 'no_data']),
      details: z.string().optional(),
    })
  ),
  stats: z.object({
    requested: z.number().int().nonnegative(),
    eligible: z.number().int().nonnegative(),
    excluded: z.number().int().nonnegative(),
    eligible_pct: z.number().min(0).max(1),
  }),
});

export type CoverageReportV1 = z.infer<typeof CoverageReportV1Schema>;

/**
 * SliceManifestV1 Schema
 *
 * Materialization contract that lists all slices for a run.
 */
export const SliceManifestV1Schema = z.object({
  schema_version: z.literal(1),
  run_id: z.string(),
  interval_seconds: z.number().int().positive(),
  format: z.enum(['json', 'parquet', 'duckdb']),
  slices: z.array(
    z.object({
      slice_id: z.string(),
      path: z.string(),
      tokens: z.array(z.string()),
      from_ts: z.string(), // ISO timestamp
      to_ts: z.string(), // ISO timestamp
      candle_count_est: z.number().int().nonnegative(),
    })
  ),
});

export type SliceManifestV1 = z.infer<typeof SliceManifestV1Schema>;

/**
 * ReplayFrameV1 Schema
 *
 * Single frame in a replay sequence for UI playback.
 */
export const ReplayFrameV1Schema = z.object({
  seq: z.number().int().nonnegative(),
  candle: z.object({
    ts: z.string(), // ISO timestamp
    o: z.number(),
    h: z.number(),
    l: z.number(),
    c: z.number(),
    v: z.number(),
  }),
  events: z.array(
    z.object({
      ts: z.string(), // ISO timestamp
      type: z.string(),
      data: z.record(z.string(), z.unknown()),
    })
  ),
  position: z.object({
    is_open: z.boolean(),
    size_pct: z.number(),
    avg_price: z.number().nullable(),
    stop_price: z.number().nullable(),
    unrealized_pnl_pct: z.number().nullable(),
  }),
});

export type ReplayFrameV1 = z.infer<typeof ReplayFrameV1Schema>;


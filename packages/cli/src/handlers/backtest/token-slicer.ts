/**
 * Token Slicer Handler
 *
 * Handler for Python-based token slice export.
 * Wraps TokenSlicerService (token_slicer.py).
 *
 * Pure handler - no console.log, no process.exit, no try/catch.
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { z as zod } from 'zod';

// =============================================================================
// Zod Schemas
// =============================================================================

export const tokenSlicerSchema = zod.object({
  mint: zod.string(),
  chain: zod.string().default('solana'),
  alertTsMs: zod.number(),
  intervalSeconds: zod.number().int().positive().default(60),
  horizonHours: zod.number().int().positive().default(48),
  preWindowMinutes: zod.number().int().positive().default(5),
  outputDir: zod.string(),
  duckdb: zod.string().optional(),
});

export const batchTokenSlicerSchema = zod.object({
  duckdb: zod.string(),
  from: zod.string(), // YYYY-MM-DD
  to: zod.string(), // YYYY-MM-DD
  chain: zod.string().default('solana'),
  intervalSeconds: zod.number().int().positive().default(60),
  horizonHours: zod.number().int().positive().default(48),
  preWindowMinutes: zod.number().int().positive().default(5),
  outputDir: zod.string(),
  threads: zod.number().int().positive().default(16),
  reuseSlice: zod.boolean().default(false),
});

export type TokenSlicerArgs = z.infer<typeof tokenSlicerSchema>;
export type BatchTokenSlicerArgs = z.infer<typeof batchTokenSlicerSchema>;

// =============================================================================
// Handlers
// =============================================================================

/**
 * Export candle slice for a single token
 *
 * @param args - Validated command arguments
 * @param ctx - Command context with services
 * @returns Slice export result
 */
export async function tokenSlicerHandler(args: TokenSlicerArgs, ctx: CommandContext) {
  await ctx.ensureInitialized();

  const service = ctx.services.tokenSlicer();

  const result = await service.exportSlice({
    mint: args.mint,
    chain: args.chain,
    alert_ts_ms: args.alertTsMs,
    interval_seconds: args.intervalSeconds,
    horizon_hours: args.horizonHours,
    pre_window_minutes: args.preWindowMinutes,
    output_dir: args.outputDir,
    duckdb: args.duckdb,
  });

  if (!result.success) {
    throw new Error(result.error ?? 'Slice export failed');
  }

  return {
    success: true,
    mint: result.mint,
    slice_path: result.slice_path,
    candles: result.candles,
  };
}

/**
 * Export candle slices for multiple alerts in batch
 *
 * @param args - Validated command arguments
 * @param ctx - Command context with services
 * @returns Batch slice export result
 */
export async function batchTokenSlicerHandler(args: BatchTokenSlicerArgs, ctx: CommandContext) {
  await ctx.ensureInitialized();

  const service = ctx.services.tokenSlicer();

  const result = await service.exportSlicesForAlerts({
    duckdb: args.duckdb,
    from: args.from,
    to: args.to,
    chain: args.chain,
    interval_seconds: args.intervalSeconds,
    horizon_hours: args.horizonHours,
    pre_window_minutes: args.preWindowMinutes,
    output_dir: args.outputDir,
    threads: args.threads,
    reuse_slice: args.reuseSlice,
  });

  if (!result.success) {
    throw new Error('Batch slice export failed');
  }

  return {
    success: true,
    total_slices: result.total_slices,
    successful: result.successful,
    failed: result.failed,
    output_dir: result.output_dir,
    slices: result.slices,
  };
}

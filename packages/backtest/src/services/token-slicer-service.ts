/**
 * Token Slicer Service
 *
 * Service layer for Python-based token slice export.
 * Wraps token_slicer.py script for exporting candle slices.
 *
 * Architecture: Python bears the brunt of data science workload, TypeScript orchestrates.
 */

import { z } from 'zod';
import type { PythonEngine } from '@quantbot/utils';
import { logger, AppError, TimeoutError, findWorkspaceRoot } from '@quantbot/utils';
import { join } from 'path';

// =============================================================================
// Zod Schemas
// =============================================================================

/**
 * Token slice export configuration schema
 */
export const TokenSliceExportConfigSchema = z.object({
  mint: z.string(),
  chain: z.string().default('solana'),
  alert_ts_ms: z.number(),
  interval_seconds: z.number().int().positive().default(60),
  horizon_hours: z.number().int().positive().default(48),
  pre_window_minutes: z.number().int().positive().default(5),
  output_dir: z.string(),
  duckdb: z.string().optional(),
});

/**
 * Batch slice export configuration schema
 */
export const BatchSliceExportConfigSchema = z.object({
  duckdb: z.string(),
  from: z.string(), // YYYY-MM-DD
  to: z.string(), // YYYY-MM-DD
  chain: z.string().default('solana'),
  interval_seconds: z.number().int().positive().default(60),
  horizon_hours: z.number().int().positive().default(48),
  pre_window_minutes: z.number().int().positive().default(5),
  output_dir: z.string(),
  threads: z.number().int().positive().default(16),
  reuse_slice: z.boolean().default(false),
});

/**
 * Slice export result schema
 */
export const SliceExportResultSchema = z.object({
  success: z.boolean(),
  mint: z.string(),
  slice_path: z.string(),
  candles: z.number(),
  error: z.string().optional(),
});

/**
 * Batch slice export result schema
 */
export const BatchSliceExportResultSchema = z.object({
  success: z.boolean(),
  total_slices: z.number(),
  successful: z.number(),
  failed: z.number(),
  output_dir: z.string(),
  slices: z.array(SliceExportResultSchema),
});

// =============================================================================
// TypeScript Types
// =============================================================================

export type TokenSliceExportConfig = z.infer<typeof TokenSliceExportConfigSchema>;
export type BatchSliceExportConfig = z.infer<typeof BatchSliceExportConfigSchema>;
export type SliceExportResult = z.infer<typeof SliceExportResultSchema>;
export type BatchSliceExportResult = z.infer<typeof BatchSliceExportResultSchema>;

// =============================================================================
// Token Slicer Service
// =============================================================================

/**
 * Token Slicer Service
 *
 * Wraps Python implementation of token slice export.
 * Python handles ClickHouse queries and Parquet export, TypeScript handles orchestration.
 */
export class TokenSlicerService {
  constructor(private readonly pythonEngine: PythonEngine) {}

  /**
   * Export candle slice for a single token
   *
   * @param config - Slice export configuration
   * @returns Validated slice export result
   */
  async exportSlice(config: TokenSliceExportConfig): Promise<SliceExportResult> {
    const scriptPath = 'packages/backtest/python/scripts/token_slicer.py';
    const workspaceRoot = findWorkspaceRoot();

    try {
      logger.info('[TokenSlicerService] Exporting slice for token', {
        mint: config.mint,
        chain: config.chain,
      });

      // Build arguments for Python script
      const args: Record<string, unknown> = {
        mint: config.mint,
        chain: config.chain,
        'alert-ts-ms': config.alert_ts_ms,
        'interval-seconds': config.interval_seconds,
        'horizon-hours': config.horizon_hours,
        'pre-window-minutes': config.pre_window_minutes,
        'output-dir': config.output_dir,
        format: 'json',
      };

      if (config.duckdb) {
        args.duckdb = config.duckdb;
      }

      const result = await this.pythonEngine.runScript(
        scriptPath,
        args,
        SliceExportResultSchema,
        {
          timeout: 300000, // 5 minute timeout
          cwd: join(workspaceRoot, 'packages/backtest/python'),
          env: {
            PYTHONPATH: join(workspaceRoot, 'packages/backtest/python'),
          },
        }
      );

      logger.info('[TokenSlicerService] Slice export completed', {
        mint: config.mint,
        candles: result.candles,
        slice_path: result.slice_path,
      });

      return result;
    } catch (error) {
      logger.error('[TokenSlicerService] Slice export failed', error as Error);

      if (error instanceof AppError || error instanceof TimeoutError) {
        throw error;
      }

      throw new AppError(
        `Slice export failed: ${error instanceof Error ? error.message : String(error)}`,
        'SLICE_EXPORT_FAILED',
        500,
        { config }
      );
    }
  }

  /**
   * Export candle slices for multiple alerts in batch
   *
   * @param config - Batch slice export configuration
   * @returns Validated batch slice export result
   */
  async exportSlicesForAlerts(config: BatchSliceExportConfig): Promise<BatchSliceExportResult> {
    const scriptPath = 'packages/backtest/python/scripts/token_slicer.py';
    const workspaceRoot = findWorkspaceRoot();

    try {
      logger.info('[TokenSlicerService] Exporting slices for alerts', {
        from: config.from,
        to: config.to,
        chain: config.chain,
      });

      // Build arguments for Python script
      const args: Record<string, unknown> = {
        duckdb: config.duckdb,
        from: config.from,
        to: config.to,
        chain: config.chain,
        'interval-seconds': config.interval_seconds,
        'horizon-hours': config.horizon_hours,
        'pre-window-minutes': config.pre_window_minutes,
        'output-dir': config.output_dir,
        threads: config.threads,
        batch: true,
        format: 'json',
      };

      if (config.reuse_slice) {
        args['reuse-slice'] = true;
      }

      const result = await this.pythonEngine.runScript(
        scriptPath,
        args,
        BatchSliceExportResultSchema,
        {
          timeout: 1800000, // 30 minute timeout (can be slow for large batches)
          cwd: join(workspaceRoot, 'packages/backtest/python'),
          env: {
            PYTHONPATH: join(workspaceRoot, 'packages/backtest/python'),
          },
        }
      );

      logger.info('[TokenSlicerService] Batch slice export completed', {
        total_slices: result.total_slices,
        successful: result.successful,
        failed: result.failed,
      });

      return result;
    } catch (error) {
      logger.error('[TokenSlicerService] Batch slice export failed', error as Error);

      if (error instanceof AppError || error instanceof TimeoutError) {
        throw error;
      }

      throw new AppError(
        `Batch slice export failed: ${error instanceof Error ? error.message : String(error)}`,
        'BATCH_SLICE_EXPORT_FAILED',
        500,
        { config }
      );
    }
  }
}


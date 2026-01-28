/**
 * Lake Exporter Service
 *
 * Thin wrapper around PythonEngine for Parquet Lake v1 exports.
 * Passes config JSON to Python script, returns typed results.
 */

import { z } from 'zod';
import type { PythonEngine } from '@quantbot/infra/utils';
import { logger } from '@quantbot/infra/utils';
import { join } from 'path';
import { findWorkspaceRoot } from '@quantbot/infra/utils';

/**
 * Schema for lake run slice export config
 */
export const LakeRunSliceExportConfigSchema = z.object({
  data_root: z.string(),
  run_id: z.string(),
  interval: z.string(), // e.g., "1s", "5s", "1m"
  window: z.string(), // e.g., "pre52_post4948"
  alerts_path: z.string(),
  chain: z.string().default('solana'),
  compression: z.enum(['zstd', 'snappy', 'none']).default('zstd'),
  target_file_mb: z.number().int().positive().default(512),
  strict_coverage: z.boolean().default(false),
  min_required_pre: z.number().int().positive().default(52),
  target_total: z.number().int().positive().default(5000),
  clickhouse: z.object({
    host: z.string(),
    port: z.number().int().positive(),
    database: z.string(),
    table: z.string(),
    user: z.string(),
    password: z.string().default(''),
    connect_timeout: z.number().int().positive().default(10),
    send_receive_timeout: z.number().int().positive().default(300),
  }),
});

export type LakeRunSliceExportConfig = z.infer<typeof LakeRunSliceExportConfigSchema>;

/**
 * Schema for lake export result
 */
export const LakeExportResultSchema = z.object({
  manifest: z.object({
    lake_version: z.string(),
    run_id: z.string(),
    created_at: z.string(),
    exporter: z.object({
      name: z.string(),
      version: z.string(),
    }),
    inputs: z.object({
      alerts: z.object({
        path: z.string(),
        sha256: z.string(),
        rows: z.number(),
      }),
      source_snapshot: z.object({
        clickhouse: z.object({
          cluster: z.string(),
          database: z.string(),
          table: z.string(),
          as_of: z.string(),
        }),
      }),
    }),
    slice_spec: z.object({
      dataset: z.string(),
      interval: z.string(),
      window: z.string(),
      anchor_rule: z.string(),
    }),
    outputs: z.record(
      z.string(),
      z.object({
        mint_buckets: z.array(z.string()),
        files: z.number(),
        rows: z.number(),
      })
    ),
    coverage: z.object({
      min_required_pre: z.number(),
      target_total: z.number(),
      kept_events: z.number(),
      dropped_events: z.number(),
    }),
  }),
  manifest_path: z.string(),
  coverage_path: z.string(),
  total_rows: z.number(),
  total_files: z.number(),
  total_bytes: z.number(),
});

export type LakeExportResult = z.infer<typeof LakeExportResultSchema>;

/**
 * Lake Exporter Service
 */
export class LakeExporterService {
  constructor(private readonly pythonEngine: PythonEngine) {}

  /**
   * Export run-scoped slices to Parquet Lake v1 format
   */
  async exportRunSlices(config: LakeRunSliceExportConfig): Promise<LakeExportResult> {
    try {
      // Validate config
      const validatedConfig = LakeRunSliceExportConfigSchema.parse(config);

      // Resolve Python script path
      const scriptPath = join(findWorkspaceRoot(), 'tools/lake/export_lake_run_slices.py');

      logger.info('Exporting lake run slices', {
        run_id: validatedConfig.run_id,
        interval: validatedConfig.interval,
        window: validatedConfig.window,
      });

      // Call Python script with config
      const result = await this.pythonEngine.runScriptWithStdin(
        scriptPath,
        validatedConfig,
        LakeExportResultSchema,
        {
          timeout: 30 * 60 * 1000, // 30 minutes timeout for large exports
        }
      );

      logger.info('Lake export completed', {
        run_id: validatedConfig.run_id,
        total_rows: result.total_rows,
        total_files: result.total_files,
      });

      return result;
    } catch (error) {
      logger.error('Failed to export lake run slices', error as Error, {
        run_id: config.run_id,
      });
      throw error;
    }
  }
}

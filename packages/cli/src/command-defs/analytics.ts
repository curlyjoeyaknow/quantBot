/**
 * Analytics Command Definitions
 *
 * Shared schemas and types for analytics commands.
 * Imported by both commands/*.ts (for CLI help/options) and handlers/*.ts (for types).
 */

import { z } from 'zod';

/**
 * Analyze command schema
 */
export const analyzeSchema = z.object({
  caller: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Analyze command arguments type
 */
export type AnalyzeArgs = z.infer<typeof analyzeSchema>;

/**
 * Metrics command schema
 */
export const metricsSchema = z.object({
  caller: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Metrics command arguments type
 */
export type MetricsArgs = z.infer<typeof metricsSchema>;

/**
 * Report command schema
 */
export const reportSchema = z.object({
  caller: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

export const analyzeDuckdbSchema = z.object({
  duckdb: z.string(),
  caller: z.string().optional(),
  mint: z.string().optional(),
  correlation: z
    .object({
      feature_cols: z.array(z.string()),
      target_col: z.string().default('ath_multiple'),
    })
    .optional(),
  format: z.enum(['json', 'table', 'csv']).default('table'),
});

/**
 * Report command arguments type
 */
export type ReportArgs = z.infer<typeof reportSchema>;

/**
 * Analyze DuckDB command arguments type
 */
export type AnalyzeDuckdbArgs = z.infer<typeof analyzeDuckdbSchema>;

/**
 * Analytics Service
 *
 * Service layer for DuckDB-based analytics operations.
 * Wraps PythonEngine calls and validates output with Zod schemas.
 */

import { z } from 'zod';
import type { PythonEngine } from '@quantbot/utils';
import { logger, AppError, TimeoutError } from '@quantbot/utils';
import { join } from 'path';

/**
 * Schema for caller analysis result
 */
export const CallerAnalysisResultSchema = z.object({
  caller_name: z.string().optional(),
  total_calls: z.number().optional(),
  win_rate: z.number().optional(),
  avg_return: z.number().optional(),
  error: z.string().optional(),
});

/**
 * Schema for mint analysis result
 */
export const MintAnalysisResultSchema = z.object({
  mint: z.string().optional(),
  total_candles: z.number().optional(),
  volatility: z.number().optional(),
  error: z.string().optional(),
});

/**
 * Schema for correlation analysis result
 */
export const CorrelationAnalysisResultSchema = z.record(z.string(), z.unknown());

/**
 * Union schema for all analysis results
 */
export const AnalyticsResultSchema = z.union([
  CallerAnalysisResultSchema,
  MintAnalysisResultSchema,
  CorrelationAnalysisResultSchema,
]);

export type CallerAnalysisResult = z.infer<typeof CallerAnalysisResultSchema>;
export type MintAnalysisResult = z.infer<typeof MintAnalysisResultSchema>;
export type CorrelationAnalysisResult = z.infer<typeof CorrelationAnalysisResultSchema>;
export type AnalyticsResult = z.infer<typeof AnalyticsResultSchema>;

/**
 * Analytics configuration
 */
export interface AnalyticsConfig {
  duckdb: string;
  caller?: string;
  mint?: string;
  correlation?: boolean;
}

/**
 * Analytics Service
 */
export class AnalyticsService {
  constructor(private readonly pythonEngine: PythonEngine) {}

  /**
   * Run analytics analysis
   *
   * @param config - Analytics configuration
   * @returns Validated analysis results
   */
  async runAnalysis(config: AnalyticsConfig): Promise<AnalyticsResult> {
    const scriptPath = 'tools/telegram/cli/analyze.py';

    // Build command arguments
    const args: Record<string, unknown> = {
      duckdb: config.duckdb,
    };

    if (config.caller) {
      args.caller = config.caller;
    } else if (config.mint) {
      args.mint = config.mint;
    } else if (config.correlation) {
      args.correlation = true;
    }

    try {
      const result = await this.pythonEngine.runScript(scriptPath, args, AnalyticsResultSchema, {
        timeout: 60000, // 1 minute timeout
        cwd: join(process.cwd(), 'tools/telegram'),
        env: {
          PYTHONPATH: join(process.cwd(), 'tools/telegram'),
        },
      });

      return result;
    } catch (error) {
      logger.error('Analysis failed', error as Error);

      // Re-throw AppErrors as-is
      if (error instanceof AppError || error instanceof TimeoutError) {
        throw error;
      }

      // Wrap other errors
      throw new AppError(
        `Analysis failed: ${error instanceof Error ? error.message : String(error)}`,
        'ANALYSIS_FAILED',
        500,
        { config }
      );
    }
  }
}

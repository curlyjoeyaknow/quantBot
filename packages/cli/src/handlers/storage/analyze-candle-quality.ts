/**
 * Handler: Analyze candle data quality
 * 
 * Identifies tokens with data quality issues:
 * - Duplicate candles
 * - Gaps in data
 * - Price distortions
 * - Volume anomalies
 * 
 * Generates a prioritized re-ingestion worklist.
 */

import type { CommandContext } from '../../core/command-context.js';
import { logger } from '@quantbot/utils';
import { PythonEngine } from '@quantbot/utils';
import { z } from 'zod';

export interface AnalyzeCandleQualityArgs {
  duckdb?: string;
  output?: string;
  csv?: string;
  limit?: number;
  interval?: '1s' | '15s' | '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  minQualityScore?: number;
}

const CandleQualityResultSchema = z.object({
  generated_at: z.string(),
  summary: z.object({
    total_tokens_analyzed: z.number(),
    tokens_needing_reingest: z.number(),
    reingest_rate: z.string(),
    by_priority: z.record(z.number()),
    by_issue_type: z.record(z.number()),
  }),
  worklist: z.array(
    z.object({
      mint: z.string(),
      chain: z.string(),
      alert_count: z.number(),
      quality_score: z.number(),
      priority: z.enum(['critical', 'high', 'medium', 'low']),
      needs_reingest: z.boolean(),
      duplicates: z.object({
        has_duplicates: z.boolean(),
        duplicate_count: z.number().optional(),
      }),
      gaps: z.object({
        has_gaps: z.boolean(),
        gap_count: z.number().optional(),
      }),
      distortions: z.object({
        has_distortions: z.boolean(),
        total_distortions: z.number().optional(),
      }),
    })
  ),
});

export type CandleQualityResult = z.infer<typeof CandleQualityResultSchema>;

export async function analyzeCandleQualityHandler(
  args: AnalyzeCandleQualityArgs,
  _ctx: CommandContext
): Promise<CandleQualityResult> {
  const duckdbPath = args.duckdb || process.env.DUCKDB_PATH || 'data/alerts.duckdb';
  const outputPath = args.output || 'candle_quality_worklist.json';
  const interval = args.interval || '5m';

  try {
    const pythonEngine = new PythonEngine();

    // Build Python script arguments
    const scriptArgs = [
      '--duckdb',
      duckdbPath,
      '--output',
      outputPath,
      '--interval',
      interval,
    ];

    if (args.csv) {
      scriptArgs.push('--csv', args.csv);
    }

    if (args.limit) {
      scriptArgs.push('--limit', String(args.limit));
    }

    if (args.minQualityScore !== undefined) {
      scriptArgs.push('--min-quality-score', String(args.minQualityScore));
    }

    logger.info('Running candle quality analysis', {
      duckdbPath,
      outputPath,
      interval,
      limit: args.limit,
    });

    // Run Python script
    const result = await pythonEngine.runScript(
      'tools/storage/analyze_candle_quality.py',
      scriptArgs,
      CandleQualityResultSchema
    );

    logger.info('Candle quality analysis complete', {
      tokensAnalyzed: result.summary.total_tokens_analyzed,
      tokensNeedingReingest: result.summary.tokens_needing_reingest,
      reingestRate: result.summary.reingest_rate,
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('Failed to analyze candle quality', error as Error);

    // Return empty result on error
    return {
      generated_at: new Date().toISOString(),
      summary: {
        total_tokens_analyzed: 0,
        tokens_needing_reingest: 0,
        reingest_rate: '0%',
        by_priority: {},
        by_issue_type: {},
      },
      worklist: [],
    };
  }
}


/**
 * OHLCV Detailed Coverage Analysis Workflow
 * ==========================================
 *
 * Orchestrates detailed OHLCV coverage analysis:
 * 1. For every MINT, CALLER, and DAY for every MONTH
 * 2. Calculates coverage percentages for:
 *    - 1m: -52 intervals before alert to min 9000 candles after alert
 *    - 5m: -52 intervals before alert to min 9000 candles after alert
 *    - For tokens < 3 months old:
 *      - 15s: -52 intervals before alert to 9000 after alert
 *      - 1s: -52 intervals before alert to 4948 after alert
 * 3. Returns structured, readable results
 *
 * This workflow follows the workflow contract:
 * - Validates spec with Zod
 * - Uses WorkflowContext for all dependencies
 * - Returns JSON-serializable results
 * - Explicit error policy (collect vs failFast)
 */

import { z } from 'zod';
import { DateTime } from 'luxon';
import { ValidationError } from '@quantbot/utils';
import type { PythonEngine } from '@quantbot/utils';
import { join, dirname } from 'path';
import { existsSync } from 'fs';

/**
 * Find workspace root by walking up from current directory
 */
function findWorkspaceRoot(startDir: string = process.cwd()): string {
  let current = startDir;
  while (current !== '/' && current !== '') {
    if (existsSync(join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return startDir;
}

/**
 * Detailed Coverage Analysis Spec
 */
export const AnalyzeDetailedCoverageSpecSchema = z.object({
  duckdbPath: z.string(),
  startMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(), // YYYY-MM format
  endMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(), // YYYY-MM format
  caller: z.string().optional(), // Filter by specific caller
  format: z.enum(['json', 'csv']).default('json'),
  timeoutMs: z.number().int().positive().optional(), // Timeout in milliseconds
});

export type AnalyzeDetailedCoverageSpec = z.infer<typeof AnalyzeDetailedCoverageSpecSchema>;

/**
 * Interval Coverage Result
 */
export interface IntervalCoverageResult {
  coverage_percent: number;
  expected_candles: number;
  actual_candles: number;
  has_sufficient_coverage: boolean;
}

/**
 * Detailed Coverage Result for a Single Call
 */
export interface DetailedCoverageRecord {
  mint: string;
  caller_name: string;
  alert_ts_ms: number;
  alert_datetime: string;
  day: string; // YYYY-MM-DD
  year_month: string; // YYYY-MM
  chain: string;
  is_young_token: boolean;
  intervals: {
    '1m'?: IntervalCoverageResult;
    '5m'?: IntervalCoverageResult;
    '15s'?: IntervalCoverageResult;
    '1s'?: IntervalCoverageResult;
  };
}

/**
 * Summary Statistics
 */
export interface DetailedCoverageSummary {
  total_calls: number;
  young_tokens: number;
  by_interval: Record<
    string,
    {
      total_calls: number;
      calls_with_sufficient_coverage: number;
      sufficient_coverage_percent: number;
      average_coverage_percent: number;
    }
  >;
  by_month: Record<
    string,
    {
      total_calls: number;
      by_interval: Record<
        string,
        {
          total: number;
          sufficient_coverage: number;
          sufficient_coverage_percent: number;
          average_coverage_percent: number;
        }
      >;
    }
  >;
}

/**
 * Detailed Coverage Analysis Result
 */
export interface AnalyzeDetailedCoverageResult {
  summary: DetailedCoverageSummary;
  by_mint_caller_day: DetailedCoverageRecord[];
  metadata: {
    generated_at: string;
    duckdb_path: string;
    start_month?: string | null;
    end_month?: string | null;
    caller_filter?: string | null;
    total_calls_analyzed: number;
  };
}

/**
 * Detailed Coverage Analysis Context
 */
export type AnalyzeDetailedCoverageContext = {
  pythonEngine: PythonEngine;
  logger: {
    info: (message: string, meta?: Record<string, unknown>) => void;
    error: (message: string, meta?: Record<string, unknown>) => void;
    debug: (message: string, meta?: Record<string, unknown>) => void;
  };
  clock: {
    now: () => DateTime;
  };
};

/**
 * OHLCV Detailed Coverage Analysis Workflow
 *
 * Follows workflow contract:
 * - Validates spec (Zod schema)
 * - Uses WorkflowContext (DI) - all dependencies via context
 * - Returns JSON-serializable result (ISO strings, no Date objects)
 * - Explicit error policy (collect vs failFast)
 */
export async function analyzeDetailedCoverage(
  spec: AnalyzeDetailedCoverageSpec,
  ctx: AnalyzeDetailedCoverageContext
): Promise<AnalyzeDetailedCoverageResult> {
  // 1. Validate spec
  const parsed = AnalyzeDetailedCoverageSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(`Invalid detailed coverage analysis spec: ${msg}`, {
      spec,
      issues: parsed.error.issues,
    });
  }

  const validated = parsed.data;

  ctx.logger.info('Starting detailed OHLCV coverage analysis', {
    spec: validated,
  });

  try {
    const args: Record<string, unknown> = {
      duckdb: validated.duckdbPath,
      format: validated.format,
      verbose: true,
    };

    if (validated.startMonth) args['start-month'] = validated.startMonth;
    if (validated.endMonth) args['end-month'] = validated.endMonth;
    if (validated.caller) args.caller = validated.caller;

    const resultSchema = z.object({
      summary: z.object({
        total_calls: z.number(),
        young_tokens: z.number(),
        by_interval: z.record(
          z.string(),
          z.object({
            total_calls: z.number(),
            calls_with_sufficient_coverage: z.number(),
            sufficient_coverage_percent: z.number(),
            average_coverage_percent: z.number(),
          })
        ),
        by_month: z.record(
          z.string(),
          z.object({
            total_calls: z.number(),
            by_interval: z.record(
              z.string(),
              z.object({
                total: z.number(),
                sufficient_coverage: z.number(),
                sufficient_coverage_percent: z.number(),
                average_coverage_percent: z.number(),
              })
            ),
          })
        ),
      }),
      by_mint_caller_day: z.array(
        z.object({
          mint: z.string(),
          caller_name: z.string(),
          alert_ts_ms: z.number(),
          alert_datetime: z.string(),
          day: z.string(),
          year_month: z.string(),
          chain: z.string(),
          is_young_token: z.boolean(),
          intervals: z.record(
            z.string(),
            z.object({
              coverage_percent: z.number(),
              expected_candles: z.number(),
              actual_candles: z.number(),
              has_sufficient_coverage: z.boolean(),
            })
          ),
        })
      ),
      metadata: z.object({
        generated_at: z.string(),
        duckdb_path: z.string(),
        start_month: z.string().nullable().optional(),
        end_month: z.string().nullable().optional(),
        caller_filter: z.string().nullable().optional(),
        total_calls_analyzed: z.number(),
      }),
    });

    const workspaceRoot = findWorkspaceRoot();
    const scriptPath = join(workspaceRoot, 'tools/analysis/ohlcv_detailed_coverage.py');

    // Allow callers to extend the Python coverage timeout via spec, env, or default to 30 minutes
    // Detailed coverage analysis can take longer due to per-call queries
    const coverageTimeoutMs =
      validated.timeoutMs ??
      (Number(process.env.OHLCV_DETAILED_COVERAGE_TIMEOUT_MS) > 0
        ? Number(process.env.OHLCV_DETAILED_COVERAGE_TIMEOUT_MS)
        : 1_800_000); // 30 minutes default

    ctx.logger.info('Running Python coverage analysis script', {
      scriptPath,
      timeoutMs: coverageTimeoutMs,
    });

    // For CSV format, we need to provide an output file path
    // For JSON, the script outputs to stdout and we parse it
    if (validated.format === 'csv') {
      // Generate output file path if not provided
      const outputFile = validated.duckdbPath.replace(/\.duckdb$/, '_detailed_coverage.csv');
      args.output = outputFile;
    }
    // For JSON, don't set output - script will write to stdout

    const result = await ctx.pythonEngine.runScript(scriptPath, args, resultSchema, {
      timeout: coverageTimeoutMs,
    });

    ctx.logger.info('Detailed coverage analysis complete', {
      totalCalls: result.metadata.total_calls_analyzed,
    });

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.logger.error('Detailed coverage analysis failed', { error: errorMessage });
    throw new ValidationError(`Detailed coverage analysis failed: ${errorMessage}`, {
      spec: validated,
    });
  }
}

/**
 * OHLCV Coverage Analysis Workflow
 * ==================================
 *
 * Orchestrates OHLCV coverage analysis:
 * 1. Query ClickHouse for coverage data
 * 2. Generate coverage reports (overall or caller-based)
 * 3. Return structured results
 *
 * This workflow follows the workflow contract:
 * - Validates spec with Zod
 * - Uses WorkflowContext for all dependencies
 * - Returns JSON-serializable results
 * - Explicit error policy (collect vs failFast)
 */

import { z } from 'zod';
import { DateTime } from 'luxon';
import { ValidationError, findWorkspaceRoot } from '@quantbot/infra/utils';
import type { PythonEngine } from '@quantbot/infra/utils';
import { join } from 'path';
import { getCoverageTimeoutMs } from './coverageTimeouts.js';
/**
 * Coverage Analysis Spec
 */
export const AnalyzeCoverageSpecSchema = z.object({
  duckdbPath: z.string().optional(), // Only for caller-based analysis
  analysisType: z.enum(['overall', 'caller']).default('overall'),
  chain: z.string().optional(),
  interval: z.enum(['1m', '5m', '15m', '1h', '1s', '15s']).optional(),
  startDate: z.string().optional(), // YYYY-MM-DD format
  endDate: z.string().optional(),
  startMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(), // For caller analysis
  endMonth: z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional(),
  caller: z.string().optional(), // For caller-specific analysis
  minCoverage: z.number().min(0).max(1).default(0.8), // For caller analysis
  generateFetchPlan: z.boolean().default(false), // For caller analysis
  timeoutMs: z.number().int().positive().optional(), // Timeout in milliseconds
});

export type AnalyzeCoverageSpec = z.infer<typeof AnalyzeCoverageSpecSchema>;

/**
 * Overall Coverage Result
 */
export interface OverallCoverageResult {
  analysisType: 'overall';
  coverage: {
    byChain: Record<
      string,
      {
        totalCandles: number;
        uniqueTokens: number;
        intervals: Record<string, number>;
      }
    >;
    byInterval: Record<
      string,
      {
        totalCandles: number;
        uniqueTokens: number;
        chains: Record<string, number>;
      }
    >;
    byPeriod: {
      daily: Record<string, number>;
      weekly: Record<string, number>;
      monthly: Record<string, number>;
    };
  };
  metadata: {
    startDate?: string;
    endDate?: string;
    chain?: string;
    interval?: string;
    generatedAt: string;
  };
}

/**
 * Caller Coverage Result
 */
export interface CallerCoverageResult {
  analysisType: 'caller';
  callers: string[];
  months: string[];
  matrix: Record<
    string,
    Record<
      string,
      {
        total_calls: number;
        calls_with_coverage: number;
        coverage_ratio: number;
        missing_mints: string[];
      }
    >
  >;
  fetchPlan?: Array<{
    caller: string;
    month: string;
    missing_mints: string[];
    total_calls: number;
    calls_with_coverage: number;
    current_coverage: number;
    priority: number;
  }>;
  metadata: {
    duckdbPath: string;
    interval: string;
    caller?: string;
    startMonth?: string;
    endMonth?: string;
    minCoverage: number;
    generatedAt: string;
  };
}

/**
 * Coverage Analysis Result (union type)
 */
export type AnalyzeCoverageResult = OverallCoverageResult | CallerCoverageResult;

/**
 * Coverage Analysis Context
 */
export type AnalyzeCoverageContext = {
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
 * Analyze overall OHLCV coverage
 */
async function analyzeOverallCoverage(
  pythonEngine: PythonEngine,
  spec: AnalyzeCoverageSpec,
  ctx: AnalyzeCoverageContext
): Promise<OverallCoverageResult> {
  const args: Record<string, unknown> = {
    format: 'json',
  };

  if (spec.chain) args.chain = spec.chain;
  if (spec.interval) args.interval = spec.interval;
  if (spec.startDate) args['start-date'] = spec.startDate;
  if (spec.endDate) args['end-date'] = spec.endDate;

  const resultSchema = z.object({
    coverage: z.object({
      byChain: z.record(
        z.string(),
        z.object({
          totalCandles: z.number(),
          uniqueTokens: z.number(),
          intervals: z.record(z.string(), z.number()),
        })
      ),
      byInterval: z.record(
        z.string(),
        z.object({
          totalCandles: z.number(),
          uniqueTokens: z.number(),
          chains: z.record(z.string(), z.number()),
        })
      ),
      byPeriod: z.object({
        daily: z.record(z.string(), z.number()),
        weekly: z.record(z.string(), z.number()),
        monthly: z.record(z.string(), z.number()),
      }),
    }),
  });

  const workspaceRoot = findWorkspaceRoot();
  const scriptPath = join(workspaceRoot, 'tools/analysis/ohlcv_coverage_map.py');

  // Allow callers to extend the Python coverage timeout via spec, env, or default to 15 minutes
  const coverageTimeoutMs = getCoverageTimeoutMs(spec.timeoutMs);

  // Set PYTHONPATH to include workspace root for tools.shared imports
  const existingPythonPath = process.env.PYTHONPATH || '';
  const pythonPath = existingPythonPath ? `${workspaceRoot}:${existingPythonPath}` : workspaceRoot;

  const result = await pythonEngine.runScript(scriptPath, args, resultSchema, {
    timeout: coverageTimeoutMs,
    env: {
      PYTHONPATH: pythonPath,
    },
  });

  return {
    analysisType: 'overall',
    coverage: result.coverage,
    metadata: {
      startDate: spec.startDate,
      endDate: spec.endDate,
      chain: spec.chain,
      interval: spec.interval,
      generatedAt: ctx.clock.now().toISO()!,
    },
  };
}

/**
 * Analyze caller-based OHLCV coverage
 */
async function analyzeCallerCoverage(
  pythonEngine: PythonEngine,
  spec: AnalyzeCoverageSpec,
  ctx: AnalyzeCoverageContext
): Promise<CallerCoverageResult> {
  if (!spec.duckdbPath) {
    throw new ValidationError('duckdbPath is required for caller-based analysis', { spec });
  }

  const args: Record<string, unknown> = {
    duckdb: spec.duckdbPath,
    interval: spec.interval || '5m',
    format: 'json',
    'min-coverage': spec.minCoverage,
    verbose: true,
  };

  if (spec.startMonth) args['start-month'] = spec.startMonth;
  if (spec.endMonth) args['end-month'] = spec.endMonth;
  if (spec.caller) args.caller = spec.caller;
  if (spec.generateFetchPlan) args['generate-fetch-plan'] = true;

  const resultSchema = z
    .object({
      callers: z.array(z.string()),
      months: z.array(z.string()),
      matrix: z.record(
        z.string(),
        z.record(
          z.string(),
          z.object({
            total_calls: z.number(),
            calls_with_coverage: z.number(),
            coverage_ratio: z.number(),
            missing_mints: z.array(z.string()),
          })
        )
      ),
      fetch_plan: z
        .array(
          z.object({
            caller: z.string(),
            month: z.string(),
            missing_mints: z.array(z.string()),
            total_calls: z.number(),
            calls_with_coverage: z.number(),
            current_coverage: z.number(),
            priority: z.number(),
          })
        )
        .nullable()
        .optional(),
      // Allow extra fields from Python script (interval, metadata)
    })
    .passthrough();

  const workspaceRoot = findWorkspaceRoot();
  const scriptPath = join(workspaceRoot, 'tools/analysis/ohlcv_caller_coverage.py');

  // Allow callers to extend the Python coverage timeout via spec, env, or default to 15 minutes
  const coverageTimeoutMs = getCoverageTimeoutMs(spec.timeoutMs);

  // PYTHONPATH needs to include workspace root so imports like "from tools.shared" work
  const existingPythonPath = process.env.PYTHONPATH || '';
  const pythonPath = existingPythonPath ? `${workspaceRoot}:${existingPythonPath}` : workspaceRoot;

  const result = await pythonEngine.runScript(scriptPath, args, resultSchema, {
    timeout: coverageTimeoutMs,
    env: {
      PYTHONPATH: pythonPath,
    },
  });

  return {
    analysisType: 'caller',
    callers: result.callers,
    months: result.months,
    matrix: result.matrix,
    fetchPlan: result.fetch_plan ?? undefined,
    metadata: {
      duckdbPath: spec.duckdbPath,
      interval: spec.interval || '5m',
      caller: spec.caller,
      startMonth: spec.startMonth,
      endMonth: spec.endMonth,
      minCoverage: spec.minCoverage,
      generatedAt: ctx.clock.now().toISO()!,
    },
  };
}

/**
 * OHLCV Coverage Analysis Workflow
 *
 * Follows workflow contract:
 * - Validates spec (Zod schema)
 * - Uses WorkflowContext (DI) - all dependencies via context
 * - Returns JSON-serializable result (ISO strings, no Date objects)
 * - Explicit error policy (collect vs failFast)
 */
export async function analyzeCoverage(
  spec: AnalyzeCoverageSpec,
  ctx: AnalyzeCoverageContext
): Promise<AnalyzeCoverageResult> {
  // 1. Validate spec
  const parsed = AnalyzeCoverageSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(`Invalid coverage analysis spec: ${msg}`, {
      spec,
      issues: parsed.error.issues,
    });
  }

  const validated = parsed.data;

  ctx.logger.info('Starting OHLCV coverage analysis', {
    analysisType: validated.analysisType,
    spec: validated,
  });

  try {
    if (validated.analysisType === 'overall') {
      ctx.logger.info('Analyzing overall coverage...');
      return await analyzeOverallCoverage(ctx.pythonEngine, validated, ctx);
    } else {
      ctx.logger.info('Analyzing caller-based coverage...');
      return await analyzeCallerCoverage(ctx.pythonEngine, validated, ctx);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.logger.error('Coverage analysis failed', { error: errorMessage });
    throw new ValidationError(`Coverage analysis failed: ${errorMessage}`, { spec: validated });
  }
}

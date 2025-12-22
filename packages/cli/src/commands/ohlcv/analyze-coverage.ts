/**
 * CLI Composition Root for OHLCV Coverage Analysis
 *
 * This is a composition root - it's allowed to:
 * - Read process.env
 * - Use path.resolve()
 * - Do I/O
 */

import type { z } from 'zod';
import path from 'node:path';
import process from 'node:process';
import { logger } from '@quantbot/utils';
import type { CommandContext } from '../../core/command-context.js';
import { analyzeCoverageSchema } from '../../commands/ohlcv.js';
import {
  analyzeCoverage,
  type AnalyzeCoverageSpec,
  type AnalyzeCoverageContext,
} from '@quantbot/workflows';
import { DateTime } from 'luxon';

/**
 * Input arguments (already validated by Zod)
 */
export type AnalyzeCoverageArgs = z.infer<typeof analyzeCoverageSchema>;

/**
 * CLI handler for OHLCV coverage analysis
 *
 * This function can:
 * - Read process.env ✅
 * - Use path.resolve() ✅
 * - Do I/O ✅
 */
export async function analyzeCoverageHandler(args: AnalyzeCoverageArgs, ctx: CommandContext) {
  // Parse args → build spec
  const spec: AnalyzeCoverageSpec = {
    analysisType: args.analysisType,
    chain: args.chain,
    interval: args.interval,
    startDate: args.startDate,
    endDate: args.endDate,
    startMonth: args.startMonth,
    endMonth: args.endMonth,
    caller: args.caller,
    minCoverage: args.minCoverage,
    generateFetchPlan: args.generateFetchPlan,
  };

  // ENV + FS LIVE HERE (composition root)
  // For caller analysis, resolve duckdb path
  if (spec.analysisType === 'caller') {
    const duckdbPathRaw = args.duckdb || process.env.DUCKDB_PATH || 'data/tele.duckdb';
    spec.duckdbPath = path.resolve(duckdbPathRaw);
  }

  // Create workflow context
  const pythonEngine = ctx.services.pythonEngine();

  const workflowContext: AnalyzeCoverageContext = {
    pythonEngine,
    logger: {
      info: (message: string, meta?: Record<string, unknown>) => {
        logger.info(message, { service: 'quantbot', namespace: 'quantbot', ...meta });
      },
      error: (message: string, meta?: Record<string, unknown>) => {
        logger.error(message, { service: 'quantbot', namespace: 'quantbot', ...meta });
      },
      debug: (message: string, meta?: Record<string, unknown>) => {
        logger.debug(message, { service: 'quantbot', namespace: 'quantbot', ...meta });
      },
    },
    clock: {
      now: () => DateTime.utc(),
    },
  };

  // Call workflow (orchestration happens here)
  const result = await analyzeCoverage(spec, workflowContext);

  // Return result (already JSON-serializable from workflow)
  return result;
}

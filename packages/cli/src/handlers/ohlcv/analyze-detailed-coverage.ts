/**
 * CLI Composition Root for Detailed OHLCV Coverage Analysis
 *
 * This is a composition root - it's allowed to:
 * - Read process.env
 * - Use path.resolve()
 * - Do I/O
 */

import type { z } from 'zod';
import path from 'node:path';
import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type { CommandContext } from '../../core/command-context.js';
import { analyzeDetailedCoverageSchema } from '../../commands/ohlcv.js';
import {
  analyzeDetailedCoverage,
  type AnalyzeDetailedCoverageSpec,
  type AnalyzeDetailedCoverageContext,
} from '@quantbot/workflows';

/**
 * Input arguments (already validated by Zod)
 */
export type AnalyzeDetailedCoverageArgs = z.infer<typeof analyzeDetailedCoverageSchema>;

/**
 * CLI handler for detailed OHLCV coverage analysis
 *
 * This function can:
 * - Read process.env ✅
 * - Use path.resolve() ✅
 * - Do I/O ✅
 */
export async function analyzeDetailedCoverageHandler(
  args: AnalyzeDetailedCoverageArgs,
  ctx: CommandContext
) {
  // Parse args → build spec
  const duckdbPathRaw = args.duckdb || process.env.DUCKDB_PATH || 'data/tele.duckdb';
  const spec: AnalyzeDetailedCoverageSpec = {
    duckdbPath: path.resolve(duckdbPathRaw),
    startMonth: args.startMonth,
    endMonth: args.endMonth,
    caller: args.caller,
    format: args.format || 'json',
    limit: args.limit,
    summaryOnly: args.summaryOnly,
    timeoutMs: args.timeout,
  };

  // Create workflow context
  const pythonEngine = ctx.services.pythonEngine();

  const workflowContext: AnalyzeDetailedCoverageContext = {
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
  const result = await analyzeDetailedCoverage(spec, workflowContext);

  // Return result (already JSON-serializable from workflow)
  return result;
}

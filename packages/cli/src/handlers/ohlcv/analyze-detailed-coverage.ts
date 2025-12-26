/**
 * Handler for detailed OHLCV coverage analysis command
 */

import type { z } from 'zod';
import { DateTime } from 'luxon';
import type { CommandContext } from '../../core/command-context.js';
import { analyzeDetailedCoverage } from '@quantbot/workflows';
import type { AnalyzeDetailedCoverageSpec } from '@quantbot/workflows';

export type AnalyzeDetailedCoverageArgs = z.infer<
  typeof import('../../commands/ohlcv.js').analyzeDetailedCoverageSchema
>;

/**
 * Analyze detailed OHLCV coverage
 */
export async function analyzeDetailedCoverageHandler(
  args: AnalyzeDetailedCoverageArgs,
  ctx: CommandContext
) {
  const workflowContext = ctx.services.workflowContext();
  const pythonEngine = ctx.services.pythonEngine();

  const spec: AnalyzeDetailedCoverageSpec = {
    duckdbPath: args.duckdb,
    startMonth: args.startMonth,
    endMonth: args.endMonth,
    caller: args.caller,
    format: args.format || 'json',
    timeoutMs: args.timeout,
  };

  return await analyzeDetailedCoverage(spec, {
    pythonEngine,
    logger: workflowContext.logger,
    clock: {
      now: () => {
        const iso = workflowContext.clock.nowISO();
        return DateTime.fromISO(iso, { zone: 'utc' });
      },
    },
  });
}

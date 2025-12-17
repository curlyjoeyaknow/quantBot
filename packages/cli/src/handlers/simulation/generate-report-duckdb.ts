/**
 * Handler for simulation generate-report command
 *
 * Generates a report from DuckDB simulation data using Python service.
 */

import type { CommandContext } from '../../core/command-context.js';
import { generateReportSchema, type GenerateReportArgs } from '../../command-defs/simulation.js';

export async function generateReportDuckdbHandler(
  args: GenerateReportArgs,
  ctx: CommandContext
): Promise<Record<string, unknown>> {
  const engine = ctx.services.pythonEngine();

  const reportConfig: Record<string, unknown> = {
    type: args.type,
  };

  if (args.strategyId) {
    reportConfig.strategy_id = args.strategyId;
  }

  return await engine.runDuckDBStorage({
    duckdbPath: args.duckdb,
    operation: 'generate_report',
    data: reportConfig,
  });
}


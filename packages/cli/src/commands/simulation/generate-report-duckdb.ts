/**
 * Handler for simulation generate-report command
 *
 * Generates a report from DuckDB simulation data using DuckDBStorageService.
 */

import type { CommandContext } from '../../core/command-context.js';
import type { GenerateReportArgs } from '../../command-defs/simulation.js';

export async function generateReportDuckdbHandler(args: GenerateReportArgs, ctx: CommandContext) {
  const service = ctx.services.duckdbStorage();

  return await service.generateReport(args.duckdb, args.type, args.strategyId);
}

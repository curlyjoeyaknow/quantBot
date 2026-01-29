/**
 * Results Export Handler
 *
 * Export backtest results to files (CSV, JSON, Parquet)
 * Pure handler - depends only on ports, no direct I/O
 */

import type { CommandContext } from '../../core/command-context.js';

export interface ResultsExportArgs {
  runId: string;
  format: 'csv' | 'json' | 'parquet';
  output: string;
  includeTrades?: boolean;
  includeMetrics?: boolean;
}

export async function resultsExportHandler(
  args: ResultsExportArgs,
  ctx: CommandContext
): Promise<Record<string, unknown>> {
  const { runId, format, output, includeTrades = false, includeMetrics = true } = args;

  // Get backtest results port from context
  const resultsPort = ctx.services.backtestResults();

  // Check if port is available
  const isAvailable = await resultsPort.isAvailable();
  if (!isAvailable) {
    throw new Error('Backtest results storage is not available');
  }

  // Export via port
  const result = await resultsPort.exportResults(runId, output, {
    format,
    includeTrades,
    includeMetrics,
  });

  return {
    runId,
    format,
    output: result.outputPath,
    exported: true,
    recordsExported: result.recordsExported,
  };
}

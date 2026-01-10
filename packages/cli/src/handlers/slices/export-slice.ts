/**
 * Export Slice Handler
 *
 * Pure handler that orchestrates slice export and analysis.
 * No I/O, no DB clients - uses adapters from context.
 */

import { exportAndAnalyzeSlice } from '@quantbot/workflows';
import type { CommandContext } from '../../core/command-context.js';
import {
  createClickHouseSliceExporterAdapterImpl,
  createDuckDbSliceAnalyzerAdapterImpl,
} from '@quantbot/storage';
import type { z } from 'zod';
import { exportSliceSchema } from '../../commands/slices.js';

export type ExportSliceArgs = z.infer<typeof exportSliceSchema>;

/**
 * Export slice handler
 */
export async function exportSliceHandler(
  args: ExportSliceArgs,
  ctx: CommandContext
): Promise<unknown> {
  await ctx.ensureInitialized();

  // Generate runId
  const runId = `slice_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

  // Build RunContext
  const run = {
    runId,
    createdAtIso: new Date().toISOString(),
  };

  // Build SliceSpec
  const spec = {
    dataset: args.dataset,
    chain: args.chain,
    timeRange: {
      startIso: args.from,
      endIso: args.to,
    },
    tokenIds: args.tokens ? args.tokens.split(',').map((t) => t.trim()) : undefined,
  };

  // Build ParquetLayoutSpec
  const layout = {
    baseUri: `file://${args.outputDir}`,
    subdirTemplate: '{dataset}/chain={chain}/dt={yyyy}-{mm}-{dd}/run_id={runId}',
  };

  // Build AnalysisSpec
  const analysis = args.analysis
    ? { kind: 'sql' as const, sql: args.analysis }
    : { kind: 'sql' as const, sql: 'SELECT COUNT(*) as total_rows FROM slice' };

  // Create adapters
  const exporter = createClickHouseSliceExporterAdapterImpl();
  const analyzer = createDuckDbSliceAnalyzerAdapterImpl();

  // Call workflow
  const result = await exportAndAnalyzeSlice({
    run,
    spec,
    layout,
    analysis,
    exporter,
    analyzer,
  });

  return result;
}

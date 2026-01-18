/**
 * Export Slices for Alerts Handler
 *
 * Pure handler that exports candle slices for all alerts in a time period.
 */

import type { CommandContext } from '../../core/command-context.js';
import { z } from 'zod';
import { exportSlicesForAlerts } from '@quantbot/workflows';
import type { ExportSlicesForAlertsSpec } from '@quantbot/workflows';
import { createQueryCallsDuckdbContext } from '@quantbot/workflows';
import { ClickHouseSliceExporterAdapterImpl } from '@quantbot/infra/storage';
import { getDuckDBPath } from '@quantbot/infra/utils';

/**
 * Schema for export slices command args
 */
export const exportSlicesForAlertsSchema = z.object({
  from: z.string().describe('Start date (ISO 8601)'),
  to: z.string().describe('End date (ISO 8601)'),
  caller: z.string().optional().describe('Filter by caller name'),
  catalogPath: z.string().optional().default('./catalog').describe('Catalog base path'),
  preWindow: z.number().int().min(0).optional().default(260).describe('Pre-window minutes'),
  postWindow: z.number().int().min(0).optional().default(1440).describe('Post-window minutes'),
  dataset: z
    .enum(['candles_1s', 'candles_15s', 'candles_1m', 'candles_5m', 'indicators_1m'])
    .optional()
    .default('candles_1m')
    .describe('Dataset to export'),
  chain: z.enum(['sol', 'eth', 'base', 'bsc']).optional().default('sol').describe('Chain'),
  duckdb: z.string().optional().describe('DuckDB path'),
  maxAlerts: z.number().int().min(1).max(10000).optional().describe('Maximum alerts to process'),
  useDatePartitioning: z
    .boolean()
    .optional()
    .default(false)
    .describe('Enable date-based partitioning (organize files by date for scalable catalog)'),
  maxRowsPerFile: z
    .number()
    .int()
    .min(1000)
    .max(10000000)
    .optional()
    .describe('Maximum rows per file before chunking (for large daily exports)'),
  maxHoursPerChunk: z
    .number()
    .int()
    .min(1)
    .max(24)
    .optional()
    .default(6)
    .describe('Maximum hours per chunk when chunking within day'),
});

export type ExportSlicesForAlertsArgs = z.infer<typeof exportSlicesForAlertsSchema>;

/**
 * Export slices for alerts handler
 */
export async function exportSlicesForAlertsHandler(
  args: ExportSlicesForAlertsArgs,
  _ctx: CommandContext
): Promise<ReturnType<typeof exportSlicesForAlerts>> {
  // Get DuckDB path
  const duckdbPath = args.duckdb || getDuckDBPath('data/tele.duckdb');

  // Create query context
  const queryContext = await createQueryCallsDuckdbContext(duckdbPath);

  // Create exporter - direct instantiation is acceptable in handlers (composition roots)
  // This is the boundary between infrastructure and application
  const exporter = new ClickHouseSliceExporterAdapterImpl();

  // Create workflow context
  const workflowContext = {
    ...queryContext,
    exporter,
  };

  // Build spec
  const spec: ExportSlicesForAlertsSpec = {
    fromISO: args.from,
    toISO: args.to,
    callerName: args.caller,
    catalogBasePath: args.catalogPath || './catalog',
    preWindowMinutes: args.preWindow || 260,
    postWindowMinutes: args.postWindow || 1440,
    dataset: args.dataset || 'candles_1m',
    chain: args.chain || 'sol',
    duckdbPath,
    maxAlerts: args.maxAlerts,
    useDatePartitioning: args.useDatePartitioning ?? false,
    maxRowsPerFile: args.maxRowsPerFile,
    maxHoursPerChunk: args.maxHoursPerChunk ?? 6,
  };

  // Execute workflow
  return await exportSlicesForAlerts(spec, workflowContext);
}

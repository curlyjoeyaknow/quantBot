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
import { ClickHouseSliceExporterAdapterImpl } from '@quantbot/storage';
import { getDuckDBPath } from '@quantbot/utils';

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
    .enum(['candles_1s', 'candles_15s', 'candles_1m'])
    .optional()
    .default('candles_1m')
    .describe('Dataset to export'),
  chain: z.enum(['sol', 'eth', 'base', 'bsc']).optional().default('sol').describe('Chain'),
  duckdb: z.string().optional().describe('DuckDB path'),
  maxAlerts: z.number().int().min(1).max(10000).optional().describe('Maximum alerts to process'),
});

export type ExportSlicesForAlertsArgs = {
  from: string;
  to: string;
  caller?: string;
  catalogPath?: string;
  preWindow?: number;
  postWindow?: number;
  dataset?: 'candles_1s' | 'candles_15s' | 'candles_1m';
  chain?: 'sol' | 'eth' | 'base' | 'bsc';
  duckdb?: string;
  maxAlerts?: number;
};

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
  };

  // Execute workflow
  return await exportSlicesForAlerts(spec, workflowContext);
}

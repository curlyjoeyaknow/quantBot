/**
 * Export Slices for Alerts Workflow
 *
 * Queries alerts/calls from a time period and exports candle slices
 * for each alert using catalog-compliant paths.
 */

import { z } from 'zod';
import { DateTime } from 'luxon';
import { logger, getDuckDBPath } from '@quantbot/utils';
import type {
  SliceExporter,
  SliceSpec,
  SliceManifestV1,
  ParquetLayoutSpec,
  RunContext,
} from '@quantbot/core';
import { queryCallsDuckdb } from '../calls/queryCallsDuckdb.js';
import type { QueryCallsDuckdbContext } from '../calls/queryCallsDuckdb.js';

/**
 * Export slices spec
 */
export const ExportSlicesForAlertsSpecSchema = z.object({
  /**
   * Time period to query alerts
   */
  fromISO: z.string().datetime(),
  toISO: z.string().datetime(),

  /**
   * Optional: Filter by caller name
   */
  callerName: z.string().optional(),

  /**
   * Catalog base path (default: './catalog')
   */
  catalogBasePath: z.string().default('./catalog'),

  /**
   * Time window for candles (pre/post alert time)
   */
  preWindowMinutes: z.number().int().min(0).default(260), // ~4.3 hours before
  postWindowMinutes: z.number().int().min(0).default(1440), // 24 hours after

  /**
   * Dataset to export (default: candles_1m)
   */
  dataset: z.enum(['candles_1s', 'candles_15s', 'candles_1m']).default('candles_1m'),

  /**
   * Chain (default: sol)
   */
  chain: z.enum(['sol', 'eth', 'base', 'bsc']).default('sol'),

  /**
   * DuckDB path
   */
  duckdbPath: z.string().optional(),

  /**
   * Run ID for catalog organization
   */
  runId: z.string().optional(),

  /**
   * Maximum number of alerts to process (for safety)
   */
  maxAlerts: z.number().int().min(1).max(10000).optional(),
});

export type ExportSlicesForAlertsSpec = z.infer<typeof ExportSlicesForAlertsSpecSchema>;

/**
 * Export result
 */
export type ExportSlicesForAlertsResult = {
  success: boolean;
  runId: string;
  totalAlerts: number;
  processedAlerts: number;
  successfulExports: number;
  failedExports: number;
  exports: Array<{
    callId: string;
    mint: string;
    alertTimestamp: string;
    manifestId?: string;
    success: boolean;
    error?: string;
  }>;
  summary: {
    totalFiles: number;
    totalRows: number;
    totalBytes: number;
  };
};

/**
 * Context for export workflow
 */
export interface ExportSlicesForAlertsContext extends QueryCallsDuckdbContext {
  exporter: SliceExporter;
}

/**
 * Export slices for all alerts in a time period
 */
export async function exportSlicesForAlerts(
  spec: ExportSlicesForAlertsSpec,
  ctx: ExportSlicesForAlertsContext
): Promise<ExportSlicesForAlertsResult> {
  // Validate spec
  const parsed = ExportSlicesForAlertsSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid export spec: ${msg}`);
  }

  const validated = parsed.data;

  // Generate run ID if not provided
  const runId = validated.runId || ctx.ids.newRunId();

  logger.info('[exportSlicesForAlerts] Starting export', {
    runId,
    fromISO: validated.fromISO,
    toISO: validated.toISO,
    callerName: validated.callerName,
    catalogBasePath: validated.catalogBasePath,
  });

  // Query calls/alerts from DuckDB
  const duckdbPath = validated.duckdbPath || getDuckDBPath('data/tele.duckdb');

  const callsResult = await queryCallsDuckdb(
    {
      duckdbPath,
      fromISO: validated.fromISO,
      toISO: validated.toISO,
      callerName: validated.callerName,
      limit: validated.maxAlerts || 10000,
    },
    ctx
  );

  // Handle errors
  if (callsResult.error) {
    throw new Error(`Failed to query calls: ${callsResult.error}`);
  }

  // Handle no calls found - return empty result instead of throwing
  if (!callsResult.calls || callsResult.calls.length === 0) {
    logger.info('[exportSlicesForAlerts] No calls found in time range', {
      runId,
      fromISO: validated.fromISO,
      toISO: validated.toISO,
    });

    return {
      success: true,
      runId,
      totalAlerts: 0,
      processedAlerts: 0,
      successfulExports: 0,
      failedExports: 0,
      exports: [],
      summary: {
        totalFiles: 0,
        totalRows: 0,
        totalBytes: 0,
      },
    };
  }

  const calls = callsResult.calls;
  const totalAlerts = calls.length;

  logger.info('[exportSlicesForAlerts] Found alerts', {
    runId,
    totalAlerts,
  });

  // Process each alert
  const exports: ExportSlicesForAlertsResult['exports'] = [];
  let successfulExports = 0;
  let failedExports = 0;
  let totalFiles = 0;
  let totalRows = 0;
  let totalBytes = 0;

  for (const call of calls) {
    if (!call.mint || !call.createdAt) {
      logger.warn('[exportSlicesForAlerts] Skipping call without mint or timestamp', {
        callId: call.id,
      });
      exports.push({
        callId: call.id,
        mint: call.mint || 'unknown',
        alertTimestamp: call.createdAt?.toISO() || 'unknown',
        success: false,
        error: 'Missing mint or createdAt',
      });
      failedExports++;
      continue;
    }

    try {
      // Calculate time window for this alert
      const alertTime = call.createdAt;
      const windowStart = alertTime.minus({ minutes: validated.preWindowMinutes });
      const windowEnd = alertTime.plus({ minutes: validated.postWindowMinutes });

      // Create slice spec
      const sliceSpec: SliceSpec = {
        dataset: validated.dataset,
        chain: validated.chain,
        timeRange: {
          startIso: windowStart.toISO()!,
          endIso: windowEnd.toISO()!,
        },
        tokenIds: [call.mint],
        granularity: validated.dataset === 'candles_1m' ? '1m' : '1s',
      };

      // Create catalog layout spec (uses catalog paths)
      const layout: ParquetLayoutSpec = {
        baseUri: `file://${validated.catalogBasePath}`,
        subdirTemplate: '{dataset}/chain={chain}', // Catalog layout will override this
        compression: 'zstd',
      };

      // Create run context
      const runContext: RunContext = {
        runId,
        createdAtIso: ctx.clock.nowISO(),
        note: `Export for alert ${call.id}`,
      };

      // Export slice
      const manifest: SliceManifestV1 = await ctx.exporter.exportSlice({
        run: runContext,
        spec: sliceSpec,
        layout,
      });

      // Track success
      successfulExports++;
      totalFiles += manifest.parquetFiles.length;
      totalRows += manifest.summary.totalRows || 0;
      totalBytes += manifest.summary.totalBytes || 0;

      exports.push({
        callId: call.id,
        mint: call.mint,
        alertTimestamp: call.createdAt.toISO()!,
        manifestId: manifest.manifestId,
        success: true,
      });

      logger.info('[exportSlicesForAlerts] Exported slice', {
        runId,
        callId: call.id,
        mint: call.mint,
        manifestId: manifest.manifestId,
        files: manifest.parquetFiles.length,
        rows: manifest.summary.totalRows,
      });
    } catch (error) {
      failedExports++;
      const errorMessage = error instanceof Error ? error.message : String(error);

      exports.push({
        callId: call.id,
        mint: call.mint,
        alertTimestamp: call.createdAt.toISO()!,
        success: false,
        error: errorMessage,
      });

      logger.error('[exportSlicesForAlerts] Failed to export slice', error as Error, {
        runId,
        callId: call.id,
        mint: call.mint,
      });
    }
  }

  logger.info('[exportSlicesForAlerts] Export complete', {
    runId,
    totalAlerts,
    processedAlerts: exports.length,
    successfulExports,
    failedExports,
    totalFiles,
    totalRows,
    totalBytes,
  });

  return {
    success: true,
    runId,
    totalAlerts,
    processedAlerts: exports.length,
    successfulExports,
    failedExports,
    exports,
    summary: {
      totalFiles,
      totalRows,
      totalBytes,
    },
  };
}

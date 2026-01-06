/**
 * Export Slices for Alerts Workflow
 *
 * Queries alerts/calls from a time period and exports candle slices
 * for each alert using catalog-compliant paths.
 */

import { z } from 'zod';
import { DateTime } from 'luxon';
import { logger, getDuckDBPath } from '@quantbot/utils';
import { sanitizeTokenId } from '@quantbot/labcatalog';
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
  dataset: z
    .enum(['candles_1s', 'candles_15s', 'candles_1m', 'candles_5m', 'indicators_1m'])
    .default('candles_1m'),

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

  /**
   * Enable date-based partitioning (organize files by date for scalable catalog)
   */
  useDatePartitioning: z.boolean().default(false),

  /**
   * Maximum rows per file before chunking (for large daily exports)
   */
  maxRowsPerFile: z.number().int().min(1000).max(10000000).optional(),

  /**
   * Maximum hours per chunk when chunking within day (default: 6 hours)
   */
  maxHoursPerChunk: z.number().int().min(1).max(24).default(6),
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

      // Determine if we need to chunk within day
      // Chunking is based on time duration only (not row count)
      const totalHours = windowEnd.diff(windowStart, 'hours').hours;
      const needsChunking = totalHours > validated.maxHoursPerChunk;

      // If chunking is needed, split into time sub-windows
      const timeWindows: Array<{ start: DateTime; end: DateTime }> = [];
      if (needsChunking) {
        const chunkHours = validated.maxHoursPerChunk;
        let currentStart = windowStart;
        while (currentStart < windowEnd) {
          const currentEnd = DateTime.min(currentStart.plus({ hours: chunkHours }), windowEnd);
          timeWindows.push({ start: currentStart, end: currentEnd });
          currentStart = currentEnd;
        }
      } else {
        // Single window
        timeWindows.push({ start: windowStart, end: windowEnd });
      }

      // Export each time window (chunk if needed)
      const chunkManifests: SliceManifestV1[] = [];
      for (const timeWindow of timeWindows) {
        // Create slice spec for this window
        const sliceSpec: SliceSpec = {
          dataset: validated.dataset,
          chain: validated.chain,
          timeRange: {
            startIso: timeWindow.start.toISO()!,
            endIso: timeWindow.end.toISO()!,
          },
          tokenIds: [call.mint],
          granularity: validated.dataset === 'candles_1m' ? '1m' : '1s',
        };

        // Generate complete catalog-compliant subdirectory path
        // The workflow constructs the full path including token, so the adapter
        // can use it directly without modification
        const sanitizedToken = sanitizeTokenId(call.mint);
        let subdirTemplate: string;
        if (validated.useDatePartitioning) {
          // Date-based: data/bars/<date>/<token>
          // Use template variables so the adapter can expand them consistently
          subdirTemplate = `data/bars/{yyyy}-{mm}-{dd}/${sanitizedToken}`;
        } else {
          // Original pattern: data/bars/<token>
          subdirTemplate = `data/bars/${sanitizedToken}`;
        }

        // Create catalog layout spec with date-based partitioning if enabled
        const layout: ParquetLayoutSpec = {
          baseUri: `file://${validated.catalogBasePath}`,
          subdirTemplate,
          compression: 'zstd',
          maxRowsPerFile: validated.maxRowsPerFile,
          partitionKeys: validated.useDatePartitioning
            ? ['dt', 'chain', 'dataset']
            : ['chain', 'dataset'],
        };

        // Create run context
        const runContext: RunContext = {
          runId,
          createdAtIso: ctx.clock.nowISO(),
          note: `Export for alert ${call.id}${timeWindows.length > 1 ? ` (chunk ${timeWindows.indexOf(timeWindow) + 1}/${timeWindows.length})` : ''}`,
        };

        // Export slice
        const manifest: SliceManifestV1 = await ctx.exporter.exportSlice({
          run: runContext,
          spec: sliceSpec,
          layout,
        });

        chunkManifests.push(manifest);
      }

      // Aggregate chunk manifests into a single primary manifest
      // chunkManifests is guaranteed to have at least one element (we just pushed manifests in the loop above)
      if (chunkManifests.length === 0) {
        throw new Error('Internal error: No chunk manifests to aggregate');
      }

      const baseManifest = chunkManifests[0]!;
      const primaryManifest: SliceManifestV1 = {
        version: 1,
        manifestId: `${runId}-${call.id}`, // Create a deterministic ID for the aggregate
        createdAtIso: baseManifest.createdAtIso,
        run: baseManifest.run,
        spec: baseManifest.spec,
        layout: baseManifest.layout,
        parquetFiles: [],
        summary: {
          totalFiles: 0,
          totalRows: 0,
          totalBytes: 0,
        },
        integrity: baseManifest.integrity,
      };

      // Aggregate all chunk data
      for (const m of chunkManifests) {
        primaryManifest.parquetFiles.push(...m.parquetFiles);
        primaryManifest.summary.totalFiles += m.summary.totalFiles;
        primaryManifest.summary.totalRows =
          (primaryManifest.summary.totalRows || 0) + (m.summary.totalRows || 0);
        primaryManifest.summary.totalBytes =
          (primaryManifest.summary.totalBytes || 0) + (m.summary.totalBytes || 0);
      }

      // Track success (aggregate across chunks if chunking was used)
      successfulExports++;
      totalFiles += primaryManifest.summary.totalFiles;
      totalRows += primaryManifest.summary.totalRows || 0;
      totalBytes += primaryManifest.summary.totalBytes || 0;

      exports.push({
        callId: call.id,
        mint: call.mint,
        alertTimestamp: call.createdAt.toISO()!,
        manifestId: primaryManifest.manifestId,
        success: true,
      });

      logger.info('[exportSlicesForAlerts] Exported slice', {
        runId,
        callId: call.id,
        mint: call.mint,
        manifestId: primaryManifest.manifestId,
        files: primaryManifest.summary.totalFiles,
        rows: primaryManifest.summary.totalRows || 0,
        chunks: chunkManifests.length,
        datePartitioning: validated.useDatePartitioning,
      });
    } catch (error) {
      failedExports++;
      // Provide user-friendly error message without exposing internal details
      const errorMessage =
        error instanceof Error
          ? error.message.includes('Query error')
            ? 'Data export query failed. Please check your query parameters and data availability.'
            : error.message.includes('Network error')
              ? 'Network connection failed. Please check your ClickHouse connection.'
              : error.message.includes('timed out')
                ? 'Export operation timed out. The query may be too large.'
                : 'Export operation failed. Please check logs for details.'
          : 'Export operation failed with an unknown error.';

      exports.push({
        callId: call.id,
        mint: call.mint,
        alertTimestamp: call.createdAt.toISO()!,
        success: false,
        error: errorMessage,
      });

      // Log full error details internally (for debugging)
      logger.error('[exportSlicesForAlerts] Failed to export slice', error as Error, {
        runId,
        callId: call.id,
        mint: call.mint,
        // Internal error details for debugging (not exposed to user)
        internalError: error instanceof Error ? error.message : String(error),
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

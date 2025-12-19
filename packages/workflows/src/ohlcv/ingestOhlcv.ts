/**
 * OHLCV Ingestion Workflow
 * =========================
 *
 * Orchestrates OHLCV data ingestion (storage + metadata):
 * 1. Generate worklist from DuckDB (offline work planning)
 * 2. Fetch candles from Birdeye API (online boundary - fetch only)
 * 3. Store candles in ClickHouse (ingestion)
 * 4. Update DuckDB metadata (ingestion)
 * 5. Return structured, serializable results
 *
 * Terminology:
 * - "fetch" = API call to Birdeye (returns candles)
 * - "ingestion" = storing in ClickHouse + updating DuckDB metadata (this workflow)
 *
 * This workflow follows the workflow contract:
 * - Validates spec with Zod
 * - Uses WorkflowContext for all dependencies
 * - Returns JSON-serializable results
 * - Explicit error policy (collect vs failFast)
 */

import { z } from 'zod';
import { DateTime } from 'luxon';
import { ValidationError } from '@quantbot/utils';
import type { WorkflowContext } from '../types.js';
import { generateOhlcvWorklist, type OhlcvWorkItem } from '@quantbot/ingestion';
import { storeCandles as defaultStoreCandles } from '@quantbot/ohlcv';
import { createOhlcvIngestionContext } from '../context/createOhlcvIngestionContext.js';

/**
 * OHLCV Ingestion Spec
 */
export const IngestOhlcvSpecSchema = z.object({
  duckdbPath: z.string().min(1, 'duckdbPath is required'),
  from: z.string().optional(), // ISO date string
  to: z.string().optional(), // ISO date string
  side: z.enum(['buy', 'sell']).optional().default('buy'),
  chain: z.enum(['solana', 'ethereum', 'base', 'bsc']).optional().default('solana'),
  interval: z.enum(['15s', '1m', '5m', '1H']).optional().default('1m'),
  preWindowMinutes: z.number().int().min(0).optional().default(260),
  // Default post-window adjusted to ensure 5000 candles for 1m interval
  // Will be automatically adjusted based on interval in work planning
  postWindowMinutes: z.number().int().min(0).optional().default(4740),
  errorMode: z.enum(['collect', 'failFast']).optional().default('collect'),
  checkCoverage: z.boolean().optional().default(true),
  rateLimitMs: z.number().int().min(0).optional().default(100),
  maxRetries: z.number().int().min(0).optional().default(3),
});

export type IngestOhlcvSpec = z.infer<typeof IngestOhlcvSpecSchema>;

/**
 * OHLCV Ingestion Result (JSON-serializable)
 */
export type IngestOhlcvResult = {
  worklistGenerated: number;
  workItemsProcessed: number;
  workItemsSucceeded: number;
  workItemsFailed: number;
  workItemsSkipped: number;
  totalCandlesFetched: number;
  totalCandlesStored: number;
  errors: Array<{
    mint: string;
    chain: string;
    error: string;
  }>;
  startedAtISO: string;
  completedAtISO: string;
  durationMs: number;
};

/**
 * Extended WorkflowContext for OHLCV ingestion
 */
export type IngestOhlcvContext = WorkflowContext & {
  jobs: {
    /**
     * Fetch candles from Birdeye API (fetch only, no storage)
     */
    ohlcvBirdeyeFetch: {
      fetchWorkList: (worklist: OhlcvWorkItem[]) => Promise<
        Array<{
          workItem: OhlcvWorkItem;
          success: boolean;
          candles: Array<{
            timestamp: number;
            open: number;
            high: number;
            low: number;
            close: number;
            volume: number;
          }>;
          candlesFetched: number;
          skipped: boolean;
          error?: string;
          durationMs: number;
        }>
      >;
    };
  };
  /**
   * DuckDB storage service for updating metadata
   */
  duckdbStorage?: {
    updateOhlcvMetadata: (
      duckdbPath: string,
      mint: string,
      alertTimestamp: string,
      intervalSeconds: number,
      timeRangeStart: string,
      timeRangeEnd: string,
      candleCount: number
    ) => Promise<{ success: boolean; error?: string }>;
  };
  /**
   * Store candles function (can be wrapped for event emission)
   */
  storeCandles?: (
    mint: string,
    chain: string,
    candles: Array<{
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>,
    interval: string
  ) => Promise<void>;
};

/**
 * OHLCV Ingestion Workflow
 *
 * Follows workflow contract:
 * - Validates spec (Zod schema)
 * - Uses WorkflowContext (DI) - all dependencies via context
 * - Returns JSON-serializable result (ISO strings, no Date objects)
 * - Explicit error policy (collect vs failFast)
 * - Default parameter pattern for ctx (for testing convenience)
 *
 * NOTE: ctx is required in production. Default is provided for testing only.
 */
export async function ingestOhlcv(
  spec: IngestOhlcvSpec,
  ctx: IngestOhlcvContext = createOhlcvIngestionContext()
): Promise<IngestOhlcvResult> {
  const startedAt = DateTime.utc();
  const startedAtISO = startedAt.toISO()!;

  // 1. Validate spec
  const parsed = IngestOhlcvSpecSchema.safeParse(spec);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new ValidationError(`Invalid OHLCV ingestion spec: ${msg}`, {
      spec,
      issues: parsed.error.issues,
    });
  }

  const validated = parsed.data;
  const errorMode = validated.errorMode ?? 'collect';

  ctx.logger.info('Starting OHLCV ingestion workflow', {
    duckdbPath: validated.duckdbPath,
    from: validated.from,
    to: validated.to,
    side: validated.side,
    interval: validated.interval,
  });

  // 2. Generate worklist (offline - DuckDB query)
  let worklist: OhlcvWorkItem[];
  try {
    worklist = await generateOhlcvWorklist(validated.duckdbPath, {
      from: validated.from ? new Date(validated.from) : undefined,
      to: validated.to ? new Date(validated.to) : undefined,
      side: validated.side,
      chain: validated.chain,
      interval: validated.interval,
      preWindowMinutes: validated.preWindowMinutes,
      postWindowMinutes: validated.postWindowMinutes,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.logger.error('Failed to generate worklist', { error: errorMessage });
    if (errorMode === 'failFast') {
      throw error;
    }
    return {
      worklistGenerated: 0,
      workItemsProcessed: 0,
      workItemsSucceeded: 0,
      workItemsFailed: 0,
      workItemsSkipped: 0,
      totalCandlesFetched: 0,
      totalCandlesStored: 0,
      errors: [{ mint: 'N/A', chain: validated.chain, error: errorMessage }],
      startedAtISO,
      completedAtISO: DateTime.utc().toISO()!,
      durationMs: DateTime.utc().diff(startedAt, 'milliseconds').milliseconds,
    };
  }

  if (worklist.length === 0) {
    ctx.logger.info('No work items to process');
    return {
      worklistGenerated: 0,
      workItemsProcessed: 0,
      workItemsSucceeded: 0,
      workItemsFailed: 0,
      workItemsSkipped: 0,
      totalCandlesFetched: 0,
      totalCandlesStored: 0,
      errors: [],
      startedAtISO,
      completedAtISO: DateTime.utc().toISO()!,
      durationMs: DateTime.utc().diff(startedAt, 'milliseconds').milliseconds,
    };
  }

  // 3. Fetch candles from Birdeye (fetch only, no storage)
  let fetchResults: Array<{
    workItem: OhlcvWorkItem;
    success: boolean;
    candles: Array<{
      timestamp: number;
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
    }>;
    candlesFetched: number;
    skipped: boolean;
    error?: string;
    durationMs: number;
  }>;

  try {
    fetchResults = await ctx.jobs.ohlcvBirdeyeFetch.fetchWorkList(worklist);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    ctx.logger.error('Failed to fetch OHLCV data from Birdeye', { error: errorMessage });
    if (errorMode === 'failFast') {
      throw error;
    }
    // Return partial results
    fetchResults = worklist.map((item) => ({
      workItem: item,
      success: false,
      candles: [],
      candlesFetched: 0,
      skipped: false,
      error: errorMessage,
      durationMs: 0,
    }));
  }

  // 4. Store candles in ClickHouse (ingestion)
  const ingestionResults: Array<{
    workItem: OhlcvWorkItem;
    success: boolean;
    candlesFetched: number;
    candlesStored: number;
    skipped: boolean;
    error?: string;
  }> = [];

  for (const fetchResult of fetchResults) {
    if (!fetchResult.success || fetchResult.skipped) {
      ingestionResults.push({
        workItem: fetchResult.workItem,
        success: fetchResult.success,
        candlesFetched: fetchResult.candlesFetched,
        candlesStored: 0,
        skipped: fetchResult.skipped,
        error: fetchResult.error,
      });
      continue;
    }

    try {
      // Store candles in ClickHouse (ingestion)
      const storeFn = ctx.storeCandles || defaultStoreCandles;
      await storeFn(
        fetchResult.workItem.mint,
        fetchResult.workItem.chain,
        fetchResult.candles,
        fetchResult.workItem.interval
      );

      // Update DuckDB metadata (ingestion)
      if (ctx.duckdbStorage && fetchResult.workItem.alertTime) {
        const intervalSeconds = {
          '15s': 15,
          '1m': 60,
          '5m': 300,
          '1H': 3600,
        }[fetchResult.workItem.interval];

        await ctx.duckdbStorage.updateOhlcvMetadata(
          validated.duckdbPath,
          fetchResult.workItem.mint,
          fetchResult.workItem.alertTime.toISO()!,
          intervalSeconds,
          fetchResult.workItem.startTime.toISO()!,
          fetchResult.workItem.endTime.toISO()!,
          fetchResult.candles.length
        );
      }

      ingestionResults.push({
        workItem: fetchResult.workItem,
        success: true,
        candlesFetched: fetchResult.candlesFetched,
        candlesStored: fetchResult.candles.length,
        skipped: false,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      ctx.logger.error('Failed to store OHLCV candles', {
        error: error instanceof Error ? error.message : String(error),
        mint: fetchResult.workItem.mint.substring(0, 20),
      });
      ingestionResults.push({
        workItem: fetchResult.workItem,
        success: false,
        candlesFetched: fetchResult.candlesFetched,
        candlesStored: 0,
        skipped: false,
        error: errorMessage,
      });
    }
  }

  // 5. Aggregate results (JSON-serializable)
  const workItemsSucceeded = ingestionResults.filter((r) => r.success).length;
  const workItemsFailed = ingestionResults.filter((r) => !r.success).length;
  const workItemsSkipped = ingestionResults.filter((r) => r.skipped).length;
  const totalCandlesFetched = ingestionResults.reduce((sum, r) => sum + r.candlesFetched, 0);
  const totalCandlesStored = ingestionResults.reduce((sum, r) => sum + r.candlesStored, 0);

  const errors = ingestionResults
    .filter((r: any) => !r.success && r.error)
    .map((r: any) => ({
      mint: r.workItem.mint,
      chain: r.workItem.chain,
      error: r.error!,
    }));

  const completedAt = DateTime.utc();
  const completedAtISO = completedAt.toISO()!;
  const durationMs = completedAt.diff(startedAt, 'milliseconds').milliseconds;

  ctx.logger.info('Completed OHLCV ingestion workflow', {
    worklistGenerated: worklist.length,
    workItemsProcessed: ingestionResults.length,
    workItemsSucceeded,
    workItemsFailed,
    workItemsSkipped,
    totalCandlesFetched,
    totalCandlesStored,
  });

  return {
    worklistGenerated: worklist.length,
    workItemsProcessed: ingestionResults.length,
    workItemsSucceeded,
    workItemsFailed,
    workItemsSkipped,
    totalCandlesFetched,
    totalCandlesStored,
    errors,
    startedAtISO,
    completedAtISO,
    durationMs,
  };
}

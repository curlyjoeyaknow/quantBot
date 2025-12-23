/**
 * OHLCV Ingestion Workflow
 * =========================
 *
 * Control-plane workflow: Orchestrates OHLCV data ingestion using ports.
 *
 * Architecture (Ports & Adapters):
 * - Workflow (this file): Uses ctx.ports.* for all external dependencies
 *   - ctx.ports.marketData.fetchOhlcv() for fetching candles
 *   - ctx.ports.state.get/set() for idempotency checks
 *   - ctx.ports.telemetry.emitEvent/emitMetric() for observability
 *   - storeCandles() from @quantbot/ohlcv for storage (public API)
 *
 * Flow:
 * 1. Generate worklist from DuckDB (offline work planning)
 * 2. For each work item:
 *    - Check idempotency via ctx.ports.state
 *    - Optional: Check coverage to skip unnecessary fetches
 *    - Fetch candles via ctx.ports.marketData.fetchOhlcv()
 *    - Store candles via storeCandles() (ClickHouse)
 *    - Mark as processed via ctx.ports.state
 *    - Emit telemetry events/metrics
 * 3. Batch update DuckDB metadata (ingestion bookkeeping)
 * 4. Return structured, serializable results
 *
 * Terminology:
 * - "fetch" = API call via market data port (online boundary)
 * - "store" = Upsert to ClickHouse (storage layer, idempotent)
 * - "ingestion" = Workflow orchestration + metadata updates (this file)
 *
 * Why ports:
 * - Workflow is testable with stubbed ports (no real I/O)
 * - Easy to swap providers (Birdeye → Helius) without changing workflow
 * - Clear boundaries: ports define contracts, adapters implement them
 * - No direct imports from @quantbot/api-clients or @quantbot/storage/src
 *
 * This workflow follows the workflow contract:
 * - Validates spec with Zod
 * - Uses WorkflowContextWithPorts for all dependencies
 * - Returns JSON-serializable results
 * - Explicit error policy (collect vs failFast)
 */

import { z } from 'zod';
import { DateTime } from 'luxon';
import { ValidationError, AppError } from '@quantbot/utils';
import type { WorkflowContextWithPorts } from '../context/workflowContextWithPorts.js';
import { generateOhlcvWorklist, type OhlcvWorkItem } from '@quantbot/ingestion';
import { storeCandles } from '@quantbot/ohlcv';
import { getCoverage } from '@quantbot/ohlcv';
import { createOhlcvIngestionContext } from '../context/createOhlcvIngestionContext.js';
import { Candle, createTokenAddress } from '@quantbot/core';

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
  mints: z.array(z.string()).optional(), // Optional filter: only fetch OHLCV for these specific mints
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
 * Uses ports for all external dependencies (no raw clients)
 */
export type IngestOhlcvContext = WorkflowContextWithPorts & {
  logger: {
    info: (message: string, context?: unknown) => void;
    warn: (message: string, context?: unknown) => void;
    error: (message: string, context?: unknown) => void;
    debug?: (message: string, context?: unknown) => void;
  };
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
  ctx?: IngestOhlcvContext
): Promise<IngestOhlcvResult> {
  // Default context for testing (only if not provided)
  const workflowCtx: IngestOhlcvContext = ctx ?? (await createOhlcvIngestionContext());
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

  // Emit workflow start event
  workflowCtx.ports?.telemetry.emitEvent({
    name: 'ohlcv_ingestion_started',
    level: 'info',
    message: 'Starting OHLCV ingestion workflow',
    context: {
      duckdbPath: validated.duckdbPath,
      from: validated.from,
      to: validated.to,
      side: validated.side,
      interval: validated.interval,
    },
  });

  workflowCtx.logger.info('Starting OHLCV ingestion workflow', {
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
      mints: validated.mints, // Pass mint filter to DuckDB query
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    workflowCtx.logger.error('Failed to generate worklist', { error: errorMessage });
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
    workflowCtx.logger.info('No work items to process');
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

  // 3. Fetch and store candles using ports
  // Process work items: fetch from market data port → store in ClickHouse
  const fetchResults: Array<{
    workItem: OhlcvWorkItem;
    success: boolean;
    candlesFetched: number;
    candlesStored: number;
    error?: string;
    durationMs: number;
  }> = [];

  // Process work items with rate limiting
  const rateLimitMs = validated.rateLimitMs ?? 100;
  const maxRetries = validated.maxRetries ?? 3;
  let failureCount = 0;
  const circuitBreakerThreshold = 10;

  for (let i = 0; i < worklist.length; i++) {
    const workItem = worklist[i];
    if (!workItem) continue; // Skip undefined items (shouldn't happen, but TypeScript safety)
    const startTime = workflowCtx.ports.clock.nowMs();

    // Rate limiting
    if (i > 0) {
      await new Promise((resolve) => setTimeout(resolve, rateLimitMs));
    }

    // Circuit breaker check
    if (failureCount >= circuitBreakerThreshold) {
      workflowCtx.ports?.telemetry.emitEvent({
        name: 'ohlcv_ingestion_circuit_breaker_open',
        level: 'warn',
        message: 'Circuit breaker open - too many failures',
        context: {
          failureCount,
          threshold: circuitBreakerThreshold,
        },
      });

      fetchResults.push({
        workItem,
        success: false,
        candlesFetched: 0,
        candlesStored: 0,
        error: 'Circuit breaker open',
        durationMs: workflowCtx.ports?.clock.nowMs() - startTime,
      });
      continue;
    }

    // Check idempotency: have we processed this mint for this day?
    const dayKey = `${workItem.mint}:${workItem.startTime.toISODate()}:${workItem.interval}`;
    const idempotencyCheck = await workflowCtx.ports?.state.get({
      key: dayKey,
      namespace: 'ohlcv_ingestion',
    });

    if (idempotencyCheck.found) {
      workflowCtx.ports?.telemetry.emitEvent({
        name: 'ohlcv_ingestion_skipped',
        level: 'debug',
        message: 'Skipping already processed work item',
        context: {
          mint: workItem.mint.substring(0, 20),
          day: workItem.startTime.toISODate(),
        },
      });

      fetchResults.push({
        workItem,
        success: true,
        candlesFetched: 0,
        candlesStored: 0,
        durationMs: workflowCtx.ports?.clock.nowMs() - startTime,
      });
      continue;
    }

    // Optional: Check coverage before fetching
    if (validated.checkCoverage) {
      try {
        const coverage = await getCoverage(
          workItem.mint,
          workItem.chain,
          workItem.startTime.toJSDate(),
          workItem.endTime.toJSDate(),
          workItem.interval
        );

        if (coverage.hasData && coverage.coverageRatio >= 0.95) {
          workflowCtx.ports?.telemetry.emitEvent({
            name: 'ohlcv_ingestion_coverage_skip',
            level: 'debug',
            message: 'Skipping fetch - sufficient coverage exists',
            context: {
              mint: workItem.mint.substring(0, 20),
              coverageRatio: coverage.coverageRatio,
            },
          });

          fetchResults.push({
            workItem,
            success: true,
            candlesFetched: 0,
            candlesStored: 0,
            durationMs: workflowCtx.ports?.clock.nowMs() - startTime,
          });
          continue;
        }
      } catch (error) {
        // Coverage check failure is not fatal, continue with fetch
        if (workflowCtx.logger?.debug) {
          workflowCtx.logger.debug(
            `Coverage check failed, continuing with fetch: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }
    }

    // Fetch candles using market data port
    let candles: Candle[] = [];
    let fetchError: string | undefined;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const from = Math.floor(workItem.startTime.toSeconds());
        const to = Math.floor(workItem.endTime.toSeconds());

        candles = await workflowCtx.ports.marketData.fetchOhlcv({
          tokenAddress: createTokenAddress(workItem.mint),
          chain: workItem.chain,
          interval: workItem.interval,
          from,
          to,
        });

        // Emit metric for candles fetched
        workflowCtx.ports?.telemetry.emitMetric({
          name: 'ohlcv_candles_fetched',
          type: 'counter',
          value: candles.length,
          labels: {
            chain: workItem.chain,
            interval: workItem.interval,
          },
        });

        break; // Success, exit retry loop
      } catch (error) {
        fetchError = error instanceof Error ? error.message : String(error);
        if (attempt < maxRetries - 1) {
          // Wait before retry (exponential backoff)
          await new Promise((resolve) => setTimeout(resolve, rateLimitMs * (attempt + 1)));
        }
      }
    }

    if (fetchError || candles.length === 0) {
      failureCount++;
      workflowCtx.ports?.telemetry.emitEvent({
        name: 'ohlcv_ingestion_fetch_failed',
        level: 'error',
        message: 'Failed to fetch OHLCV candles',
        context: {
          mint: workItem.mint.substring(0, 20),
          chain: workItem.chain,
          error: fetchError || 'No candles returned',
        },
      });

      if (errorMode === 'failFast') {
        throw new AppError(
          fetchError || 'Failed to fetch OHLCV candles',
          'OHLCV_FETCH_FAILED',
          500,
          {
            workItem,
            fetchError,
          }
        );
      }

      fetchResults.push({
        workItem,
        success: false,
        candlesFetched: 0,
        candlesStored: 0,
        error: fetchError || 'No candles returned',
        durationMs: workflowCtx.ports?.clock.nowMs() - startTime,
      });
      continue;
    }

    // Store candles in ClickHouse
    let candlesStored = 0;
    try {
      await storeCandles(workItem.mint, workItem.chain, candles, workItem.interval);
      candlesStored = candles.length;

      // Mark as processed for idempotency
      await workflowCtx.ports?.state.set({
        key: dayKey,
        namespace: 'ohlcv_ingestion',
        value: { processed: true, timestamp: workflowCtx.ports?.clock.nowMs() },
        ttlSeconds: 86400 * 7, // 7 days TTL
      });

      // Emit metric for candles stored
      workflowCtx.ports?.telemetry.emitMetric({
        name: 'ohlcv_candles_stored',
        type: 'counter',
        value: candlesStored,
        labels: {
          chain: workItem.chain,
          interval: workItem.interval,
        },
      });

      // Reset failure count on success
      failureCount = 0;
    } catch (error) {
      const storeError = error instanceof Error ? error.message : String(error);
      workflowCtx.ports?.telemetry.emitEvent({
        name: 'ohlcv_ingestion_store_failed',
        level: 'error',
        message: 'Failed to store OHLCV candles',
        context: {
          mint: workItem.mint.substring(0, 20),
          error: storeError,
        },
      });

      if (errorMode === 'failFast') {
        throw error;
      }

      fetchResults.push({
        workItem,
        success: false,
        candlesFetched: candles.length,
        candlesStored: 0,
        error: storeError,
        durationMs: workflowCtx.ports?.clock.nowMs() - startTime,
      });
      continue;
    }

    fetchResults.push({
      workItem,
      success: true,
      candlesFetched: candles.length,
      candlesStored,
      durationMs: workflowCtx.ports?.clock.nowMs() - startTime,
    });

    // Progress logging every 10 items
    if ((i + 1) % 10 === 0) {
      const successCount = fetchResults.filter((r) => r.success).length;
      workflowCtx.logger.info(`Progress: ${i + 1}/${worklist.length} (${successCount} successful)`);
    }
  }

  // 4. Batch update DuckDB metadata (control-plane bookkeeping)
  // Metadata updates are fast (DuckDB is local), so we can do them in parallel batches
  const ingestionResults: Array<{
    workItem: OhlcvWorkItem;
    success: boolean;
    candlesFetched: number;
    candlesStored: number;
    skipped: boolean;
    error?: string;
  }> = [];

  // Batch metadata updates (process in parallel batches to avoid overwhelming DuckDB)
  const metadataUpdates: Array<Promise<void>> = [];
  const METADATA_BATCH_SIZE = 10; // Process metadata updates in batches of 10

  for (const fetchResult of fetchResults) {
    if (!fetchResult.success) {
      ingestionResults.push({
        workItem: fetchResult.workItem,
        success: false,
        candlesFetched: fetchResult.candlesFetched,
        candlesStored: fetchResult.candlesStored,
        skipped: false,
        error: fetchResult.error,
      });
      continue;
    }

    // Store metadata using StatePort (replaces duckdbStorage.updateOhlcvMetadata)
    if (fetchResult.workItem.alertTime) {
      const intervalSeconds = {
        '15s': 15,
        '1m': 60,
        '5m': 300,
        '1H': 3600,
      }[fetchResult.workItem.interval];

      const metadataKey = `ohlcv_metadata:${fetchResult.workItem.mint}:${fetchResult.workItem.alertTime.toISO()}`;
      const updatePromise = workflowCtx.ports?.state
        .set({
          key: metadataKey,
          namespace: 'ohlcv_metadata',
          value: {
            mint: fetchResult.workItem.mint,
            alertTimestamp: fetchResult.workItem.alertTime.toISO(),
            intervalSeconds,
            timeRangeStart: fetchResult.workItem.startTime.toISO(),
            timeRangeEnd: fetchResult.workItem.endTime.toISO(),
            candleCount: fetchResult.candlesStored,
            updatedAt: DateTime.utc().toISO(),
          },
        })
        .then((result) => {
          if (!result.success) {
            workflowCtx.ports?.telemetry.emitEvent({
              name: 'ohlcv_metadata_update_failed',
              level: 'error',
              message: 'Failed to update OHLCV metadata',
              context: {
                mint: fetchResult.workItem.mint.substring(0, 20),
                error: result.error,
              },
            });
          }
        })
        .catch((error) => {
          const errorMessage = error instanceof Error ? error.message : String(error);
          workflowCtx.ports?.telemetry.emitEvent({
            name: 'ohlcv_metadata_update_error',
            level: 'error',
            message: 'Failed to update OHLCV metadata',
            context: {
              mint: fetchResult.workItem.mint.substring(0, 20),
              error: errorMessage,
            },
          });
          // Metadata update failure doesn't fail the work item (candles were stored)
        })
        .then(() => undefined); // Ensure Promise<void>

      metadataUpdates.push(updatePromise);
    }

    // Add successful result (metadata update happens async)
    ingestionResults.push({
      workItem: fetchResult.workItem,
      success: true,
      candlesFetched: fetchResult.candlesFetched,
      candlesStored: fetchResult.candlesStored,
      skipped: false,
    });
  }

  // Execute metadata updates in batches
  if (metadataUpdates.length > 0) {
    workflowCtx.logger.info(`Executing ${metadataUpdates.length} metadata updates in batches`);
    for (let i = 0; i < metadataUpdates.length; i += METADATA_BATCH_SIZE) {
      const batch = metadataUpdates.slice(i, i + METADATA_BATCH_SIZE);
      await Promise.all(batch);
    }
  }

  // 5. Aggregate results (JSON-serializable)
  const workItemsSucceeded = ingestionResults.filter((r) => r.success).length;
  const workItemsFailed = ingestionResults.filter((r) => !r.success).length;
  const workItemsSkipped = ingestionResults.filter((r) => r.skipped).length;
  const totalCandlesFetched = ingestionResults.reduce((sum, r) => sum + r.candlesFetched, 0);
  const totalCandlesStored = ingestionResults.reduce((sum, r) => sum + r.candlesStored, 0);

  const errors = ingestionResults
    .filter((r) => !r.success && r.error)
    .map((r) => ({
      mint: r.workItem.mint,
      chain: r.workItem.chain,
      error: typeof r.error === 'string' ? r.error : String(r.error || 'Unknown error'),
    }));

  const completedAt = DateTime.utc();
  const completedAtISO = completedAt.toISO()!;
  const durationMs = completedAt.diff(startedAt, 'milliseconds').milliseconds;

  // Emit workflow completion event
  workflowCtx.ports?.telemetry.emitEvent({
    name: 'ohlcv_ingestion_completed',
    level: 'info',
    message: 'Completed OHLCV ingestion workflow',
    context: {
      worklistGenerated: worklist.length,
      workItemsProcessed: ingestionResults.length,
      workItemsSucceeded,
      workItemsFailed,
      workItemsSkipped,
      totalCandlesFetched,
      totalCandlesStored,
      durationMs,
    },
  });

  // Emit summary metrics
  workflowCtx.ports?.telemetry.emitMetric({
    name: 'ohlcv_ingestion_work_items_total',
    type: 'counter',
    value: ingestionResults.length,
    timestamp: workflowCtx.ports?.clock.nowMs(),
  });

  workflowCtx.ports.telemetry.emitMetric({
    name: 'ohlcv_ingestion_work_items_succeeded',
    type: 'counter',
    value: workItemsSucceeded,
    timestamp: workflowCtx.ports.clock.nowMs(),
  });

  workflowCtx.ports.telemetry.emitMetric({
    name: 'ohlcv_ingestion_work_items_failed',
    type: 'counter',
    value: workItemsFailed,
    timestamp: workflowCtx.ports.clock.nowMs(),
  });

  workflowCtx.ports.telemetry.emitMetric({
    name: 'ohlcv_ingestion_duration_ms',
    type: 'histogram',
    value: durationMs,
    timestamp: workflowCtx.ports.clock.nowMs(),
  });

  workflowCtx.logger.info('Completed OHLCV ingestion workflow', {
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

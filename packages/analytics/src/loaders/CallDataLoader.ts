/**
 * Call Data Loader
 * ================
 * Loads call performance data from Postgres and enriches with ATH data.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import { StorageEngine } from '@quantbot/storage';
// PostgreSQL removed - use DuckDB workflows instead
import { queryCallsDuckdb, type QueryCallsDuckdbSpec, type WorkflowContext } from '@quantbot/workflows';
import { createProductionContext } from '@quantbot/workflows';
import type { CallPerformance } from '../types';
import { calculateAthFromCandleObjects } from '../utils/ath-calculator';

export interface LoadCallsOptions {
  from?: Date;
  to?: Date;
  callerNames?: string[];
  chains?: string[];
  limit?: number;
}

/**
 * Call Data Loader - Production-ready data loading
 */
export class CallDataLoader {
  /**
   * Load calls from DuckDB (via workflows)
   */
  async loadCalls(options: LoadCallsOptions = {}): Promise<CallPerformance[]> {
    // Use queryCallsDuckdb workflow to query calls
    const duckdbPath = process.env.DUCKDB_PATH || 'data/quantbot.db';
    const fromISO = options.from
      ? DateTime.fromJSDate(options.from).toISO()!
      : DateTime.utc().minus({ days: 30 }).toISO()!;
    const toISO = options.to ? DateTime.fromJSDate(options.to).toISO()! : DateTime.utc().toISO()!;

    const spec: QueryCallsDuckdbSpec = {
      duckdbPath,
      fromISO,
      toISO,
      callerName: options.callerNames?.[0], // Use first caller name if provided
      limit: options.limit || 1000,
    };

    const ctx = createProductionContext();
    const workflowCtx = {
      ...ctx,
      services: {
        ...ctx.services,
        duckdbStorage: {
          queryCalls: async (path: string, limit: number) => {
            // Get DuckDBStorageService from context
            const { DuckDBStorageService } = await import('@quantbot/simulation');
            const { PythonEngine } = await import('@quantbot/utils');
            const storage = new DuckDBStorageService(new PythonEngine());
            return await storage.queryCalls(path, limit);
          },
        },
      },
    } as WorkflowContext;

    try {
      const result = await queryCallsDuckdb(spec, workflowCtx);

      // Convert CallRecord[] to CallPerformance[]
      // Note: CallPerformance requires more fields than CallRecord provides
      // We'll need to enrich with additional data or adjust the type
      const callPerformance: CallPerformance[] = result.calls.map((call, index) => ({
        callId: index + 1, // Generate ID since we don't have numeric ID from DuckDB
        tokenAddress: call.mint,
        callerName: call.caller,
        chain: 'solana', // Default to solana, could be enriched later
        alertTimestamp: call.createdAt.toJSDate(),
        entryPrice: 0, // Will need to be enriched from alerts table or OHLCV
        athPrice: 0, // Will need to be enriched
        athMultiple: 1, // Default, will be enriched
        timeToAthMinutes: 0, // Will need to be enriched
        atlPrice: 0, // Will need to be enriched
        atlMultiple: 1, // Default, will be enriched
      }));

      logger.info(`[CallDataLoader] Loaded ${callPerformance.length} calls from DuckDB`, {
        fromISO,
        toISO,
        callerName: options.callerNames?.[0],
      });

      return callPerformance;
    } catch (error) {
      logger.error('[CallDataLoader] Failed to load calls from DuckDB', {
        error: error instanceof Error ? error.message : String(error),
        options,
      });
      return [];
    }
  }

  /**
   * Enrich calls with ATH data from OHLCV cache
   * NOTE: This is now primarily a fallback - ATH/ATL should already be calculated
   * during OHLCV ingestion and stored in the alerts table. This method only
   * recalculates for calls that don't have ATH/ATL data yet.
   */
  async enrichWithAth(calls: CallPerformance[]): Promise<CallPerformance[]> {
    if (calls.length === 0) {
      return calls;
    }

    // Filter to only calls that need enrichment (athMultiple === 1 means not enriched)
    const needsEnrichment = calls.filter((c) => c.athMultiple === 1 && c.athPrice === c.entryPrice);

    if (needsEnrichment.length === 0) {
      logger.debug(
        `[CallDataLoader] All ${calls.length} calls already have ATH/ATL data from alerts table`
      );
      return calls;
    }

    logger.info(
      `[CallDataLoader] Enriching ${needsEnrichment.length} calls with ATH data (fallback calculation)`
    );
    const storageEngine = getStorageEngine();
    const enriched: CallPerformance[] = [];
    let enrichedCount = 0;
    let skippedCount = 0;

    // Process in batches of 10 to avoid overwhelming the database
    const batchSize = 10;
    for (let i = 0; i < calls.length; i += batchSize) {
      const batch = calls.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map((call) => {
          // Only enrich if not already enriched
          if (call.athMultiple !== 1 || call.athPrice !== call.entryPrice) {
            return Promise.resolve(call); // Already enriched, return as-is
          }
          return this.enrichSingleCall(call, storageEngine);
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          enriched.push(result.value);
          enrichedCount++;
        } else {
          // If enrichment failed, keep the original call
          const originalCall = batch[results.indexOf(result)];
          if (originalCall) {
            enriched.push(originalCall);
            skippedCount++;
          }
        }
      }
    }

    logger.info(
      `[CallDataLoader] Enriched ${enrichedCount} calls, skipped ${skippedCount} (no data or errors)`
    );
    return enriched;
  }

  /**
   * Enrich a single call with ATH data
   */
  private async enrichSingleCall(
    call: CallPerformance,
    storageEngine: ReturnType<typeof getStorageEngine>
  ): Promise<CallPerformance | null> {
    try {
      const alertTime = DateTime.fromJSDate(call.alertTimestamp);
      const entryTimestamp = Math.floor(alertTime.toSeconds());

      // Fetch candles from alert time forward (up to 30 days)
      const endTime = alertTime.plus({ days: 30 });

      // Try 5m candles first (more accurate), fallback to 1m if available
      let candles = await storageEngine.getCandles(
        call.tokenAddress,
        call.chain,
        alertTime,
        endTime,
        { interval: '5m', useCache: true }
      );

      // If no 5m candles, try 1m
      if (candles.length === 0) {
        candles = await storageEngine.getCandles(
          call.tokenAddress,
          call.chain,
          alertTime,
          endTime,
          { interval: '1m', useCache: true }
        );
      }

      // If still no candles, skip enrichment
      if (candles.length === 0) {
        logger.debug(
          `[CallDataLoader] No candles found for ${call.tokenAddress.substring(0, 20)}...`
        );
        return call;
      }

      // Calculate ATH
      const athResult = calculateAthFromCandleObjects(call.entryPrice, entryTimestamp, candles);

      // Update call with ATH and ATL data
      return {
        ...call,
        athPrice: athResult.athPrice,
        athMultiple: athResult.athMultiple,
        timeToAthMinutes: athResult.timeToAthMinutes,
        atlPrice: athResult.atlPrice,
        atlTimestamp: athResult.atlTimestamp ? new Date(athResult.atlTimestamp * 1000) : undefined,
        atlMultiple: athResult.atlMultiple,
      };
    } catch (error: unknown) {
      logger.warn(`[CallDataLoader] Failed to enrich call ${call.callId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      // Return original call on error
      return call;
    }
  }
}

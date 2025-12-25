/**
 * Call Data Loader
 * ================
 * Loads call performance data from Postgres and enriches with ATH data.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import { StorageEngine, getStorageEngine } from '@quantbot/storage';
import type { CallPerformance } from '../types.js';
import { calculateAthFromCandleObjects } from '../utils/ath-calculator.js';
import { loadHistoricalPricesBatch } from './HistoricalPriceLoader.js';
// Dynamic import to avoid build-time dependency on workflows
// Types will be imported at runtime

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
    // Default to tele.duckdb which contains user_calls_d table
    const { getDuckDBPath } = await import('@quantbot/utils');
    const duckdbPath = getDuckDBPath('data/tele.duckdb');
    // Use a wide date range by default to get all calls (last 5 years)
    // Only restrict if explicitly provided
    const fromISO = options.from
      ? DateTime.fromJSDate(options.from).toISO()!
      : DateTime.utc().minus({ years: 5 }).toISO()!; // Wide range to get all calls
    const toISO = options.to ? DateTime.fromJSDate(options.to).toISO()! : DateTime.utc().toISO()!;

    try {
      // Import workflow and context factory (dynamic import to avoid build-time dependency)
      // Note: This avoids a build-order violation (analytics builds before workflows)
      const workflowsModule = await import('@quantbot/workflows');
      const { queryCallsDuckdb, createQueryCallsDuckdbContext } = workflowsModule;

      // Build spec object matching QueryCallsDuckdbSpec structure
      // Using explicit types to avoid requiring workflows types at build time
      const spec = {
        duckdbPath,
        fromISO,
        toISO,
        callerName: options.callerNames?.[0], // Use first caller name if provided
        limit: options.limit || 10000, // Increased limit to handle more calls (was 1000)
      };

      const ctx = await createQueryCallsDuckdbContext(duckdbPath);
      // Type assertion: spec matches QueryCallsDuckdbSpec from workflows package
      // Using unknown then casting to avoid requiring workflows types at build time
      // This is safe because we've constructed the object to match the expected shape
      const result = await queryCallsDuckdb(
        spec as unknown as Parameters<typeof queryCallsDuckdb>[0],
        ctx
      );

      // Check if query failed with a helpful error message
      if (result.calls.length === 0 && result.totalQueried === 0) {
        // Type assertion: result has error property (optional) from QueryCallsDuckdbResult
        const resultWithError = result as { error?: string };
        const errorMsg = resultWithError.error || 'No calls found in database';
        logger.warn('[CallDataLoader] Query returned no calls', {
          error: errorMsg,
          duckdbPath,
        });

        // If the error mentions missing table, log it prominently
        if (errorMsg.includes('not found') || errorMsg.includes('Table')) {
          logger.error('[CallDataLoader] Database table missing - ingestion required', {
            error: errorMsg,
            duckdbPath,
          });
        }
      }

      // Convert CallRecord[] to CallPerformance[]
      // Filter out invalid calls and validate data
      const validCalls = (result.calls || []).filter((call) => {
        // Filter out calls with missing required fields
        if (!call || !call.mint || !call.createdAt) {
          logger.warn('[CallDataLoader] Skipping call with missing required fields', { call });
          return false;
        }
        return true;
      });

      // Prepare calls for historical price lookup
      const callsForPriceLookup = validCalls.map((call, index) => {
        const tokenAddress = String(call.mint || '').trim();
        let alertTimestamp: Date;
        try {
          if (call.createdAt instanceof DateTime && call.createdAt.isValid) {
            alertTimestamp = call.createdAt.toJSDate();
          } else {
            alertTimestamp = new Date();
          }
        } catch {
          alertTimestamp = new Date();
        }

        return {
          index,
          tokenAddress,
          alertTimestamp,
          caller: call.caller,
          createdAt: call.createdAt,
        };
      });

      // Load historical prices from Birdeye API at exact alert timestamps
      logger.info(
        `[CallDataLoader] Fetching historical prices from Birdeye for ${callsForPriceLookup.length} calls`
      );
      const historicalPrices = await loadHistoricalPricesBatch(
        callsForPriceLookup.map((c) => ({
          tokenAddress: c.tokenAddress,
          alertTimestamp: c.alertTimestamp,
          // Chain will be auto-detected from address format
        })),
        10 // Batch size - process 10 calls at a time to avoid rate limiting
      );

      const successRate = callsForPriceLookup.length > 0 
        ? ((historicalPrices.size / callsForPriceLookup.length) * 100).toFixed(1)
        : '0.0';
      
      logger.info(
        `[CallDataLoader] Loaded ${historicalPrices.size}/${callsForPriceLookup.length} historical prices from Birdeye (${successRate}% success rate)`
      );
      
      if (historicalPrices.size < callsForPriceLookup.length * 0.5) {
        logger.warn(
          `[CallDataLoader] Low Birdeye price fetch success rate (${successRate}%). Some tokens may not be available in Birdeye at those timestamps, or may use unsupported formats (e.g., Sui tokens).`
        );
      }

      // Map to CallPerformance with historical prices
      const callPerformance: CallPerformance[] = callsForPriceLookup.map(
        (callInfo, index) => {
          const tokenAddress = callInfo.tokenAddress;
          const alertTimestamp = callInfo.alertTimestamp;

          // Get historical price from Birdeye at exact alert time (by call index)
          const entryPrice = historicalPrices.get(index) || 0;

          // Validate and normalize caller name
          const callerName =
            callInfo.caller && String(callInfo.caller).trim()
              ? String(callInfo.caller).trim()
              : 'unknown';

          return {
            callId: index + 1, // Generate ID since we don't have numeric ID from DuckDB
            tokenAddress,
            callerName,
            chain: 'solana', // Default to solana, could be enriched later
            alertTimestamp,
            entryPrice, // Use historical price from Birdeye at exact alert time
            athPrice: entryPrice, // Default to entry price, will be enriched if OHLCV data available
            athMultiple: 1, // Default, will be enriched if OHLCV data available
            timeToAthMinutes: 0, // Will need to be enriched
            atlPrice: entryPrice, // Default to entry price, will be enriched if OHLCV data available
            atlMultiple: 1, // Default, will be enriched if OHLCV data available
          };
        }
      );

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
    let alreadyEnrichedCount = 0;
    const missingCandlesTokens = new Set<string>();

    // Process in batches of 10 to avoid overwhelming the database
    const batchSize = 10;
    for (let i = 0; i < calls.length; i += batchSize) {
      const batch = calls.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map((call) => {
          // Only enrich if not already enriched
          if (call.athMultiple !== 1 || call.athPrice !== call.entryPrice) {
            alreadyEnrichedCount++;
            return Promise.resolve(call); // Already enriched, return as-is
          }
          return this.enrichSingleCall(call, storageEngine);
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled' && result.value) {
          const call = result.value;
          enriched.push(call);

          // Check if enrichment actually happened (ATH changed from default)
          if (call.athMultiple === 1 && call.athPrice === call.entryPrice) {
            skippedCount++;
            if (call.tokenAddress) {
              missingCandlesTokens.add(call.tokenAddress);
            }
          } else {
            enrichedCount++;
          }
        } else {
          // If enrichment failed, keep the original call
          const originalCall = batch[results.indexOf(result)];
          if (originalCall) {
            enriched.push(originalCall);
            skippedCount++;
            if (originalCall.tokenAddress) {
              missingCandlesTokens.add(originalCall.tokenAddress);
            }
          }
        }
      }
    }

    const totalCalls = calls.length;
    const enrichmentRate = totalCalls > 0 ? (enrichedCount / totalCalls) * 100 : 0;
    const uniqueTokensMissingData = missingCandlesTokens.size;

    logger.info(
      `[CallDataLoader] ATH enrichment complete: ${enrichedCount}/${totalCalls} enriched (${enrichmentRate.toFixed(1)}%), ${alreadyEnrichedCount} already had data, ${skippedCount} skipped (no OHLCV data for ${uniqueTokensMissingData} unique tokens)`
    );

    if (enrichmentRate < 50 && totalCalls > 10) {
      logger.warn(
        `[CallDataLoader] Low ATH enrichment rate (${enrichmentRate.toFixed(1)}%). ${uniqueTokensMissingData} unique tokens are missing OHLCV data. Consider running: quantbot ingestion ohlcv --duckdb data/tele.duckdb`
      );
    }

    // Only log individual missing candles at trace level to reduce noise
    if (uniqueTokensMissingData > 0) {
      logger.debug(
        `[CallDataLoader] Tokens missing OHLCV data: ${Array.from(missingCandlesTokens).slice(0, 10).join(', ')}${uniqueTokensMissingData > 10 ? ` ... and ${uniqueTokensMissingData - 10} more` : ''}`
      );
    }

    return enriched;
  }

  /**
   * Enrich a single call with ATH data
   *
   * Note: This queries ClickHouse for OHLCV candles, which can be slow.
   * Use with caution in high-volume scenarios.
   */
  private async enrichSingleCall(
    call: CallPerformance,
    storageEngine: StorageEngine
  ): Promise<CallPerformance | null> {
    try {
      // Skip enrichment if entry price is missing or invalid
      if (!call.entryPrice || call.entryPrice <= 0 || !Number.isFinite(call.entryPrice)) {
        logger.trace(
          `[CallDataLoader] Skipping enrichment for call ${call.callId} - invalid entry price: ${call.entryPrice}`
        );
        return call;
      }

      const alertTime = DateTime.fromJSDate(call.alertTimestamp);
      const entryTimestamp = Math.floor(alertTime.toSeconds());

      // Fetch candles from alert time forward (up to 7 days for performance)
      // Reduced from 30 days to avoid timeouts and reduce query load
      const endTime = alertTime.plus({ days: 7 });

      // Fetch candles with error handling (ClickHouse can be slow or timeout)
      let candles;
      try {
        candles = await storageEngine.getCandles(
          call.tokenAddress,
          call.chain,
          alertTime,
          endTime,
          { interval: '5m', useCache: true }
        );
      } catch (error) {
        // ClickHouse error (timeout, connection issue, etc.) - skip enrichment for this call
        logger.trace(
          `[CallDataLoader] Candle fetch failed for ${call.tokenAddress}: ${error instanceof Error ? error.message : String(error)}`
        );
        return call;
      }

      // If no 5m candles, try 1m
      if (candles.length === 0) {
        try {
          candles = await storageEngine.getCandles(
            call.tokenAddress,
            call.chain,
            alertTime,
            endTime,
            { interval: '1m', useCache: true }
          );
        } catch (error) {
          // Skip if 1m also fails
          logger.trace(`[CallDataLoader] 1m candle fetch failed for ${call.tokenAddress}`);
          return call;
        }
      }

      // If still no candles, skip enrichment
      if (candles.length === 0) {
        // Only log at debug level - this is expected for tokens without OHLCV data
        logger.debug(
          `[CallDataLoader] No candles found for ${call.tokenAddress}::${call.chain}::${call.tokenSymbol || 'N/A'}`
        );
        // Return call with default ATH values (1x) - this is expected behavior
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

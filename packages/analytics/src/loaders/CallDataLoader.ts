/**
 * Call Data Loader
 * ================
 * Loads call performance data from Postgres and enriches with ATH data.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import { getPostgresPool, getStorageEngine } from '@quantbot/storage';
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
   * Load calls from Postgres
   */
  async loadCalls(options: LoadCallsOptions = {}): Promise<CallPerformance[]> {
    try {
      const pool = getPostgresPool();

      // Build query with filters (include ATH/ATL from alerts table)
      let query = `
        SELECT 
          a.id,
          t.address as token_address,
          t.symbol as token_symbol,
          t.chain,
          c.handle as caller_name,
          c.source as caller_source,
          a.alert_timestamp,
          a.alert_price,
          a.initial_price,
          a.ath_price,
          a.ath_timestamp,
          a.time_to_ath,
          a.atl_price,
          a.atl_timestamp
        FROM alerts a
        JOIN tokens t ON a.token_id = t.id
        LEFT JOIN callers c ON a.caller_id = c.id
        WHERE 1=1
      `;

      const params: any[] = [];
      let paramIndex = 1;

      if (options.from) {
        query += ` AND a.alert_timestamp >= $${paramIndex}`;
        params.push(options.from);
        paramIndex++;
      }

      if (options.to) {
        query += ` AND a.alert_timestamp <= $${paramIndex}`;
        params.push(options.to);
        paramIndex++;
      }

      if (options.callerNames && options.callerNames.length > 0) {
        query += ` AND c.handle = ANY($${paramIndex})`;
        params.push(options.callerNames);
        paramIndex++;
      }

      if (options.chains && options.chains.length > 0) {
        query += ` AND t.chain = ANY($${paramIndex})`;
        params.push(options.chains);
        paramIndex++;
      }

      query += ` ORDER BY a.alert_timestamp DESC`;

      if (options.limit) {
        query += ` LIMIT $${paramIndex}`;
        params.push(options.limit);
      } else {
        query += ` LIMIT 10000`; // Default limit
      }

      interface QueryRow {
        id: number;
        token_address: string;
        token_symbol: string | null;
        chain: string;
        caller_name: string | null;
        caller_source: string | null;
        alert_timestamp: Date;
        alert_price: string | null;
        initial_price: string | null;
        ath_price: string | null;
        ath_timestamp: Date | null;
        time_to_ath: number | null;
        atl_price: string | null;
        atl_timestamp: Date | null;
      }

      const result = await pool.query<QueryRow>(query, params);

      const calls: CallPerformance[] = result.rows.map((row: QueryRow) => {
        const entryPrice = row.initial_price
          ? parseFloat(row.initial_price)
          : row.alert_price
            ? parseFloat(row.alert_price)
            : 1;
        const callerName = row.caller_name
          ? row.caller_source
            ? `${row.caller_source}/${row.caller_name}`
            : row.caller_name
          : 'unknown';

        // Read ATH/ATL from alerts table (calculated during OHLCV ingestion)
        const athPrice = row.ath_price ? parseFloat(row.ath_price) : entryPrice;
        const atlPrice = row.atl_price ? parseFloat(row.atl_price) : entryPrice;
        const athMultiple = entryPrice > 0 ? athPrice / entryPrice : 1;
        const atlMultiple = entryPrice > 0 ? atlPrice / entryPrice : 1;
        const timeToAthMinutes = row.time_to_ath ? row.time_to_ath / 60 : 0;

        return {
          callId: row.id,
          tokenAddress: row.token_address,
          tokenSymbol: row.token_symbol ?? undefined,
          callerName,
          chain: row.chain || 'solana',
          alertTimestamp: new Date(row.alert_timestamp),
          entryPrice,
          athPrice,
          athMultiple,
          timeToAthMinutes,
          atlPrice,
          atlTimestamp: row.atl_timestamp ? new Date(row.atl_timestamp) : undefined,
          atlMultiple,
        };
      });

      logger.debug(`[CallDataLoader] Loaded ${calls.length} calls from Postgres`);
      return calls;
    } catch (error) {
      logger.error('[CallDataLoader] Failed to load calls', error as Error);
      throw error;
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
    } catch (error) {
      logger.warn(`[CallDataLoader] Failed to enrich call ${call.callId}`, error as Error);
      // Return original call on error
      return call;
    }
  }
}

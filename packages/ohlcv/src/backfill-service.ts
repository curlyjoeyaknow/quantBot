/**
 * OHLCV Backfill Service
 * ======================
 * Backfills OHLCV data for alerts missing 1m/5m candles with proper 52-period lookback.
 * Uses the standard OhlcvIngestionEngine for data fetching and storage.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import { queryPostgres, closePostgresPool } from '@quantbot/storage';
import { getOhlcvIngestionEngine, OhlcvIngestionEngine } from './ohlcv-ingestion-engine';
import type { Chain } from '@quantbot/core';

export interface BackfillOptions {
  /** Maximum alerts to process (default: 1000) */
  limit?: number;
  /** Only process alerts from specific callers */
  callerNames?: string[];
  /** Only process alerts after this date */
  fromDate?: DateTime;
  /** Only process alerts before this date */
  toDate?: DateTime;
  /** Delay between API calls in ms (default: 200) */
  delayMs?: number;
  /** Force refresh even if data exists (default: false) */
  forceRefresh?: boolean;
  /** Dry run - don't actually fetch (default: false) */
  dryRun?: boolean;
}

export interface BackfillProgress {
  total: number;
  processed: number;
  success: number;
  failed: number;
  skipped: number;
  total1mCandles: number;
  total5mCandles: number;
}

export interface AlertToBackfill {
  id: number;
  tokenAddress: string;
  tokenSymbol: string | null;
  chain: string;
  alertTimestamp: Date;
  callerName: string | null;
}

/**
 * OHLCV Backfill Service
 */
export class OhlcvBackfillService {
  private engine: OhlcvIngestionEngine;

  constructor() {
    this.engine = getOhlcvIngestionEngine();
  }

  /**
   * Get alerts that need backfilling
   */
  async getAlertsToBackfill(options: BackfillOptions = {}): Promise<AlertToBackfill[]> {
    const { limit = 1000, callerNames, fromDate, toDate } = options;

    const conditions: string[] = ["t.chain = 'solana'"];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (callerNames && callerNames.length > 0) {
      conditions.push(`c.handle = ANY($${paramIndex}::text[])`);
      params.push(callerNames);
      paramIndex++;
    }

    if (fromDate) {
      conditions.push(`a.alert_timestamp >= $${paramIndex}`);
      params.push(fromDate.toJSDate());
      paramIndex++;
    }

    if (toDate) {
      conditions.push(`a.alert_timestamp <= $${paramIndex}`);
      params.push(toDate.toJSDate());
      paramIndex++;
    }

    params.push(limit);

    const query = `
      SELECT 
        a.id,
        t.address as token_address,
        t.symbol as token_symbol,
        t.chain,
        a.alert_timestamp,
        c.handle as caller_name
      FROM alerts a
      JOIN tokens t ON a.token_id = t.id
      LEFT JOIN callers c ON a.caller_id = c.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY a.alert_timestamp DESC
      LIMIT $${paramIndex}
    `;

    const result = await queryPostgres<{
      id: number;
      token_address: string;
      token_symbol: string | null;
      chain: string;
      alert_timestamp: Date;
      caller_name: string | null;
    }>(query, params);

    return result.rows.map((row) => ({
      id: row.id,
      tokenAddress: row.token_address,
      tokenSymbol: row.token_symbol,
      chain: row.chain,
      alertTimestamp: row.alert_timestamp,
      callerName: row.caller_name,
    }));
  }

  /**
   * Backfill OHLCV data for a single alert
   */
  async backfillAlert(
    alert: AlertToBackfill,
    options: BackfillOptions = {}
  ): Promise<{ success: boolean; candles1m: number; candles5m: number; error?: string }> {
    const { forceRefresh = false, dryRun = false } = options;

    if (dryRun) {
      logger.info(`[Backfill] DRY RUN: Would backfill ${alert.tokenAddress.substring(0, 20)}...`);
      return { success: true, candles1m: 0, candles5m: 0 };
    }

    try {
      const alertTime = DateTime.fromJSDate(alert.alertTimestamp);

      const result = await this.engine.fetchCandles(
        alert.tokenAddress, // Full address, case-preserved
        alert.chain as Chain,
        alertTime,
        { useCache: !forceRefresh, forceRefresh }
      );

      logger.info(`[Backfill] Backfilled ${alert.tokenAddress.substring(0, 20)}...`, {
        '1m': result.metadata.total1mCandles,
        '5m': result.metadata.total5mCandles,
        fromCache: result.metadata.chunksFromCache,
        fromAPI: result.metadata.chunksFromAPI,
      });

      return {
        success: true,
        candles1m: result.metadata.total1mCandles,
        candles5m: result.metadata.total5mCandles,
      };
    } catch (error: any) {
      logger.error(
        `[Backfill] Failed to backfill ${alert.tokenAddress.substring(0, 20)}...`,
        error
      );
      return {
        success: false,
        candles1m: 0,
        candles5m: 0,
        error: error.message,
      };
    }
  }

  /**
   * Run full backfill
   */
  async runBackfill(
    options: BackfillOptions = {},
    progressCallback?: (progress: BackfillProgress) => void
  ): Promise<BackfillProgress> {
    const { delayMs = 200, dryRun = false } = options;

    logger.info('[Backfill] Starting OHLCV backfill...');

    // Get alerts to backfill
    const alerts = await this.getAlertsToBackfill(options);

    const progress: BackfillProgress = {
      total: alerts.length,
      processed: 0,
      success: 0,
      failed: 0,
      skipped: 0,
      total1mCandles: 0,
      total5mCandles: 0,
    };

    logger.info(`[Backfill] Found ${alerts.length} alerts to backfill`);

    if (dryRun) {
      logger.info('[Backfill] DRY RUN mode - no data will be fetched');
    }

    for (const alert of alerts) {
      try {
        const result = await this.backfillAlert(alert, options);

        progress.processed++;

        if (result.success) {
          progress.success++;
          progress.total1mCandles += result.candles1m;
          progress.total5mCandles += result.candles5m;
        } else {
          progress.failed++;
        }

        // Report progress
        if (progressCallback) {
          progressCallback(progress);
        }

        // Log progress every 50 alerts
        if (progress.processed % 50 === 0) {
          logger.info(`[Backfill] Progress: ${progress.processed}/${progress.total}`, {
            success: progress.success,
            failed: progress.failed,
            total1m: progress.total1mCandles,
            total5m: progress.total5mCandles,
          });
        }

        // Rate limiting
        if (!dryRun && delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
      } catch (error: any) {
        logger.error(`[Backfill] Unexpected error processing alert ${alert.id}`, error);
        progress.processed++;
        progress.failed++;
      }
    }

    logger.info('[Backfill] Backfill complete', {
      processed: progress.processed,
      success: progress.success,
      failed: progress.failed,
      total1mCandles: progress.total1mCandles,
      total5mCandles: progress.total5mCandles,
    });

    return progress;
  }
}

/**
 * Singleton instance
 */
let backfillServiceInstance: OhlcvBackfillService | null = null;

export function getOhlcvBackfillService(): OhlcvBackfillService {
  if (!backfillServiceInstance) {
    backfillServiceInstance = new OhlcvBackfillService();
  }
  return backfillServiceInstance;
}

/**
 * Convenience function to run backfill
 */
export async function runOhlcvBackfill(options: BackfillOptions = {}): Promise<BackfillProgress> {
  const service = getOhlcvBackfillService();
  return service.runBackfill(options);
}

/**
 * OHLCV Backfill Service
 * ======================
 * Backfills OHLCV data for alerts missing 1m/5m candles with proper 52-period lookback.
 * Uses the standard OhlcvIngestionEngine for data fetching and storage.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import { getOhlcvIngestionEngine, type OhlcvIngestionEngine } from './ohlcv-ingestion-engine.js';
// NOTE: Removed @quantbot/workflows import to break circular dependency
// This service is deprecated - use DuckDB workflows via @quantbot/workflows instead
// import { queryCallsDuckdb, createProductionContext } from '@quantbot/workflows';

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
   * @deprecated Use DuckDB workflows via @quantbot/workflows instead
   */
  async getAlertsToBackfill(_options: BackfillOptions = {}): Promise<AlertToBackfill[]> {
    throw new Error(
      'This function is deprecated. Use DuckDB workflows via @quantbot/workflows instead.'
    );
    // Original implementation removed to break circular dependency with @quantbot/workflows
    // If needed, use queryCallsDuckdb from @quantbot/workflows directly
  }

  /**
   * Backfill OHLCV data for a single alert
   * @deprecated Use DuckDB workflows via @quantbot/workflows instead
   */
  async backfillAlert(
    _alert: AlertToBackfill,
    _options: BackfillOptions = {}
  ): Promise<{ success: boolean; candles1m: number; candles5m: number; error?: string }> {
    throw new Error(
      'This function is deprecated. Use DuckDB workflows via @quantbot/workflows instead.'
    );
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
      } catch (error: unknown) {
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

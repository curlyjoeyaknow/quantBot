/**
 * OHLCV Backfill Service
 * ======================
 * Backfills OHLCV data for alerts missing 1m/5m candles with proper 52-period lookback.
 * Uses the standard OhlcvIngestionEngine for data fetching and storage.
 */

import { DateTime } from 'luxon';
import { logger, PythonEngine } from '@quantbot/utils';
import { getOhlcvIngestionEngine, type OhlcvIngestionEngine } from './ohlcv-ingestion-engine.js';
import { z } from 'zod';

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
 * Schema for calls query result (matches DuckDBStorageService schema)
 */
const CallsQueryResultSchema = z.object({
  success: z.boolean(),
  calls: z
    .array(
      z.object({
        mint: z.string(),
        alert_timestamp: z.string(), // ISO format timestamp
      })
    )
    .optional(),
  error: z.string().nullable().optional(),
});

type CallsQueryResult = z.infer<typeof CallsQueryResultSchema>;

/**
 * OHLCV Backfill Service
 */
export class OhlcvBackfillService {
  private engine: OhlcvIngestionEngine;
  private pythonEngine: PythonEngine;

  constructor() {
    this.engine = getOhlcvIngestionEngine();
    // Use PythonEngine directly (from @quantbot/utils) to avoid architecture violations
    // This is allowed: jobs (Data Ingestion) can import from utils (infrastructure)
    this.pythonEngine = new PythonEngine();
  }

  /**
   * Get alerts that need backfilling
   * Uses PythonEngine directly to query DuckDB (no workflow or simulation dependency)
   */
  async getAlertsToBackfill(options: BackfillOptions = {}): Promise<AlertToBackfill[]> {
    const { limit = 1000, callerNames, fromDate, toDate } = options;

    const dbPath = process.env.DUCKDB_PATH || 'data/quantbot.duckdb';

    // Query calls from DuckDB using PythonEngine directly (no architecture violations)
    try {
      const result = await this.pythonEngine.runDuckDBStorage({
        duckdbPath: dbPath,
        operation: 'query_calls',
        data: {
          limit: limit || 1000,
          exclude_unrecoverable: true,
        },
      });

      const parsed = CallsQueryResultSchema.parse(result);

      if (!parsed.success || !parsed.calls) {
        logger.warn('[Backfill] Failed to query calls from DuckDB', { error: parsed.error });
        return [];
      }

    // Filter by date range and caller name
    const fromISO = fromDate?.toISO() || DateTime.utc().minus({ years: 1 }).toISO()!;
    const toISO = toDate?.toISO() || DateTime.utc().toISO()!;
    const fromDateObj = DateTime.fromISO(fromISO, { zone: 'utc' });
    const toDateObj = DateTime.fromISO(toISO, { zone: 'utc' });

      const filtered = parsed.calls
        .filter((call: { mint: string; alert_timestamp: string }) => {
          const callDate = DateTime.fromISO(call.alert_timestamp, { zone: 'utc' });
          return callDate >= fromDateObj && callDate <= toDateObj;
        })
        .map((call: { mint: string; alert_timestamp: string }, index: number) => ({
          id: index, // Use index as ID since we don't have alert ID in calls
          tokenAddress: call.mint,
          tokenSymbol: null, // Not available in calls query
          chain: 'solana', // Assuming solana for now
          alertTimestamp: DateTime.fromISO(call.alert_timestamp, { zone: 'utc' }).toJSDate(),
          callerName: callerNames?.[0] || null, // Use first caller if multiple provided
        }));

      return filtered;
    } catch (error) {
      logger.error('[Backfill] Failed to query calls from DuckDB', error as Error);
      return [];
    }
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
      logger.info(`[Backfill] DRY RUN: Would backfill alert ${alert.id} for ${alert.tokenAddress}`);
      return { success: true, candles1m: 0, candles5m: 0 };
    }

    try {
      // Use ingestion engine to fetch candles
      await this.engine.initialize();

      const alertTime = DateTime.fromJSDate(alert.alertTimestamp);
      const result = await this.engine.fetchCandles(
        alert.tokenAddress,
        alert.chain as 'solana' | 'bsc' | 'ethereum',
        alertTime,
        {
          useCache: !forceRefresh,
          forceRefresh,
        }
      );

      return {
        success: true,
        candles1m: result.metadata.total1mCandles,
        candles5m: result.metadata.total5mCandles,
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[Backfill] Failed to backfill alert ${alert.id}`, { error: errorMessage });
      return {
        success: false,
        candles1m: 0,
        candles5m: 0,
        error: errorMessage,
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

/**
 * OhlcvIngestionService - Ingest OHLCV candles for calls
 *
 * Refactored to use the new OhlcvIngestionEngine for intelligent fetching,
 * caching, and incremental storage. Resolves token addresses, preserves
 * mint case, and aggregates ingestion statistics.
 */

import { DateTime } from 'luxon';
import { logger } from '@quantbot/utils';
import type { Chain } from '@quantbot/core';
import {
  CallsRepository,
  TokensRepository,
  AlertsRepository,
  getStorageEngine,
} from '@quantbot/storage';
import { getOhlcvIngestionEngine, type OhlcvIngestionOptions } from '@quantbot/ohlcv';
import { calculateAthFromCandleObjects } from '@quantbot/analytics';

export interface IngestForCallsParams {
  from?: Date;
  to?: Date;
  preWindowMinutes?: number; // default 260 (52*5m)
  postWindowMinutes?: number; // default 1440 (24h)
  chain?: Chain;
  options?: OhlcvIngestionOptions;
}

export interface IngestForCallsResult {
  tokensProcessed: number;
  tokensSucceeded: number;
  tokensFailed: number;
  candlesFetched1m: number;
  candlesFetched5m: number;
  chunksFromCache: number;
  chunksFromAPI: number;
  errors: Array<{ tokenId: number; error: string }>;
}

export class OhlcvIngestionService {
  constructor(
    private readonly callsRepo: CallsRepository,
    private readonly tokensRepo: TokensRepository,
    private readonly alertsRepo: AlertsRepository,
    private readonly ingestionEngine = getOhlcvIngestionEngine(),
    private readonly storageEngine = getStorageEngine()
  ) {}

  /**
   * Ingest OHLCV candles for calls in a time window
   *
   * IMPORTANT: This method deduplicates by token_id - candles are fetched once per unique token,
   * not per call/alert. This saves ~58% of API calls when multiple alerts exist for the same token.
   *
   * Strategy:
   * - Groups calls by token_id
   * - Uses earliest call timestamp for each token to determine fetch window
   * - Fetches candles once per token (not per call)
   * - Applies fetched candles to all calls/alerts for that token
   *
   * For alerts < 3 months old, uses optimized strategy:
   * (1m + 15s + 2×1m + 6×5m = 10 API calls per token)
   */
  async ingestForCalls(params: IngestForCallsParams): Promise<IngestForCallsResult> {
    const {
      from,
      to,
      preWindowMinutes = 260, // 52 * 5m
      postWindowMinutes = 1440, // 24h
      chain = 'solana' as Chain,
      options = { useCache: true },
    } = params;

    logger.info('Starting OHLCV ingestion for calls', {
      from,
      to,
      preWindowMinutes,
      postWindowMinutes,
      chain,
    });

    // Ensure engine is initialized (ClickHouse)
    await this.ingestionEngine.initialize();

    // 1. Select calls in time window
    const calls = await this.callsRepo.queryBySelection({
      from: from ? DateTime.fromJSDate(from) : undefined,
      to: to ? DateTime.fromJSDate(to) : undefined,
      side: 'buy',
    });

    logger.info('Found calls', { count: calls.length });

    // 2. Group by tokenId (deduplication: candles are token-specific, not call-specific)
    // This saves ~58% of API calls when multiple alerts/calls exist for the same token
    const tokenCalls = new Map<number, typeof calls>();
    for (const call of calls) {
      if (!tokenCalls.has(call.tokenId)) {
        tokenCalls.set(call.tokenId, []);
      }
      tokenCalls.get(call.tokenId)!.push(call);
    }

    logger.info('Grouped calls by token', {
      totalCalls: calls.length,
      uniqueTokens: tokenCalls.size,
      avgCallsPerToken: (calls.length / tokenCalls.size).toFixed(2),
      estimatedApiCallsSaved: (calls.length - tokenCalls.size) * 10,
    });

    // 3. Process each unique token (fetch candles once per token, not per call)
    let tokensProcessed = 0;
    let tokensSucceeded = 0;
    let tokensFailed = 0;
    let candlesFetched1m = 0;
    let candlesFetched5m = 0;
    let chunksFromCache = 0;
    let chunksFromAPI = 0;
    const errors: Array<{ tokenId: number; error: string }> = [];

    for (const [tokenId, tokenCallsList] of tokenCalls.entries()) {
      tokensProcessed++;

      try {
        // Resolve token address
        const token = await this.tokensRepo.findById(tokenId);
        if (!token) {
          logger.warn('Token not found for call', { tokenId });
          tokensFailed++;
          errors.push({ tokenId, error: 'Token not found' });
          continue;
        }

        // Determine alertTime window using earliest call for this token
        // This ensures we fetch enough historical data for all calls on this token
        const sorted = tokenCallsList
          .slice()
          .sort((a, b) => a.signalTimestamp.toMillis() - b.signalTimestamp.toMillis());
        const earliestCall = sorted[0];
        const alertTime = earliestCall.signalTimestamp;

        logger.debug('Fetching candles for token', {
          tokenId,
          tokenAddress: token.address.substring(0, 20) + '...',
          callsForToken: tokenCallsList.length,
          earliestCallTime: alertTime.toISO(),
        });

        // Fetch candles once per token (not per call) - candles are token-specific
        // The ingestion engine will use optimized strategy if alert is < 3 months old
        const result = await this.ingestionEngine.fetchCandles(
          token.address,
          token.chain || chain,
          alertTime,
          options
        );

        candlesFetched1m += result['1m'].length;
        candlesFetched5m += result['5m'].length;
        chunksFromCache += result.metadata.chunksFromCache;
        chunksFromAPI += result.metadata.chunksFromAPI;

        // Calculate and store ATH/ATL for each call using the fetched candles
        // Combine 1m and 5m candles (prefer 5m for accuracy, use 1m if 5m is empty)
        const allCandles = result['5m'].length > 0 ? result['5m'] : result['1m'];

        if (allCandles.length > 0) {
          await this.calculateAndStoreAthAtl(
            tokenCallsList,
            allCandles,
            token.address,
            token.chain || chain
          );
        }

        tokensSucceeded++;
      } catch (error: any) {
        tokensFailed++;
        errors.push({
          tokenId,
          error: error?.message || String(error),
        });
        logger.error('Failed to ingest OHLCV for token', error as Error, { tokenId });
        // Continue with other tokens
      }
    }

    const summary: IngestForCallsResult = {
      tokensProcessed,
      tokensSucceeded,
      tokensFailed,
      candlesFetched1m,
      candlesFetched5m,
      chunksFromCache,
      chunksFromAPI,
      errors,
    };

    logger.info('Completed OHLCV ingestion for calls', summary);
    return summary;
  }

  /**
   * Calculate ATH/ATL for calls and update alerts
   */
  private async calculateAndStoreAthAtl(
    calls: Array<{ alertId?: number; signalTimestamp: DateTime }>,
    candles: Array<{
      timestamp: number;
      high: number;
      low: number;
      open: number;
      close: number;
      volume: number;
    }>,
    _tokenAddress: string,
    _chain: string
  ): Promise<void> {
    // Get all unique alert IDs
    const alertIds = new Set<number>();
    for (const call of calls) {
      if (call.alertId) {
        alertIds.add(call.alertId);
      }
    }

    if (alertIds.size === 0) {
      logger.debug(
        '[OhlcvIngestionService] No alert IDs found for calls, skipping ATH/ATL calculation'
      );
      return;
    }

    // Fetch alerts to get entry prices
    const { getPostgresPool } = await import('@quantbot/storage');
    const pool = getPostgresPool();

    const alerts = await Promise.all(
      Array.from(alertIds).map(async (alertId) => {
        const result = await pool.query<{
          id: number;
          alert_price: number | null;
          initial_price: number | null;
          alert_timestamp: Date;
        }>(
          `SELECT id, alert_price, initial_price, alert_timestamp
           FROM alerts
           WHERE id = $1`,
          [alertId]
        );

        if (result.rows.length === 0) {
          return null;
        }

        const row = result.rows[0];
        return {
          id: row.id,
          entryPrice: row.initial_price || row.alert_price || 1.0,
          alertTimestamp: DateTime.fromJSDate(row.alert_timestamp),
        };
      })
    );

    // Calculate ATH/ATL for each alert
    for (const alert of alerts) {
      if (!alert) continue;

      try {
        const entryTimestamp = Math.floor(alert.alertTimestamp.toSeconds());
        const athResult = calculateAthFromCandleObjects(
          alert.entryPrice,
          entryTimestamp,
          candles as any // Type assertion needed for Candle compatibility
        );

        // Calculate ATH timestamp (entry timestamp + time to ATH)
        const athTimestamp =
          athResult.timeToAthMinutes > 0
            ? new Date((entryTimestamp + athResult.timeToAthMinutes * 60) * 1000)
            : undefined;

        // Update alert with ATH/ATL metrics
        await this.alertsRepo.updateAlertMetrics(alert.id, {
          athPrice: athResult.athPrice,
          athTimestamp: athTimestamp,
          atlPrice: athResult.atlPrice,
          atlTimestamp: athResult.atlTimestamp
            ? new Date(athResult.atlTimestamp * 1000)
            : undefined,
          timeToATH:
            athResult.timeToAthMinutes > 0
              ? Math.floor(athResult.timeToAthMinutes * 60)
              : undefined,
          maxROI: athResult.athMultiple > 1 ? (athResult.athMultiple - 1) * 100 : undefined,
        });

        logger.debug('[OhlcvIngestionService] Updated alert with ATH/ATL', {
          alertId: alert.id,
          athPrice: athResult.athPrice,
          atlPrice: athResult.atlPrice,
        });
      } catch (error) {
        logger.warn('[OhlcvIngestionService] Failed to calculate ATH/ATL for alert', {
          error: error instanceof Error ? error.message : String(error),
          alertId: alert.id,
        });
      }
    }
  }
}

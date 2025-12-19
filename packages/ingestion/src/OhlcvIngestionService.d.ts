/**
 * OhlcvIngestionService - Ingest OHLCV candles for calls
 *
 * Refactored to use the new OhlcvIngestionEngine for intelligent fetching,
 * caching, and incremental storage. Resolves token addresses, preserves
 * mint case, and aggregates ingestion statistics.
 */
import { type PythonEngine } from '@quantbot/utils';
import type { Chain } from '@quantbot/core';
import { AlertsRepository } from '@quantbot/storage';
import { type OhlcvIngestionOptions } from '@quantbot/ohlcv';
export interface IngestForCallsParams {
  from?: Date;
  to?: Date;
  preWindowMinutes?: number;
  postWindowMinutes?: number;
  chain?: Chain;
  options?: OhlcvIngestionOptions;
  duckdbPath?: string;
  resume?: boolean;
  interval?: '1s' | '15s' | '1m' | '5m' | '15m' | '1h';
  candles?: number;
  startOffsetMinutes?: number;
  queueItems?: Array<{
    mint: string;
    alertTimestamp: string;
    queuedAt: string;
  }>;
}
export interface IngestForCallsResult {
  tokensProcessed: number;
  tokensSucceeded: number;
  tokensFailed: number;
  tokensSkipped: number;
  tokensNoData: number;
  tokensUnrecoverable?: Array<{
    mint: string;
    alertTimestamp: string;
    reason: string;
  }>;
  candlesFetched1m: number;
  candlesFetched5m: number;
  chunksFromCache: number;
  chunksFromAPI: number;
  errors: Array<{
    tokenId: number;
    error: string;
  }>;
  queueItemsProcessed?: Array<{
    mint: string;
    alertTimestamp: string;
  }>;
}
export declare class OhlcvIngestionService {
  private readonly alertsRepo;
  private readonly ingestionEngine;
  private readonly storageEngine;
  private readonly pythonEngine;
  constructor(
    alertsRepo: AlertsRepository,
    ingestionEngine?: import('@quantbot/jobs').OhlcvIngestionEngine,
    storageEngine?: import('@quantbot/storage').StorageEngine,
    pythonEngine?: PythonEngine
  );
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
  ingestForCalls(params: IngestForCallsParams): Promise<IngestForCallsResult>;
  /**
   * Check if token already has sufficient data (resume mode)
   * Returns true if token has 1m and 5m candles for the required time range
   * Note: Only checks 1m and 5m (core intervals) since storage engine doesn't support 1s/15s queries
   *
   * For alerts older than 3 days: requires minimum 5000 candles (one full API call worth)
   * For recent alerts: requires sufficient data in the time range
   */
  private _isTokenAlreadyProcessed;
  /**
   * Calculate ATH/ATL for calls and update alerts
   *
   * Maps DuckDB calls to PostgreSQL alerts using chatId + messageId,
   * fetches historical price from Birdeye for calls missing price/mcap,
   * then calculates and stores ATH/ATL metrics.
   */
  private calculateAndStoreAthAtl;
}
//# sourceMappingURL=OhlcvIngestionService.d.ts.map

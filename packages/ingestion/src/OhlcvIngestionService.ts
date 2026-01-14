/**
 * OhlcvIngestionService - Ingest OHLCV candles for calls
 *
 * Refactored to use the new OhlcvIngestionEngine for intelligent fetching,
 * caching, and incremental storage. Resolves token addresses, preserves
 * mint case, and aggregates ingestion statistics.
 */

import { DateTime } from 'luxon';
import { logger, ConfigurationError } from '@quantbot/utils';
import type { Chain } from '@quantbot/core';
import {
  getStorageEngine,
  type StorageEngine,
  getDuckDBWorklistService,
  getGitInfoSync,
  getVersionInfo,
  type IngestionRunManifest,
  SourceTier,
} from '@quantbot/storage';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
// Types imported dynamically to break circular dependency
type OhlcvIngestionOptions = {
  useCache?: boolean;
  forceRefresh?: boolean;
  [key: string]: unknown;
};
type FetchCandlesResult = {
  '1m': Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  '5m': Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
  metadata: {
    chunksFromCache: number;
    chunksFromAPI: number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};
type RunStats = {
  candlesFetched: number;
  candlesInserted: number;
  candlesRejected: number;
  candlesDeduplicated: number;
  tokensProcessed: number;
  errorsCount: number;
  zeroVolumeCount: number;
};
type OhlcvIngestionEngine = {
  initialize(): Promise<void>;
  fetchCandles(
    mint: string,
    chain: string,
    alertTime: DateTime,
    options?: OhlcvIngestionOptions
  ): Promise<FetchCandlesResult>;
  [key: string]: unknown;
};
type OhlcvIngestionEngineWithTracking = OhlcvIngestionEngine & {
  startRun: (manifest: IngestionRunManifest) => Promise<void>;
  completeRun: (stats: RunStats) => Promise<void>;
  failRun: (error: Error) => Promise<void>;
};

export interface IngestForCallsParams {
  from?: Date;
  to?: Date;
  preWindowMinutes?: number; // default 260 (52*5m)
  postWindowMinutes?: number; // default 1440 (24h)
  chain?: Chain;
  options?: OhlcvIngestionOptions;
  duckdbPath?: string; // Path to DuckDB database (required for DuckDB-based ingestion)
  resume?: boolean; // If true, skip tokens that already have sufficient data (default: true)
  interval?: '15s' | '1m' | '5m' | '1H'; // Candle interval to fetch (default: '1m')
  candles?: number; // Number of candles to fetch (default: 5000)
  startOffsetMinutes?: number; // Minutes before alert to start fetching (default: -52)
  queueItems?: Array<{ mint: string; alertTimestamp: string; queuedAt: string }>; // Prioritized queue items from simulation failures
}

export interface IngestForCallsResult {
  tokensProcessed: number;
  tokensSucceeded: number;
  tokensFailed: number;
  tokensSkipped: number; // Tokens skipped due to resume mode
  tokensNoData: number; // Tokens where API returned 0 candles (early exit optimization)
  tokensUnrecoverable?: Array<{
    mint: string;
    alertTimestamp: string;
    reason: string;
  }>; // Tokens that couldn't get OHLCV after all retries
  candlesFetched1m: number;
  candlesFetched5m: number;
  chunksFromCache: number;
  chunksFromAPI: number;
  errors: Array<{ tokenId: number; error: string }>;
  queueItemsProcessed?: Array<{ mint: string; alertTimestamp: string }>; // Queue items that were successfully processed
}

export class OhlcvIngestionService {
  private _ingestionEngine: OhlcvIngestionEngine | null = null;
  private ingestionEnginePromise: Promise<OhlcvIngestionEngine> | null = null;

  /**
   * Create a run manifest for audit trail.
   */
  private createRunManifest(params: IngestForCallsParams): IngestionRunManifest {
    const runId = randomUUID();
    const gitInfo = getGitInfoSync();
    const versionInfo = getVersionInfo();

    // Create input hash from params
    const inputString = JSON.stringify({
      from: params.from?.toISOString(),
      to: params.to?.toISOString(),
      chain: params.chain,
      interval: params.interval,
      duckdbPath: params.duckdbPath,
    });
    const inputHash = createHash('sha256').update(inputString).digest('hex').substring(0, 16);

    // Extract relevant env vars
    const envInfo: Record<string, string> = {};
    if (process.env.CLICKHOUSE_HOST) envInfo.CLICKHOUSE_HOST = process.env.CLICKHOUSE_HOST;
    if (process.env.CLICKHOUSE_DATABASE)
      envInfo.CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE;
    if (process.env.BIRDEYE_API_KEY) envInfo.BIRDEYE_API_KEY = '***'; // Redact sensitive

    return {
      runId,
      scriptVersion: versionInfo.packageVersion,
      gitCommitHash: gitInfo.commitHash,
      gitBranch: gitInfo.branch,
      gitDirty: gitInfo.dirty,
      cliArgs: {
        from: params.from?.toISOString(),
        to: params.to?.toISOString(),
        chain: params.chain,
        interval: params.interval,
        preWindowMinutes: params.preWindowMinutes,
        postWindowMinutes: params.postWindowMinutes,
        resume: params.resume,
      },
      envInfo,
      inputHash,
      dedupMode: 'none', // Default to none, can be configured later
      sourceTier: SourceTier.BACKFILL_API, // Birdeye API backfill
    };
  }

  constructor(
    ingestionEngine?: OhlcvIngestionEngine,
    private readonly storageEngine: StorageEngine = getStorageEngine()
  ) {
    this._ingestionEngine = ingestionEngine ?? null;
  }

  private async getIngestionEngine(): Promise<OhlcvIngestionEngine> {
    if (this._ingestionEngine) {
      return this._ingestionEngine;
    }
    if (!this.ingestionEnginePromise) {
      this.ingestionEnginePromise = (async () => {
        // Dynamic import to break circular dependency
        // Use runtime string construction to prevent Next.js from analyzing at build time
        const modulePath = '@quantbot/' + 'jobs';
        const jobsModule = await import(modulePath);
        const getOhlcvIngestionEngine = (
          jobsModule as { getOhlcvIngestionEngine: () => OhlcvIngestionEngine }
        ).getOhlcvIngestionEngine;
        const engine = getOhlcvIngestionEngine();
        this._ingestionEngine = engine;
        return engine;
      })();
    }
    return this.ingestionEnginePromise;
  }

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
      interval,
      candles,
      startOffsetMinutes,
      options = { useCache: true },
      resume = true, // Default to resume mode - skip already processed tokens
      queueItems = [], // Prioritized queue items from simulation failures
    } = params;

    logger.info('Starting OHLCV ingestion for calls', {
      from,
      to,
      preWindowMinutes,
      postWindowMinutes,
      chain,
      queueItemsCount: queueItems.length,
    });

    // Create run manifest for audit trail
    const runManifest = this.createRunManifest(params);

    // Ensure engine is initialized (ClickHouse)
    const engine = await this.getIngestionEngine();
    await engine.initialize();

    // Start tracked run
    try {
      // Type assertion needed because engine type doesn't include run tracking methods yet
      const engineWithTracking = engine as OhlcvIngestionEngineWithTracking;
      await engineWithTracking.startRun(runManifest);
    } catch (error) {
      logger.warn('Failed to start run tracking (continuing without tracking)', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    try {
      // Determine DuckDB path (from params or environment)
      const duckdbPath = params.duckdbPath || process.env.DUCKDB_PATH;
      if (!duckdbPath) {
        throw new ConfigurationError(
          'DuckDB path is required. Provide duckdbPath in params or set DUCKDB_PATH environment variable.'
        );
      }

      // 1. Query DuckDB for worklist (calls + tokens with resolved mints)
      logger.info('Querying DuckDB for OHLCV worklist', {
        duckdbPath,
        from: from?.toISOString(),
        to: to?.toISOString(),
      });

      const worklistService = getDuckDBWorklistService();
      const worklist = await worklistService.queryWorklist({
        duckdbPath,
        from: from?.toISOString(),
        to: to?.toISOString(),
        side: 'buy',
      });

      logger.info('Found worklist', {
        tokenGroups: worklist.tokenGroups.length,
        calls: worklist.calls.length,
        queueItems: queueItems.length,
      });

      // 1.5. Merge queue items with worklist (prioritize queue items)
      // Convert queue items to worklist format (normalize to milliseconds)
      const queueTokenGroups: Array<{
        mint: string;
        chain: string;
        earliestAlertTsMs: number;
        isFromQueue: boolean; // Flag to track queue items
      }> = queueItems.map((item) => ({
        mint: item.mint,
        chain: chain, // Default chain, will be resolved during processing
        // Queue items use ISO string, convert to milliseconds
        earliestAlertTsMs: DateTime.fromISO(item.alertTimestamp, { zone: 'utc' }).toMillis(),
        isFromQueue: true,
      }));

      // Merge: queue items first (priority), then worklist items
      // Deduplicate: if a mint+timestamp exists in both, prefer queue item
      const worklistMap = new Map<string, (typeof worklist.tokenGroups)[0]>();
      for (const group of worklist.tokenGroups) {
        const key = `${group.mint}:${group.earliestAlertTsMs}`;
        worklistMap.set(key, group);
      }

      // Remove worklist items that are in queue (queue takes priority)
      for (const queueItem of queueTokenGroups) {
        const key = `${queueItem.mint}:${queueItem.earliestAlertTsMs}`;
        worklistMap.delete(key);
      }

      // Combine: queue items first, then remaining worklist items
      const prioritizedTokenGroups = [
        ...queueTokenGroups.map((q) => ({ ...q, isFromQueue: true })),
        ...Array.from(worklistMap.values()).map((w) => ({ ...w, isFromQueue: false })),
      ];

      logger.info('Prioritized token groups', {
        queueItems: queueTokenGroups.length,
        worklistItems: worklistMap.size,
        total: prioritizedTokenGroups.length,
      });

      if (prioritizedTokenGroups.length === 0) {
        logger.info('No token groups found (worklist + queue), nothing to ingest');
        return {
          tokensProcessed: 0,
          tokensSucceeded: 0,
          tokensFailed: 0,
          tokensSkipped: 0,
          tokensNoData: 0,
          candlesFetched1m: 0,
          candlesFetched5m: 0,
          chunksFromCache: 0,
          chunksFromAPI: 0,
          errors: [],
          queueItemsProcessed: [],
        };
      }

      // 2. Group calls by mint for efficient processing
      const callsByMint = new Map<string, typeof worklist.calls>();
      for (const call of worklist.calls) {
        if (!callsByMint.has(call.mint)) {
          callsByMint.set(call.mint, []);
        }
        callsByMint.get(call.mint)!.push(call);
      }

      const totalCalls = worklist.calls.length;
      logger.info('Grouped calls by token', {
        totalCalls,
        uniqueTokens: prioritizedTokenGroups.length,
        avgCallsPerToken:
          worklist.calls.length > 0 ? (totalCalls / prioritizedTokenGroups.length).toFixed(2) : '0',
        estimatedApiCallsSaved: (totalCalls - prioritizedTokenGroups.length) * 10,
      });

      // 3. Process each unique token (fetch candles once per token, not per call)
      // Process in parallel batches - rate limiter will handle 50 RPS throttling
      // Very conservative concurrency to stay well under 50 RPS:
      // - Each token makes ~3-4 API calls on average (1m probe + early exit, or full fetch)
      // - 50 RPS / 4 calls per token = ~12 tokens/sec max
      // - Use 2 concurrent tokens to leave quota for other endpoints (metadata, price)
      // - This ensures ~40% of rate limit (1200 req/min) is available for non-OHLCV calls
      const CONCURRENT_TOKENS = 2;
      let tokensProcessed = 0;
      let tokensSucceeded = 0;
      let tokensFailed = 0;
      let tokensSkipped = 0;
      let tokensNoData = 0;
      let candlesFetched1m = 0;
      let candlesFetched5m = 0;
      let chunksFromCache = 0;
      let chunksFromAPI = 0;
      const errors: Array<{ tokenId: number; error: string }> = [];
      const queueItemsProcessed: Array<{ mint: string; alertTimestamp: string }> = [];
      const tokensUnrecoverable: Array<{
        mint: string;
        alertTimestamp: string;
        reason: string;
      }> = [];

      // Process tokens in parallel batches
      for (let i = 0; i < prioritizedTokenGroups.length; i += CONCURRENT_TOKENS) {
        const batch = prioritizedTokenGroups.slice(i, i + CONCURRENT_TOKENS);

        const batchResults = await Promise.all(
          batch.map(async (tokenGroup, batchIndex) => {
            const tokenId = i + batchIndex + 1;
            tokensProcessed++;
            const isFromQueue = (tokenGroup as { isFromQueue?: boolean }).isFromQueue ?? false;

            try {
              const { mint, chain: tokenChain, earliestAlertTsMs } = tokenGroup;

              if (!mint || earliestAlertTsMs === null || earliestAlertTsMs === undefined) {
                logger.warn('Token group missing required fields', {
                  mint: mint,
                  hasEarliestAlertTsMs:
                    earliestAlertTsMs !== null && earliestAlertTsMs !== undefined,
                });
                tokensFailed++;
                errors.push({
                  tokenId,
                  error: 'Missing mint or earliestAlertTsMs',
                });
                return null;
              }

              // Get all calls for this mint
              const callsForToken = callsByMint.get(mint) || [];

              // Use raw milliseconds directly
              const alertTime = DateTime.fromMillis(earliestAlertTsMs, { zone: 'utc' });

              // Resume mode: Check if token already has sufficient data
              if (resume) {
                const storedChain = (tokenChain as Chain) || chain;
                const alreadyProcessed = await this._isTokenAlreadyProcessed(
                  mint,
                  storedChain,
                  alertTime,
                  preWindowMinutes,
                  postWindowMinutes
                );

                if (alreadyProcessed) {
                  logger.debug('Token already processed, skipping (resume mode)', {
                    mint: mint,
                    alertTime: alertTime.toISO(),
                    chain: storedChain,
                  });
                  tokensSkipped++;
                  return null;
                }
              }

              logger.debug('Fetching candles for token', {
                mint: mint,
                callsForToken: callsForToken.length,
                earliestCallTime: alertTime.toISO(),
                chain: tokenChain || chain,
              });

              // Fetch candles once per token (not per call) - candles are token-specific
              // Use user-specified parameters for interval, candles, and start offset
              const fetchOptions: OhlcvIngestionOptions = {
                ...options,
                interval: interval || '1m',
                candles: candles || 5000,
                startOffsetMinutes: startOffsetMinutes ?? -52,
              };

              const engine = await this.getIngestionEngine();
              const result = await engine.fetchCandles(
                mint,
                (tokenChain as Chain) || chain,
                alertTime,
                fetchOptions
              );

              // NOTE: ATH/ATL calculation is now handled by simulation layer
              // Simulation will query OHLCV offline and calculate ATH/ATL for its specific time range

              // Only count as succeeded if we actually fetched candles
              // Early exit optimization may return 0 candles if API has no data
              const totalCandles = result['1m'].length + result['5m'].length;
              if (totalCandles > 0) {
                tokensSucceeded++;

                // Track queue items that were successfully processed
                if (isFromQueue) {
                  queueItemsProcessed.push({
                    mint,
                    alertTimestamp: alertTime.toISO()!,
                  });
                }
              } else {
                // No data available from API - count separately
                // This is different from an error (which would be counted as failed)
                tokensNoData++;
                logger.debug('Token processed but no candles available (early exit)', {
                  mint: mint,
                });

                // If this was from queue (simulation failure), mark as unrecoverable
                if (isFromQueue) {
                  tokensUnrecoverable.push({
                    mint,
                    alertTimestamp: alertTime.toISO()!,
                    reason: 'No OHLCV data available from API after all retries',
                  });
                }
              }

              return {
                '1m': result['1m'].length,
                '5m': result['5m'].length,
                chunksFromCache: result.metadata.chunksFromCache,
                chunksFromAPI: result.metadata.chunksFromAPI,
              };
            } catch (error: unknown) {
              tokensFailed++;
              const errorMessage = error instanceof Error ? error.message : String(error);
              errors.push({
                tokenId,
                error: errorMessage,
              });
              logger.error('Failed to ingest OHLCV for token', error as Error, {
                mint: tokenGroup.mint,
              });

              // If this was from queue (simulation failure), mark as unrecoverable
              if (isFromQueue) {
                const tsMs = tokenGroup.earliestAlertTsMs;
                tokensUnrecoverable.push({
                  mint: tokenGroup.mint || '',
                  alertTimestamp:
                    tsMs !== null && tsMs !== undefined
                      ? DateTime.fromMillis(tsMs, { zone: 'utc' }).toISO()!
                      : '',
                  reason: `Persistent error: ${errorMessage}`,
                });
              }

              return null;
            }
          })
        );

        // Aggregate results from batch
        for (const result of batchResults) {
          if (result) {
            candlesFetched1m += result['1m'];
            candlesFetched5m += result['5m'];
            chunksFromCache += result.chunksFromCache;
            chunksFromAPI += result.chunksFromAPI;
          }
        }
      }

      const summary: IngestForCallsResult = {
        tokensProcessed,
        tokensSucceeded,
        tokensFailed,
        tokensSkipped,
        tokensNoData,
        tokensUnrecoverable: tokensUnrecoverable.length > 0 ? tokensUnrecoverable : undefined,
        candlesFetched1m,
        candlesFetched5m,
        chunksFromCache,
        chunksFromAPI,
        errors,
        queueItemsProcessed,
      };

      logger.info('Completed OHLCV ingestion for calls', {
        tokensProcessed: summary.tokensProcessed,
        tokensSucceeded: summary.tokensSucceeded,
        tokensFailed: summary.tokensFailed,
        tokensSkipped: summary.tokensSkipped,
        tokensNoData: summary.tokensNoData,
        tokensUnrecoverable: summary.tokensUnrecoverable?.length || 0,
        candlesFetched1m: summary.candlesFetched1m,
        candlesFetched5m: summary.candlesFetched5m,
        chunksFromCache: summary.chunksFromCache,
        chunksFromAPI: summary.chunksFromAPI,
        errorCount: summary.errors.length,
      });

      // Complete tracked run (engine automatically tracks stats from upsertCandles calls)
      try {
        const engineWithTracking = engine as OhlcvIngestionEngineWithTracking;
        // Fill in all required RunStats properties
        await engineWithTracking.completeRun({
          tokensProcessed: summary.tokensProcessed,
          errorsCount: summary.errors.length,
          candlesFetched: summary.candlesFetched1m + summary.candlesFetched5m,
          candlesInserted: 0, // Not tracked here, handled internally by engine if needed
          candlesRejected: 0, // Not tracked here, handled internally by engine if needed
          candlesDeduplicated: 0, // Not tracked here, handled internally by engine if needed
          zeroVolumeCount: 0, // Not tracked here, handled internally by engine if needed
        });
      } catch (error) {
        logger.warn('Failed to complete run tracking', {
          error: error instanceof Error ? error.message : String(error),
        });
      }

      return summary;
    } catch (error) {
      // Fail tracked run on error
      try {
        const engineWithTracking = engine as OhlcvIngestionEngineWithTracking;
        await engineWithTracking.failRun(error as Error);
      } catch (failError) {
        logger.warn('Failed to mark run as failed', {
          error: failError instanceof Error ? failError.message : String(failError),
        });
      }
      throw error;
    }
  }

  /**
   * Check if token already has sufficient data (resume mode)
   * Returns true if token has 1m and 5m candles for the required time range
   * Note: Only checks 1m and 5m (core intervals) since storage engine doesn't support 1s/15s queries
   *
   * For alerts older than 3 days: requires minimum 5000 candles (one full API call worth)
   * For recent alerts: requires sufficient data in the time range
   */
  private async _isTokenAlreadyProcessed(
    mint: string,
    chain: Chain,
    alertTime: DateTime,
    preWindowMinutes: number,
    postWindowMinutes: number
  ): Promise<boolean> {
    try {
      const now = DateTime.utc();
      const alertAge = now.diff(alertTime, 'days').days;

      // Calculate time range around the alert (not up to now)
      const startTime = alertTime.minus({ minutes: preWindowMinutes });
      const endTime = alertTime.plus({ minutes: postWindowMinutes });
      // Don't cap to now - check the actual time range around the alert

      // Check for 1m candles (required for all tokens)
      const has1m = await this.storageEngine.getCandles(mint, chain, startTime, endTime, {
        interval: '1m',
      });

      // Check for 5m candles (required for all tokens)
      const has5m = await this.storageEngine.getCandles(mint, chain, startTime, endTime, {
        interval: '5m',
      });

      // For alerts older than 3 days: require minimum 5000 candles (one full API call)
      // For recent alerts: require sufficient data
      if (alertAge > 3) {
        // Old alert: need at least 5000 candles minimum
        const minCandles = 5000;
        return has1m.length >= minCandles && has5m.length >= minCandles;
      } else {
        // Recent alert: require reasonable minimum (200 1m, 100 5m)
        const min1mCandles = 200;
        const min5mCandles = 100;
        return has1m.length >= min1mCandles && has5m.length >= min5mCandles;
      }
    } catch (error) {
      // If check fails, assume not processed (safer to re-process than skip)
      logger.debug('Error checking if token already processed', {
        mint: mint,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * Calculate ATH/ATL for calls and update alerts
   *
   * Maps DuckDB calls to PostgreSQL alerts using chatId + messageId,
   * fetches historical price from Birdeye for calls missing price/mcap,
   * then calculates and stores ATH/ATL metrics.
   */
  // NOTE: ATH/ATL calculation has been removed from ingestion service.
  // Simulation layer will query OHLCV offline and calculate ATH/ATL for its specific time range.
  // This ensures ATH/ATL is calculated based on the simulation's parameters (lookback/lookforward windows).
}

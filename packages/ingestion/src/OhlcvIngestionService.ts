/**
 * OhlcvIngestionService - Ingest OHLCV candles for calls
 *
 * Refactored to use the new OhlcvIngestionEngine for intelligent fetching,
 * caching, and incremental storage. Resolves token addresses, preserves
 * mint case, and aggregates ingestion statistics.
 */

import { DateTime } from 'luxon';
import { logger, getPythonEngine, type PythonEngine } from '@quantbot/utils';
import type { Chain, Candle } from '@quantbot/core';
import { AlertsRepository, getStorageEngine, getPostgresPool } from '@quantbot/storage';
import { getOhlcvIngestionEngine, type OhlcvIngestionOptions } from '@quantbot/ohlcv';
import { getBirdeyeClient } from '@quantbot/api-clients';
import { calculateAthFromCandleObjects } from '@quantbot/analytics';
import { fetchMultiChainMetadata } from './MultiChainMetadataService';
import { isEvmAddress } from './addressValidation';

export interface IngestForCallsParams {
  from?: Date;
  to?: Date;
  preWindowMinutes?: number; // default 260 (52*5m)
  postWindowMinutes?: number; // default 1440 (24h)
  chain?: Chain;
  options?: OhlcvIngestionOptions;
  duckdbPath?: string; // Path to DuckDB database (required for DuckDB-based ingestion)
  resume?: boolean; // If true, skip tokens that already have sufficient data (default: true)
  interval?: '1s' | '15s' | '1m' | '5m' | '15m' | '1h'; // Candle interval to fetch (default: '1m')
  candles?: number; // Number of candles to fetch (default: 5000)
  startOffsetMinutes?: number; // Minutes before alert to start fetching (default: -52)
}

export interface IngestForCallsResult {
  tokensProcessed: number;
  tokensSucceeded: number;
  tokensFailed: number;
  tokensSkipped: number; // Tokens skipped due to resume mode
  tokensNoData: number; // Tokens where API returned 0 candles (early exit optimization)
  candlesFetched1m: number;
  candlesFetched5m: number;
  chunksFromCache: number;
  chunksFromAPI: number;
  errors: Array<{ tokenId: number; error: string }>;
}

export class OhlcvIngestionService {
  constructor(
    private readonly alertsRepo: AlertsRepository,
    private readonly ingestionEngine = getOhlcvIngestionEngine(),
    private readonly storageEngine = getStorageEngine(),
    private readonly pythonEngine: PythonEngine = getPythonEngine()
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
      interval,
      candles,
      startOffsetMinutes,
      options = { useCache: true },
      resume = true, // Default to resume mode - skip already processed tokens
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

    // Determine DuckDB path (from params or environment)
    const duckdbPath = params.duckdbPath || process.env.DUCKDB_PATH;
    if (!duckdbPath) {
      throw new Error(
        'DuckDB path is required. Provide duckdbPath in params or set DUCKDB_PATH environment variable.'
      );
    }

    // 1. Query DuckDB for worklist (calls + tokens with resolved mints)
    logger.info('Querying DuckDB for OHLCV worklist', {
      duckdbPath,
      from: from?.toISOString(),
      to: to?.toISOString(),
    });

    const worklist = await this.pythonEngine.runOhlcvWorklist({
      duckdbPath,
      from: from?.toISOString(),
      to: to?.toISOString(),
      side: 'buy',
    });

    logger.info('Found worklist', {
      tokenGroups: worklist.tokenGroups.length,
      calls: worklist.calls.length,
    });

    if (worklist.tokenGroups.length === 0) {
      logger.info('No worklist items found, nothing to ingest');
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
      uniqueTokens: worklist.tokenGroups.length,
      avgCallsPerToken: (totalCalls / worklist.tokenGroups.length).toFixed(2),
      estimatedApiCallsSaved: (totalCalls - worklist.tokenGroups.length) * 10,
    });

    // 3. Process each unique token (fetch candles once per token, not per call)
    // Process in parallel batches - rate limiter will handle 50 RPS throttling
    // Very conservative concurrency to stay well under 50 RPS:
    // - Each token makes ~3-4 API calls on average (1m probe + early exit, or full fetch)
    // - 50 RPS / 4 calls per token = ~12 tokens/sec max
    // - Use 5 concurrent tokens to leave significant headroom and avoid long queues
    const CONCURRENT_TOKENS = 5;
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

    // Process tokens in parallel batches
    for (let i = 0; i < worklist.tokenGroups.length; i += CONCURRENT_TOKENS) {
      const batch = worklist.tokenGroups.slice(i, i + CONCURRENT_TOKENS);

      const batchResults = await Promise.all(
        batch.map(async (tokenGroup, batchIndex) => {
          const tokenId = i + batchIndex + 1;
          tokensProcessed++;

          try {
            const { mint, chain: tokenChain, earliestAlertTime } = tokenGroup;

            if (!mint || !earliestAlertTime) {
              logger.warn('Token group missing required fields', {
                mint: mint?.substring(0, 20),
                hasEarliestAlertTime: !!earliestAlertTime,
              });
              tokensFailed++;
              errors.push({
                tokenId,
                error: 'Missing mint or earliestAlertTime',
              });
              return null;
            }

            // Get all calls for this mint
            const callsForToken = callsByMint.get(mint) || [];

            // Parse alert time from ISO string
            const alertTime = DateTime.fromISO(earliestAlertTime);

            // Resume mode: Check if token already has sufficient data
            if (resume) {
              const storedChain = (tokenChain as Chain) || chain;

              // For EVM addresses, verify chain is correct before skipping
              if (isEvmAddress(mint)) {
                const chainResult = await fetchMultiChainMetadata(mint, storedChain);
                if (chainResult.primaryMetadata) {
                  const actualChain = chainResult.primaryMetadata.chain;
                  if (actualChain !== storedChain) {
                    // Chain mismatch - need to refetch with correct chain
                    logger.warn('Chain mismatch detected in resume mode, refetching', {
                      mint: mint.substring(0, 20) + '...',
                      storedChain,
                      actualChain,
                      symbol: chainResult.primaryMetadata.symbol,
                    });
                    // Continue to fetch with correct chain (don't skip)
                  } else {
                    // Chain is correct, check if data exists
                    const alreadyProcessed = await this._isTokenAlreadyProcessed(
                      mint,
                      actualChain,
                      alertTime,
                      preWindowMinutes,
                      postWindowMinutes
                    );

                    if (alreadyProcessed) {
                      logger.debug('Token already processed, skipping (resume mode)', {
                        mint: mint.substring(0, 20) + '...',
                        alertTime: alertTime.toISO(),
                        chain: actualChain,
                      });
                      tokensSkipped++;
                      return null;
                    }
                  }
                } else {
                  // No metadata found - check with stored chain anyway
                  const alreadyProcessed = await this._isTokenAlreadyProcessed(
                    mint,
                    storedChain,
                    alertTime,
                    preWindowMinutes,
                    postWindowMinutes
                  );

                  if (alreadyProcessed) {
                    logger.debug('Token already processed, skipping (resume mode)', {
                      mint: mint.substring(0, 20) + '...',
                      alertTime: alertTime.toISO(),
                    });
                    tokensSkipped++;
                    return null;
                  }
                }
              } else {
                // Solana: existing logic
                const alreadyProcessed = await this._isTokenAlreadyProcessed(
                  mint,
                  storedChain,
                  alertTime,
                  preWindowMinutes,
                  postWindowMinutes
                );

                if (alreadyProcessed) {
                  logger.debug('Token already processed, skipping (resume mode)', {
                    mint: mint.substring(0, 20) + '...',
                    alertTime: alertTime.toISO(),
                  });
                  tokensSkipped++;
                  return null;
                }
              }
            }

            logger.debug('Fetching candles for token', {
              mint: mint.substring(0, 20) + '...',
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

            const result = await this.ingestionEngine.fetchCandles(
              mint,
              (tokenChain as Chain) || chain,
              alertTime,
              fetchOptions
            );

            // Calculate and store ATH/ATL for calls using the fetched candles
            // Combine 1m and 5m candles (prefer 5m for accuracy, use 1m if 5m is empty)
            const allCandles = result['5m'].length > 0 ? result['5m'] : result['1m'];

            if (allCandles.length > 0 && callsForToken.length > 0) {
              await this.calculateAndStoreAthAtl(
                callsForToken,
                allCandles as Candle[],
                mint,
                (tokenChain as Chain) || chain
              );
            }

            // Only count as succeeded if we actually fetched candles
            // Early exit optimization may return 0 candles if API has no data
            const totalCandles = result['1m'].length + result['5m'].length;
            if (totalCandles > 0) {
              tokensSucceeded++;
            } else {
              // No data available from API - count separately
              // This is different from an error (which would be counted as failed)
              tokensNoData++;
              logger.debug('Token processed but no candles available (early exit)', {
                mint: mint.substring(0, 20) + '...',
              });
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
              mint: tokenGroup.mint?.substring(0, 20),
            });
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
      candlesFetched1m,
      candlesFetched5m,
      chunksFromCache,
      chunksFromAPI,
      errors,
    };

    logger.info('Completed OHLCV ingestion for calls', {
      tokensProcessed: summary.tokensProcessed,
      tokensSucceeded: summary.tokensSucceeded,
      tokensFailed: summary.tokensFailed,
      tokensSkipped: summary.tokensSkipped,
      tokensNoData: summary.tokensNoData,
      candlesFetched1m: summary.candlesFetched1m,
      candlesFetched5m: summary.candlesFetched5m,
      chunksFromCache: summary.chunksFromCache,
      chunksFromAPI: summary.chunksFromAPI,
      errorCount: summary.errors.length,
    });
    return summary;
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
        mint: mint.substring(0, 20) + '...',
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
  private async calculateAndStoreAthAtl(
    calls: Array<{
      mint: string;
      chain: string;
      alertTime: string | null;
      chatId: string | null;
      messageId: string | null;
      priceUsd: number | null;
      mcapUsd: number | null;
      botTsMs: number | null;
    }>,
    candles: Candle[],
    tokenAddress: string,
    chain: string
  ): Promise<void> {
    if (calls.length === 0) {
      return;
    }

    const pool = getPostgresPool();
    const birdeye = getBirdeyeClient();

    // Map calls to alerts using chatId + messageId
    const alertsToUpdate: Array<{
      alertId: number;
      entryPrice: number;
      alertTimestamp: DateTime;
    }> = [];

    for (const call of calls) {
      if (!call.chatId || !call.messageId || !call.alertTime) {
        logger.debug('Call missing chatId/messageId/alertTime, skipping ATH/ATL', {
          mint: call.mint.substring(0, 20),
        });
        continue;
      }

      // Find alert in PostgreSQL by chatId + messageId
      const alertResult = await pool.query<{
        id: number;
        alert_price: number | null;
        initial_price: number | null;
        alert_timestamp: Date;
      }>(
        `SELECT id, alert_price, initial_price, alert_timestamp
         FROM alerts
         WHERE raw_payload_json->>'chatId' = $1
           AND raw_payload_json->>'messageId' = $2
         LIMIT 1`,
        [call.chatId, call.messageId]
      );

      if (alertResult.rows.length === 0) {
        logger.debug('Alert not found for call', {
          chatId: call.chatId,
          messageId: call.messageId,
        });
        continue;
      }

      const alert = alertResult.rows[0];
      const alertTimestamp = DateTime.fromJSDate(alert.alert_timestamp);

      // Determine entry price: use from DuckDB, or alert, or fetch from Birdeye
      let entryPrice = call.priceUsd ?? alert.initial_price ?? alert.alert_price ?? null;

      if (entryPrice === null || entryPrice === 0) {
        // Fetch historical price from Birdeye for the call's exact datetime
        logger.debug('Fetching historical price from Birdeye', {
          mint: call.mint.substring(0, 20),
          alertTime: call.alertTime,
        });

        try {
          const alertDate = DateTime.fromISO(call.alertTime);
          const unixTime = Math.floor(alertDate.toSeconds());

          // Try the unix_time endpoint first (more efficient for single timestamp)
          let historicalPrice = await birdeye.fetchHistoricalPriceAtUnixTime(
            call.mint,
            unixTime,
            call.chain || chain
          );

          // Fallback to time range endpoint if unix_time endpoint fails
          if (!historicalPrice) {
            logger.debug('Unix time endpoint failed, trying time range endpoint', {
              mint: call.mint.substring(0, 20),
            });
            const timeFrom = unixTime;
            const timeTo = unixTime + 60; // 1 minute window

            const historicalPrices = await birdeye.fetchHistoricalPrice(
              call.mint,
              timeFrom,
              timeTo,
              '1m',
              call.chain || chain
            );

            if (historicalPrices && historicalPrices.length > 0) {
              // Use the closest price to our target time
              historicalPrice = historicalPrices[0];
            }
          }

          if (historicalPrice) {
            // Use the price value (or price field if available)
            entryPrice = historicalPrice.price ?? historicalPrice.value;
            logger.debug('Fetched historical price from Birdeye', {
              mint: call.mint.substring(0, 20),
              price: entryPrice,
              method: historicalPrice.price !== undefined ? 'unix_time' : 'time_range',
            });
          }
        } catch (error) {
          logger.warn('Failed to fetch historical price from Birdeye', {
            error: error instanceof Error ? error.message : String(error),
            mint: call.mint.substring(0, 20),
          });
        }
      }

      if (entryPrice === null || entryPrice === 0) {
        logger.warn('Could not determine entry price for alert', {
          alertId: alert.id,
          mint: call.mint.substring(0, 20),
        });
        continue;
      }

      alertsToUpdate.push({
        alertId: alert.id,
        entryPrice,
        alertTimestamp,
      });
    }

    if (alertsToUpdate.length === 0) {
      logger.debug('No alerts to update with ATH/ATL metrics');
      return;
    }

    // Calculate ATH/ATL for each alert
    for (const alertData of alertsToUpdate) {
      try {
        const entryTimestamp = Math.floor(alertData.alertTimestamp.toSeconds());
        const athResult = calculateAthFromCandleObjects(
          alertData.entryPrice,
          entryTimestamp,
          candles
        );

        // Calculate ATH timestamp (entry timestamp + time to ATH)
        const athTimestamp =
          athResult.timeToAthMinutes > 0
            ? new Date((entryTimestamp + athResult.timeToAthMinutes * 60) * 1000)
            : undefined;

        // Update alert with ATH/ATL metrics
        await this.alertsRepo.updateAlertMetrics(alertData.alertId, {
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
          alertId: alertData.alertId,
          athPrice: athResult.athPrice,
          atlPrice: athResult.atlPrice,
        });
      } catch (error) {
        logger.warn('[OhlcvIngestionService] Failed to calculate ATH/ATL for alert', {
          error: error instanceof Error ? error.message : String(error),
          alertId: alertData.alertId,
        });
      }
    }
  }
}

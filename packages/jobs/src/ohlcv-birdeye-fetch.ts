/**
 * OHLCV Birdeye Fetch
 * ====================
 *
 * Fetches OHLCV candles from Birdeye API ONLY.
 * Does NOT store candles - that's handled by the ingestion workflow.
 *
 * Terminology:
 * - "fetch" = API call to Birdeye (this file)
 * - "ingestion" = storing in ClickHouse + updating DuckDB metadata (workflow)
 *
 * This is the ONLY place where Birdeye API calls for OHLCV data are allowed.
 *
 * Responsibilities:
 * - Call @quantbot/api-clients to fetch from Birdeye
 * - Enforce rate limits and circuit breakers
 * - Return raw candles (no storage)
 *
 * NOTE: Storage is handled by the ingestion workflow, not this fetch job.
 */

import { logger } from '@quantbot/utils';
import { fetchBirdeyeCandles } from '@quantbot/api-clients';
import { getCoverage } from '@quantbot/ohlcv';
import type { OhlcvWorkItem } from '@quantbot/ingestion';
import type { Candle } from '@quantbot/core';

/**
 * Result of fetching candles from Birdeye (no storage)
 */
export interface OhlcvBirdeyeFetchResult {
  workItem: OhlcvWorkItem;
  success: boolean;
  candles: Candle[]; // Raw candles from Birdeye
  candlesFetched: number;
  skipped: boolean; // True if skipped due to coverage
  error?: string;
  durationMs: number;
}

/**
 * Options for OHLCV Birdeye fetch
 */
export interface OhlcvBirdeyeFetchOptions {
  /**
   * Rate limit delay between requests (ms)
   * Used when parallelWorkers is 1 (sequential mode)
   * @default 100
   */
  rateLimitMs?: number;

  /**
   * Number of parallel workers for fetching
   * Each worker makes requests with rateLimitMsPerWorker delay between requests
   * @default 1 (sequential)
   */
  parallelWorkers?: number;

  /**
   * Rate limit delay per worker in parallel mode (ms)
   * With 16 workers and 330ms delay, we get ~48.5 RPS (under 50 RPS limit)
   * @default 330
   */
  rateLimitMsPerWorker?: number;

  /**
   * Maximum retries on failure
   * @default 3
   */
  maxRetries?: number;

  /**
   * Circuit breaker threshold (failures before opening)
   * @default 10
   */
  circuitBreakerThreshold?: number;

  /**
   * Check coverage before fetching (skip if already have sufficient data)
   * @default true
   */
  checkCoverage?: boolean;

  /**
   * Minimum coverage ratio to skip fetching (0.0 to 1.0)
   * If coverage is above this threshold, skip fetching
   * @default 0.95
   */
  minCoverageToSkip?: number;
}

/**
 * OHLCV Birdeye Fetch
 *
 * Fetches candles from Birdeye API only. Does NOT store candles.
 * Storage is handled by the ingestion workflow.
 */
export class OhlcvBirdeyeFetch {
  private rateLimitMs: number;
  private parallelWorkers: number;
  private rateLimitMsPerWorker: number;
  private maxRetries: number;
  private circuitBreakerThreshold: number;
  private checkCoverage: boolean;
  private minCoverageToSkip: number;
  private failureCount: number = 0;

  constructor(options: OhlcvBirdeyeFetchOptions = {}) {
    this.rateLimitMs = options.rateLimitMs ?? 100;
    this.parallelWorkers = options.parallelWorkers ?? 1;
    this.rateLimitMsPerWorker = options.rateLimitMsPerWorker ?? 330;
    this.maxRetries = options.maxRetries ?? 3;
    this.circuitBreakerThreshold = options.circuitBreakerThreshold ?? 10;
    this.checkCoverage = options.checkCoverage ?? true;
    this.minCoverageToSkip = options.minCoverageToSkip ?? 0.95;
  }

  /**
   * Fetch candles from Birdeye for a single work item
   * Returns raw candles - does NOT store them
   */
  async fetchWorkItem(workItem: OhlcvWorkItem): Promise<OhlcvBirdeyeFetchResult> {
    const startTime = Date.now();

    // Check circuit breaker
    if (this.failureCount >= this.circuitBreakerThreshold) {
      logger.warn('Circuit breaker open - too many failures', {
        failureCount: this.failureCount,
        threshold: this.circuitBreakerThreshold,
      });
      return {
        workItem,
        success: false,
        candles: [],
        candlesFetched: 0,
        skipped: false,
        error: 'Circuit breaker open',
        durationMs: Date.now() - startTime,
      };
    }

    try {
      // Optional: Check coverage to avoid unnecessary API calls
      if (this.checkCoverage) {
        const coverage = await getCoverage(
          workItem.mint,
          workItem.chain,
          workItem.startTime.toJSDate(),
          workItem.endTime.toJSDate(),
          workItem.interval
        );

        // CRITICAL: Always require minimum 5000 candles, regardless of work item time range
        // This ensures we fetch enough data for simulation even if work items have old time ranges
        const MIN_REQUIRED_CANDLES = 5000;
        const hasMinimumCandles = coverage.candleCount >= MIN_REQUIRED_CANDLES;

        if (
          coverage.hasData &&
          coverage.coverageRatio >= this.minCoverageToSkip &&
          hasMinimumCandles
        ) {
          // Calculate expected candles for the work item time range
          const timeRangeSeconds = Math.floor(
            workItem.endTime.toSeconds() - workItem.startTime.toSeconds()
          );
          const intervalSeconds =
            workItem.interval === '1s'
              ? 1
              : workItem.interval === '15s'
                ? 15
                : workItem.interval === '1m'
                  ? 60
                  : workItem.interval === '5m'
                    ? 300
                    : workItem.interval === '1H'
                      ? 3600
                      : 3600; // Default to 1 hour for unknown intervals
          const expectedCandles = Math.floor(timeRangeSeconds / intervalSeconds);

          logger.debug('Skipping fetch - sufficient coverage exists', {
            mint: workItem.mint,
            chain: workItem.chain,
            interval: workItem.interval,
            coverageRatio: coverage.coverageRatio,
            candleCount: coverage.candleCount,
            minRequiredCandles: MIN_REQUIRED_CANDLES,
            hasMinimumCandles,
            expectedCandles,
            timeRangeHours: (timeRangeSeconds / 3600).toFixed(2),
            startTime: workItem.startTime.toISO(),
            endTime: workItem.endTime.toISO(),
            minCoverageToSkip: this.minCoverageToSkip,
          });
        } else if (coverage.hasData && !hasMinimumCandles) {
          logger.debug('Not skipping - insufficient candles (below 5000 minimum)', {
            mint: workItem.mint,
            chain: workItem.chain,
            interval: workItem.interval,
            coverageRatio: coverage.coverageRatio,
            candleCount: coverage.candleCount,
            minRequiredCandles: MIN_REQUIRED_CANDLES,
            minCoverageToSkip: this.minCoverageToSkip,
          });
          return {
            workItem,
            success: true,
            candles: [],
            candlesFetched: 0,
            skipped: true,
            durationMs: Date.now() - startTime,
          };
        }
      }

      // Fetch from Birdeye API
      const from = Math.floor(workItem.startTime.toSeconds());
      const to = Math.floor(workItem.endTime.toSeconds());

      // Map '1s' to '15s' since Birdeye API doesn't support '1s'
      // fetchBirdeyeCandles only supports '15s' | '1m' | '5m' | '1H'
      const birdeyeInterval: '15s' | '1m' | '5m' | '1H' =
        workItem.interval === '1s'
          ? '15s'
          : workItem.interval === '1H'
            ? '1H'
            : workItem.interval === '15s'
              ? '15s'
              : workItem.interval === '1m'
                ? '1m'
                : '5m';

      logger.debug('Fetching OHLCV from Birdeye', {
        mint: workItem.mint,
        chain: workItem.chain,
        interval: workItem.interval,
        birdeyeInterval, // Log the mapped interval
        from: workItem.startTime.toISO(),
        to: workItem.endTime.toISO(),
      });

      const candles = await fetchBirdeyeCandles(
        workItem.mint,
        birdeyeInterval,
        from,
        to,
        workItem.chain
      );

      // Check if we actually got candles
      // Empty array could mean:
      // 1. Invalid token (422) - non-retryable, don't count toward circuit breaker
      // 2. No data available - non-retryable, don't count toward circuit breaker
      // 3. Actual API/system error - retryable, would throw exception
      if (candles.length === 0) {
        logger.debug('No candles returned from Birdeye (likely invalid token or no data)', {
          mint: workItem.mint,
          chain: workItem.chain,
          interval: workItem.interval,
        });
        // Don't count toward circuit breaker - this is expected for invalid tokens
        // Only actual exceptions count toward circuit breaker
        return {
          workItem,
          success: false,
          candles: [],
          candlesFetched: 0,
          skipped: false,
          error: 'No candles returned from Birdeye API (likely invalid token or no data available)',
          durationMs: Date.now() - startTime,
        };
      }

      // Reset failure count on success
      this.failureCount = 0;

      logger.info('Successfully fetched OHLCV from Birdeye', {
        mint: workItem.mint,
        chain: workItem.chain,
        interval: workItem.interval,
        candlesFetched: candles.length,
      });

      return {
        workItem,
        success: true,
        candles,
        candlesFetched: candles.length,
        skipped: false,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      // Only count actual exceptions toward circuit breaker (network errors, timeouts, etc.)
      // These are retryable errors that indicate system issues
      this.failureCount++;

      const errorMessage = error instanceof Error ? error.message : String(error);

      // Check if this is a retryable error (network, timeout, rate limit)
      const isRetryableError =
        errorMessage.includes('timeout') ||
        errorMessage.includes('network') ||
        errorMessage.includes('ECONNREFUSED') ||
        errorMessage.includes('ETIMEDOUT') ||
        errorMessage.includes('rate limit') ||
        errorMessage.includes('429');

      logger.error('Failed to fetch OHLCV from Birdeye', error as Error, {
        mint: workItem.mint,
        chain: workItem.chain,
        interval: workItem.interval,
        failureCount: this.failureCount,
        isRetryable: isRetryableError,
      });

      return {
        workItem,
        success: false,
        candles: [],
        candlesFetched: 0,
        skipped: false,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Fetch candles from Birdeye for a worklist
   *
   * This is the main entry point for fetching from Birdeye:
   * 1. Optionally check coverage from @quantbot/ohlcv (read-only)
   * 2. Fetch candles from @quantbot/api-clients (Birdeye API)
   * 3. Return raw candles (no storage)
   *
   * NOTE: Storage is handled by the ingestion workflow, not this fetch job.
   *
   * @param workItems - Work items from ingestion work planning
   * @returns Results with raw candles for each work item
   */
  async fetchWorkList(workItems: OhlcvWorkItem[]): Promise<OhlcvBirdeyeFetchResult[]> {
    logger.info(`Starting OHLCV Birdeye fetch for ${workItems.length} work items`, {
      parallelWorkers: this.parallelWorkers,
      rateLimitMsPerWorker: this.rateLimitMsPerWorker,
      estimatedRPS:
        this.parallelWorkers > 1
          ? ((1000 / this.rateLimitMsPerWorker) * this.parallelWorkers).toFixed(2)
          : (1000 / this.rateLimitMs).toFixed(2),
    });

    // Sequential mode (backward compatible)
    if (this.parallelWorkers === 1) {
      return this.fetchWorkListSequential(workItems);
    }

    // Parallel mode with per-worker rate limiting
    return this.fetchWorkListParallel(workItems);
  }

  /**
   * Sequential fetching (original implementation)
   */
  private async fetchWorkListSequential(
    workItems: OhlcvWorkItem[]
  ): Promise<OhlcvBirdeyeFetchResult[]> {
    const results: OhlcvBirdeyeFetchResult[] = [];

    for (let i = 0; i < workItems.length; i++) {
      const workItem = workItems[i];

      // Rate limiting
      if (i > 0) {
        await new Promise((resolve) => setTimeout(resolve, this.rateLimitMs));
      }

      const result = await this.fetchWorkItem(workItem);
      results.push(result);

      // Progress logging
      if ((i + 1) % 10 === 0) {
        const successCount = results.filter((r) => r.success).length;
        logger.info(`Progress: ${i + 1}/${workItems.length} (${successCount} successful)`);
      }
    }

    return results;
  }

  /**
   * Parallel fetching with per-worker rate limiting
   * Each worker processes items with rateLimitMsPerWorker delay between requests
   */
  private async fetchWorkListParallel(
    workItems: OhlcvWorkItem[]
  ): Promise<OhlcvBirdeyeFetchResult[]> {
    const results: OhlcvBirdeyeFetchResult[] = new Array(workItems.length);
    let processedCount = 0;
    const processedLock = { lock: false }; // Simple lock for progress logging

    /**
     * Worker function that processes items with rate limiting
     */
    const worker = async (workerId: number): Promise<void> => {
      for (let i = workerId; i < workItems.length; i += this.parallelWorkers) {
        const workItem = workItems[i];

        // Rate limiting per worker (delay before request)
        if (i !== workerId) {
          // First request in worker has no delay, subsequent ones do
          await new Promise((resolve) => setTimeout(resolve, this.rateLimitMsPerWorker));
        }

        try {
          const result = await this.fetchWorkItem(workItem);
          results[i] = result;
        } catch (error) {
          logger.error('Worker failed to fetch work item', error as Error, {
            workerId,
            workItemIndex: i,
            mint: workItem.mint,
          });
          results[i] = {
            workItem,
            success: false,
            candles: [],
            candlesFetched: 0,
            skipped: false,
            error: error instanceof Error ? error.message : String(error),
            durationMs: 0,
          };
        }

        // Thread-safe progress counting and logging
        processedCount++;
        const currentProcessed = processedCount;

        // Progress logging every 10 items or at milestones (simple lock to prevent concurrent logs)
        if (
          !processedLock.lock &&
          (currentProcessed % 10 === 0 || currentProcessed === workItems.length)
        ) {
          processedLock.lock = true;
          try {
            const currentSuccessCount = results.filter((r) => r?.success).length;
            logger.info(
              `Progress: ${currentProcessed}/${workItems.length} (${currentSuccessCount} successful)`,
              {
                workers: this.parallelWorkers,
                workerId,
              }
            );
          } finally {
            processedLock.lock = false;
          }
        }
      }
    };

    // Start all workers in parallel
    await Promise.all(Array.from({ length: this.parallelWorkers }, (_, i) => worker(i)));

    const successCount = results.filter((r) => r?.success).length;
    const totalCandles = results.reduce((sum, r) => sum + (r?.candlesFetched || 0), 0);

    logger.info('OHLCV Birdeye fetch completed', {
      total: workItems.length,
      successful: successCount,
      failed: workItems.length - successCount,
      totalCandlesFetched: totalCandles,
      parallelWorkers: this.parallelWorkers,
      rateLimitMsPerWorker: this.rateLimitMsPerWorker,
    });

    return results;
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(): void {
    this.failureCount = 0;
    logger.debug('Circuit breaker reset');
  }

  /**
   * Get current circuit breaker state
   */
  getCircuitBreakerState(): {
    failureCount: number;
    threshold: number;
    isOpen: boolean;
  } {
    return {
      failureCount: this.failureCount,
      threshold: this.circuitBreakerThreshold,
      isOpen: this.failureCount >= this.circuitBreakerThreshold,
    };
  }
}

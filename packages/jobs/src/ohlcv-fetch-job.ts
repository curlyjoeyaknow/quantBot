/**
 * OHLCV Fetch Job
 * ================
 *
 * Online orchestration job for fetching OHLCV candles from Birdeye API
 * and storing them in ClickHouse.
 *
 * This is the ONLY place where network calls for OHLCV data are allowed.
 *
 * Happy Path Flow:
 * 1. Get worklist from @quantbot/ingestion (offline work planning)
 * 2. Optionally check coverage from @quantbot/ohlcv (read-only, to avoid refetch)
 * 3. Fetch candles from @quantbot/api-clients (Birdeye API)
 * 4. Store candles in ClickHouse via @quantbot/storage
 * 5. Optionally update metadata via @quantbot/ingestion (offline bookkeeping)
 *
 * Responsibilities:
 * - Take worklist items from ingestion
 * - Optionally check coverage from ohlcv (read-only)
 * - Call @quantbot/api-clients to fetch from Birdeye
 * - Enforce rate limits and circuit breakers
 * - Write candles to ClickHouse (idempotent upsert)
 * - Emit metrics
 */

import { logger } from '@quantbot/utils';
import { fetchBirdeyeCandles } from '@quantbot/api-clients';
import { storeCandles, getCoverage } from '@quantbot/ohlcv';
import type { OhlcvWorkItem } from '@quantbot/ingestion';

/**
 * Result of fetching candles for a work item
 */
export interface OhlcvFetchResult {
  workItem: OhlcvWorkItem;
  success: boolean;
  candlesFetched: number;
  candlesStored: number;
  error?: string;
  durationMs: number;
}

/**
 * Options for OHLCV fetch job
 */
export interface OhlcvFetchJobOptions {
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
 * OHLCV Fetch Job
 *
 * Unit-of-work executor: Fetches candles from Birdeye API and stores in ClickHouse.
 *
 * Architecture (Data-plane executor):
 * - This job performs the effectful unit of work: fetch (online) + store (storage)
 * - Each work item is processed independently: fetch → upsert → return summary
 * - Parallel execution: Multiple workers process work items concurrently
 * - Idempotent: ClickHouse ORDER BY key (token_address, chain, timestamp, interval) ensures
 *   duplicate inserts are deduplicated (or use ReplacingMergeTree for true upserts)
 *
 * Responsibilities:
 * - Enforce rate limits and circuit breakers (Birdeye API)
 * - Check coverage to avoid unnecessary fetches
 * - Fetch from Birdeye API (online boundary)
 * - Upsert to ClickHouse (storage layer, idempotent)
 * - Return structured results for workflow aggregation
 *
 * Note: This job does NOT update DuckDB metadata - that's handled by the workflow
 * (control-plane) after all unit-of-work jobs complete.
 */
export class OhlcvFetchJob {
  private rateLimitMs: number;
  private parallelWorkers: number;
  private rateLimitMsPerWorker: number;
  private maxRetries: number;
  private circuitBreakerThreshold: number;
  private checkCoverage: boolean;
  private minCoverageToSkip: number;
  private failureCount: number = 0;

  constructor(options: OhlcvFetchJobOptions = {}) {
    this.rateLimitMs = options.rateLimitMs ?? 100;
    this.parallelWorkers = options.parallelWorkers ?? 1;
    this.rateLimitMsPerWorker = options.rateLimitMsPerWorker ?? 330;
    this.maxRetries = options.maxRetries ?? 3;
    this.circuitBreakerThreshold = options.circuitBreakerThreshold ?? 10;
    this.checkCoverage = options.checkCoverage ?? true;
    this.minCoverageToSkip = options.minCoverageToSkip ?? 0.95;
  }

  /**
   * Fetch candles for a single work item
   */
  async fetchWorkItem(workItem: OhlcvWorkItem): Promise<OhlcvFetchResult> {
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
        candlesFetched: 0,
        candlesStored: 0,
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

        if (coverage.hasData && coverage.coverageRatio >= this.minCoverageToSkip) {
          logger.debug('Skipping fetch - sufficient coverage exists', {
            mint: workItem.mint.substring(0, 20),
            chain: workItem.chain,
            interval: workItem.interval,
            coverageRatio: coverage.coverageRatio,
            candleCount: coverage.candleCount,
          });
          return {
            workItem,
            success: true,
            candlesFetched: 0,
            candlesStored: 0,
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
        mint: workItem.mint.substring(0, 20),
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

      if (candles.length === 0) {
        logger.debug('No candles returned from Birdeye', {
          mint: workItem.mint.substring(0, 20),
        });
        return {
          workItem,
          success: true,
          candlesFetched: 0,
          candlesStored: 0,
          durationMs: Date.now() - startTime,
        };
      }

      // Store in ClickHouse (idempotent upsert)
      await storeCandles(workItem.mint, workItem.chain, candles, workItem.interval);

      // Reset failure count on success
      this.failureCount = 0;

      logger.info('Successfully fetched and stored OHLCV', {
        mint: workItem.mint.substring(0, 20),
        chain: workItem.chain,
        interval: workItem.interval,
        candlesFetched: candles.length,
        candlesStored: candles.length,
      });

      return {
        workItem,
        success: true,
        candlesFetched: candles.length,
        candlesStored: candles.length,
        durationMs: Date.now() - startTime,
      };
    } catch (error) {
      this.failureCount++;

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to fetch OHLCV', error as Error, {
        mint: workItem.mint.substring(0, 20),
        chain: workItem.chain,
        interval: workItem.interval,
        failureCount: this.failureCount,
      });

      return {
        workItem,
        success: false,
        candlesFetched: 0,
        candlesStored: 0,
        error: errorMessage,
        durationMs: Date.now() - startTime,
      };
    }
  }

  /**
   * Fetch candles for a worklist from ingestion
   *
   * This is the main entry point following the happy path:
   * 1. Worklist comes from @quantbot/ingestion (offline work planning)
   * 2. Optionally check coverage from @quantbot/ohlcv (read-only)
   * 3. Fetch candles from @quantbot/api-clients (Birdeye API)
   * 4. Store candles in ClickHouse via @quantbot/storage
   *
   * @param workItems - Work items from ingestion work planning
   * @returns Results for each work item
   */
  async fetchWorkList(workItems: OhlcvWorkItem[]): Promise<OhlcvFetchResult[]> {
    logger.info(`Starting OHLCV fetch job for ${workItems.length} work items`, {
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
  private async fetchWorkListSequential(workItems: OhlcvWorkItem[]): Promise<OhlcvFetchResult[]> {
    const results: OhlcvFetchResult[] = [];

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
  private async fetchWorkListParallel(workItems: OhlcvWorkItem[]): Promise<OhlcvFetchResult[]> {
    const results: OhlcvFetchResult[] = new Array(workItems.length);
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
            mint: workItem.mint.substring(0, 20),
          });
          results[i] = {
            workItem,
            success: false,
            candlesFetched: 0,
            candlesStored: 0,
            error: error instanceof Error ? error.message : String(error),
            durationMs: 0,
          };
        }

        // Thread-safe progress counting and logging
        const currentProcessed = results.filter((r) => r !== undefined).length;

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
    const totalCandles = results.reduce((sum, r) => sum + (r?.candlesStored || 0), 0);

    logger.info('OHLCV fetch job completed', {
      total: workItems.length,
      successful: successCount,
      failed: workItems.length - successCount,
      totalCandlesStored: totalCandles,
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

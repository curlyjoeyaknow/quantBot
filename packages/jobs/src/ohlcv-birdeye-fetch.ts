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

import { DateTime } from 'luxon';
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
   * @default 100
   */
  rateLimitMs?: number;

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
  private maxRetries: number;
  private circuitBreakerThreshold: number;
  private checkCoverage: boolean;
  private minCoverageToSkip: number;
  private failureCount: number = 0;

  constructor(options: OhlcvBirdeyeFetchOptions = {}) {
    this.rateLimitMs = options.rateLimitMs ?? 100;
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

      logger.debug('Fetching OHLCV from Birdeye', {
        mint: workItem.mint.substring(0, 20),
        chain: workItem.chain,
        interval: workItem.interval,
        from: workItem.startTime.toISO(),
        to: workItem.endTime.toISO(),
      });

      const candles = await fetchBirdeyeCandles(
        workItem.mint,
        workItem.interval,
        from,
        to,
        workItem.chain
      );

      // Reset failure count on success
      this.failureCount = 0;

      logger.info('Successfully fetched OHLCV from Birdeye', {
        mint: workItem.mint.substring(0, 20),
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
      this.failureCount++;

      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Failed to fetch OHLCV from Birdeye', error as Error, {
        mint: workItem.mint.substring(0, 20),
        chain: workItem.chain,
        interval: workItem.interval,
        failureCount: this.failureCount,
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
    const results: OhlcvBirdeyeFetchResult[] = [];

    logger.info(`Starting OHLCV Birdeye fetch for ${workItems.length} work items`);

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

    const successCount = results.filter((r) => r.success).length;
    const totalCandles = results.reduce((sum, r) => sum + r.candlesFetched, 0);

    logger.info('OHLCV Birdeye fetch completed', {
      total: workItems.length,
      successful: successCount,
      failed: workItems.length - successCount,
      totalCandlesFetched: totalCandles,
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

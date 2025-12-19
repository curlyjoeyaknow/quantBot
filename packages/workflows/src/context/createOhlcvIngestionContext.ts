/**
 * Create WorkflowContext for OHLCV ingestion
 *
 * Extends the base WorkflowContext with:
 * - jobs.ohlcvBirdeyeFetch: Fetch candles from Birdeye API (fetch only)
 * - duckdbStorage: Update DuckDB metadata (ingestion)
 *
 * Terminology:
 * - "fetch" = API call to Birdeye (returns candles)
 * - "ingestion" = storing in ClickHouse + updating DuckDB metadata
 */

import {
  createProductionContext,
  type ProductionContextConfig,
} from './createProductionContext.js';
// Dynamic import to avoid build-time dependency
// import { OhlcvBirdeyeFetch } from '@quantbot/jobs';
// Using type assertion to bypass module resolution
type OhlcvBirdeyeFetch = any;
import { DuckDBStorageService } from '@quantbot/simulation';
import { getPythonEngine, ConfigurationError } from '@quantbot/utils';
import type { IngestOhlcvContext } from '../ohlcv/ingestOhlcv.js';
import type { WorkflowContext } from '../types.js';

export interface OhlcvIngestionContextConfig extends ProductionContextConfig {
  /**
   * Optional OHLCV Birdeye fetch service (for testing)
   */
  ohlcvBirdeyeFetch?: OhlcvBirdeyeFetch;

  /**
   * Optional DuckDB storage service (for testing)
   */
  duckdbStorage?: DuckDBStorageService;
}

/**
 * Create WorkflowContext for OHLCV ingestion with fetch and storage services
 */
export function createOhlcvIngestionContext(
  config?: OhlcvIngestionContextConfig
): IngestOhlcvContext {
  const baseContext: WorkflowContext = createProductionContext(config);

  // Create OhlcvBirdeyeFetch instance (or use provided one for testing)
  // TODO: Use dynamic import when jobs package is properly referenced
  if (!config?.ohlcvBirdeyeFetch) {
    throw new ConfigurationError(
      'OhlcvBirdeyeFetch service is required in config - jobs package must be available',
      'ohlcvBirdeyeFetch',
      { hasOhlcvBirdeyeFetch: !!config?.ohlcvBirdeyeFetch }
    );
  }
  const fetchService = config.ohlcvBirdeyeFetch;
  const duckdbStorage = config?.duckdbStorage ?? new DuckDBStorageService(getPythonEngine());

  return {
    ...baseContext,
    jobs: {
      ohlcvBirdeyeFetch: {
        async fetchWorkList(worklist) {
          const results = await fetchService.fetchWorkList(worklist);
          // Convert to workflow format
          return results.map(
            (r: {
              workItem: unknown;
              success: boolean;
              candles: unknown[];
              candlesFetched: number;
              skipped: boolean;
              error?: string;
              durationMs: number;
            }) => ({
              workItem: r.workItem,
              success: r.success,
              candles: r.candles,
              candlesFetched: r.candlesFetched,
              skipped: r.skipped,
              error: r.error,
              durationMs: r.durationMs,
            })
          );
        },
      },
    },
    duckdbStorage: {
      async updateOhlcvMetadata(
        duckdbPath,
        mint,
        alertTimestamp,
        intervalSeconds,
        timeRangeStart,
        timeRangeEnd,
        candleCount
      ) {
        return duckdbStorage.updateOhlcvMetadata(
          duckdbPath,
          mint,
          alertTimestamp,
          intervalSeconds,
          timeRangeStart,
          timeRangeEnd,
          candleCount
        );
      },
    },
  };
}

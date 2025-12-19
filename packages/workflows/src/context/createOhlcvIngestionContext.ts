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
import { OhlcvBirdeyeFetch } from '@quantbot/jobs';
import { DuckDBStorageService } from '@quantbot/simulation';
import { getPythonEngine } from '@quantbot/utils';
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

  const fetchService = config?.ohlcvBirdeyeFetch ?? new OhlcvBirdeyeFetch();
  const duckdbStorage =
    config?.duckdbStorage ?? new DuckDBStorageService(getPythonEngine());

  return {
    ...baseContext,
    jobs: {
      ohlcvBirdeyeFetch: {
        async fetchWorkList(worklist) {
          const results = await fetchService.fetchWorkList(worklist);
          // Convert to workflow format
          return results.map((r) => ({
            workItem: r.workItem,
            success: r.success,
            candles: r.candles,
            candlesFetched: r.candlesFetched,
            skipped: r.skipped,
            error: r.error,
            durationMs: r.durationMs,
          }));
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

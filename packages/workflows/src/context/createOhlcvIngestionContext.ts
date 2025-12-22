/**
 * Create WorkflowContext for OHLCV ingestion
 *
 * Uses ports for all external dependencies:
 * - ports.marketData: Fetch candles from market data provider
 * - ports.state: Idempotency checks
 * - ports.telemetry: Events and metrics
 * - duckdbStorage: Update DuckDB metadata (ingestion)
 *
 * Terminology:
 * - "fetch" = API call via market data port
 * - "store" = storing in ClickHouse (via @quantbot/ohlcv)
 * - "ingestion" = updating DuckDB metadata (this workflow)
 */

import {
  createProductionContextWithPorts,
  type ProductionContextConfig,
} from './createProductionContext.js';
import { DuckDBStorageService } from '@quantbot/simulation';
import { getPythonEngine } from '@quantbot/utils';
import type { IngestOhlcvContext } from '../ohlcv/ingestOhlcv.js';

export interface OhlcvIngestionContextConfig extends ProductionContextConfig {
  /**
   * Optional DuckDB storage service (for testing)
   */
  duckdbStorage?: DuckDBStorageService;
}

/**
 * Create WorkflowContext for OHLCV ingestion with ports
 */
export async function createOhlcvIngestionContext(
  config?: OhlcvIngestionContextConfig
): Promise<IngestOhlcvContext> {
  const baseContext = await createProductionContextWithPorts(config);
  const duckdbStorage = config?.duckdbStorage ?? new DuckDBStorageService(getPythonEngine());

  return {
    ...baseContext,
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

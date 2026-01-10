/**
 * Create WorkflowContext for OHLCV ingestion
 *
 * Uses ports for all external dependencies:
 * - ports.marketData: Fetch candles from market data provider
 * - ports.state: Idempotency checks and metadata storage
 * - ports.telemetry: Events and metrics
 * - ports.clock: Time source
 *
 * Terminology:
 * - "fetch" = API call via market data port
 * - "store" = storing in ClickHouse (via @quantbot/ohlcv)
 * - "ingestion" = workflow orchestration + metadata updates (via ports.state)
 */

import {
  createProductionContextWithPorts,
  type ProductionContextConfig,
} from './createProductionContext.js';
import { logger as utilsLogger } from '@quantbot/utils';
import type { IngestOhlcvContext } from '../ohlcv/ingestOhlcv.js';

/**
 * Create WorkflowContext for OHLCV ingestion with ports
 *
 * Uses REAL port adapters (StatePort, MarketDataPort, etc.) with configurable paths.
 * For tests, pass duckdbPath to use a temporary file.
 */
export async function createOhlcvIngestionContext(
  config?: ProductionContextConfig & {
    /**
     * Optional DuckDB path override (for testing - uses temp file)
     */
    duckdbPath?: string;
  }
): Promise<IngestOhlcvContext> {
  const baseContext = await createProductionContextWithPorts(config);

  return {
    ...baseContext,
    logger: {
      info: (msg: string, ctx?: unknown) =>
        utilsLogger.info(msg, ctx as Record<string, unknown> | undefined),
      warn: (msg: string, ctx?: unknown) =>
        utilsLogger.warn(msg, ctx as Record<string, unknown> | undefined),
      error: (msg: string, ctx?: unknown) =>
        utilsLogger.error(msg, ctx as Record<string, unknown> | undefined),
      debug: (msg: string, ctx?: unknown) =>
        utilsLogger.debug(msg, ctx as Record<string, unknown> | undefined),
    },
  };
}

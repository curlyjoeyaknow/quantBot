/**
 * Create Storage Stats Workflow Context
 *
 * Provides ClickHouse and optional DuckDB query access for storage statistics.
 */

import { DateTime } from 'luxon';
import { logger as utilsLogger } from '@quantbot/utils';
import type { StorageStatsContext } from '../storage/getStorageStats.js';
import type { OhlcvStatsContext } from '../storage/getOhlcvStats.js';
import { createProductionContextWithPorts } from './createProductionContext.js';

export interface StorageStatsContextConfig {
  logger?: {
    info: (message: string, context?: unknown) => void;
    warn: (message: string, context?: unknown) => void;
    error: (message: string, context?: unknown) => void;
    debug?: (message: string, context?: unknown) => void;
  };
  clock?: {
    nowISO: () => string;
  };
  duckdbQuery?: (dbPath: string, query: string) => Promise<Array<Record<string, unknown>>>;
}

/**
 * Create storage stats context with ports (QueryPort for ClickHouse) and optional DuckDB access
 */
export async function createStorageStatsContext(
  config?: StorageStatsContextConfig
): Promise<StorageStatsContext> {
  const baseContext = await createProductionContextWithPorts();

  const logger = config?.logger ?? {
    info: (msg: string, ctx?: unknown) =>
      utilsLogger.info(msg, ctx as Record<string, unknown> | undefined),
    warn: (msg: string, ctx?: unknown) =>
      utilsLogger.warn(msg, ctx as Record<string, unknown> | undefined),
    error: (msg: string, ctx?: unknown) =>
      utilsLogger.error(msg, ctx as Record<string, unknown> | undefined),
    debug: (msg: string, ctx?: unknown) =>
      utilsLogger.debug(msg, ctx as Record<string, unknown> | undefined),
  };

  const clock = config?.clock ?? { nowISO: () => DateTime.utc().toISO()! };

  // DuckDB query helper (optional)
  const duckdbQuery = config?.duckdbQuery ? { query: config.duckdbQuery } : undefined;

  return {
    ...baseContext,
    logger,
    clock,
    duckdb: duckdbQuery,
  };
}

/**
 * Create OHLCV stats context (simpler, just ClickHouse via QueryPort)
 */
export async function createOhlcvStatsContext(
  config?: StorageStatsContextConfig
): Promise<OhlcvStatsContext> {
  const baseContext = await createStorageStatsContext(config);
  return {
    ...baseContext,
  };
}

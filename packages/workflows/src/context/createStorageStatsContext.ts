/**
 * Create Storage Stats Workflow Context
 *
 * Provides ClickHouse and optional DuckDB query access for storage statistics.
 */

import { DateTime } from 'luxon';
import { logger as utilsLogger } from '@quantbot/utils';
import { getClickHouseClient } from '@quantbot/storage';
import type { ClickHouseClient } from '@clickhouse/client';
import type { StorageStatsContext } from '../storage/getStorageStats.js';
import type { OhlcvStatsContext } from '../storage/getOhlcvStats.js';

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
  clickHouseClient?: ClickHouseClient;
  duckdbQuery?: (dbPath: string, query: string) => Promise<Array<Record<string, unknown>>>;
}

/**
 * Create storage stats context with ClickHouse and optional DuckDB access
 */
export function createStorageStatsContext(config?: StorageStatsContextConfig): StorageStatsContext {
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

  const clickHouseClient = config?.clickHouseClient ?? getClickHouseClient();

  // ClickHouse query helper
  const clickHouseQuery = async (query: string): Promise<Array<Record<string, unknown>>> => {
    const result = await clickHouseClient.query({
      query,
      format: 'JSONEachRow',
    });
    return (await result.json()) as Array<Record<string, unknown>>;
  };

  // DuckDB query helper (optional)
  const duckdbQuery = config?.duckdbQuery ? { query: config.duckdbQuery } : undefined;

  return {
    clock,
    ids: { newRunId: () => `run_${DateTime.utc().toUnixInteger()}` },
    logger,
    repos: {
      strategies: { getByName: async () => null },
      calls: { list: async () => [] },
      simulationRuns: { create: async () => {} },
      simulationResults: { insertMany: async () => {} },
    },
    ohlcv: {
      getCandles: async () => [],
    },
    simulation: {
      run: async () => {
        throw new Error('Simulation not available in storage stats context');
      },
    },
    storage: {
      clickHouse: {
        query: clickHouseQuery,
      },
      duckdb: duckdbQuery,
    },
  };
}

/**
 * Create OHLCV stats context (simpler, just ClickHouse)
 */
export function createOhlcvStatsContext(config?: StorageStatsContextConfig): OhlcvStatsContext {
  const baseContext = createStorageStatsContext(config);
  return {
    ...baseContext,
    storage: {
      clickHouse: baseContext.storage.clickHouse,
    },
  };
}

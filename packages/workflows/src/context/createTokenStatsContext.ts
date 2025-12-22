/**
 * Create Token Stats Workflow Context
 *
 * Provides ClickHouse and DuckDB access for token statistics.
 */

import { resolve } from 'path';
import { DateTime } from 'luxon';
import { logger as utilsLogger } from '@quantbot/utils';
import { getClickHouseClient } from '@quantbot/storage';
import type { ClickHouseClient } from '@clickhouse/client';
import type { TokenStatsContext } from '../storage/getTokenStats.js';

export interface TokenStatsContextConfig {
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
  duckdbPath?: string;
}

/**
 * Create token stats context with ClickHouse and DuckDB access
 */
export function createTokenStatsContext(config?: TokenStatsContextConfig): TokenStatsContext {
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
        throw new Error('Simulation not available in token stats context');
      },
    },
    storage: {
      clickHouse: {
        query: clickHouseQuery,
      },
    },
    duckdb: {
      path: (() => {
        const rawPath = config?.duckdbPath || process.env.DUCKDB_PATH || 'data/tele.duckdb';
        return rawPath.startsWith('/') ? rawPath : resolve(process.cwd(), rawPath);
      })(),
    },
  };
}

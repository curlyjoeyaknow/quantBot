/**
 * Create Token Stats Workflow Context
 *
 * Provides ClickHouse and DuckDB access for token statistics.
 */

import { resolve } from 'path';
import { DateTime } from 'luxon';
import { logger as utilsLogger } from '@quantbot/utils';
import type { TokenStatsContext } from '../storage/getTokenStats.js';
import { createProductionContextWithPorts } from './createProductionContext.js';

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
  duckdbPath?: string;
}

/**
 * Create token stats context with ports (QueryPort for ClickHouse) and DuckDB access
 */
export async function createTokenStatsContext(config?: TokenStatsContextConfig): Promise<TokenStatsContext> {
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

  return {
    ...baseContext,
    logger,
    clock,
    duckdb: {
      path: (() => {
        const rawPath = config?.duckdbPath || process.env.DUCKDB_PATH || 'data/tele.duckdb';
        return rawPath.startsWith('/') ? rawPath : resolve(process.cwd(), rawPath);
      })(),
    },
  };
}

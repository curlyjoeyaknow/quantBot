/**
 * OHLCV Statistics Workflow
 *
 * Gets comprehensive OHLCV statistics from ClickHouse.
 */

import { z } from 'zod';
import { DateTime } from 'luxon';
import type { WorkflowContext } from '../types.js';

/**
 * OHLCV stats spec
 */
export const GetOhlcvStatsSpecSchema = z.object({
  chain: z.enum(['solana', 'ethereum', 'bsc', 'base']).optional(),
  interval: z.enum(['1m', '5m', '15m', '1h', '4h', '1d']).optional(),
  mint: z.string().optional(),
});

export type GetOhlcvStatsSpec = z.infer<typeof GetOhlcvStatsSpecSchema>;

/**
 * OHLCV stats result
 */
export type GetOhlcvStatsResult = {
  timestamp: string; // ISO string
  chain?: string;
  interval?: string;
  mint?: string;
  totalCandles: number;
  uniqueTokens: number;
  dateRange: {
    earliest: string; // ISO string
    latest: string; // ISO string
  };
  intervals: Array<{
    interval: string;
    candleCount: number;
    tokenCount: number;
  }>;
  chains: Array<{
    chain: string;
    candleCount: number;
    tokenCount: number;
  }>;
  topTokens: Array<{
    token_address: string;
    chain: string;
    candleCount: number;
    firstSeen: string; // ISO string
    lastSeen: string; // ISO string
  }>;
};

/**
 * Extended context for OHLCV stats
 */
export type OhlcvStatsContext = WorkflowContext & {
  storage: {
    clickHouse: {
      query: (query: string) => Promise<Array<Record<string, unknown>>>;
    };
  };
};

/**
 * Get OHLCV statistics workflow
 */
export async function getOhlcvStats(
  spec: GetOhlcvStatsSpec,
  ctx: OhlcvStatsContext = createDefaultOhlcvStatsContext()
): Promise<GetOhlcvStatsResult> {
  const validated = GetOhlcvStatsSpecSchema.parse(spec);
  const timestamp = ctx.clock.nowISO();
  const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';

  // Build WHERE clause
  const conditions: string[] = [];
  if (validated.chain) {
    const escapedChain = validated.chain.replace(/'/g, "''");
    conditions.push(`chain = '${escapedChain}'`);
  }
  if (validated.interval) {
    const escapedInterval = validated.interval.replace(/'/g, "''");
    conditions.push(`\`interval\` = '${escapedInterval}'`);
  }
  if (validated.mint) {
    const escapedMint = validated.mint.replace(/'/g, "''");
    conditions.push(`token_address = '${escapedMint}'`);
  }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Total candles
  const totalResult = await ctx.storage.clickHouse.query(
    `SELECT COUNT(*) as count FROM ${database}.ohlcv_candles ${whereClause}`
  );
  const totalCandles = parseInt(String(totalResult[0]?.['count'] || 0), 10);

  // Unique tokens
  const uniqueResult = await ctx.storage.clickHouse.query(
    `SELECT COUNT(DISTINCT token_address) as count FROM ${database}.ohlcv_candles ${whereClause}`
  );
  const uniqueTokens = parseInt(String(uniqueResult[0]?.['count'] || 0), 10);

  // Date range
  const rangeResult = await ctx.storage.clickHouse.query(
    `SELECT MIN(timestamp) as min, MAX(timestamp) as max FROM ${database}.ohlcv_candles ${whereClause}`
  );
  const minTs = rangeResult[0]?.['min'];
  const maxTs = rangeResult[0]?.['max'];
  const earliest = minTs
    ? typeof minTs === 'string'
      ? minTs
      : DateTime.fromSeconds(minTs as number).toISO()!
    : timestamp;
  const latest = maxTs
    ? typeof maxTs === 'string'
      ? maxTs
      : DateTime.fromSeconds(maxTs as number).toISO()!
    : timestamp;

  // Intervals breakdown
  const intervalsResult = await ctx.storage.clickHouse.query(
    `SELECT 
      \`interval\`,
      COUNT(*) as candle_count,
      COUNT(DISTINCT token_address) as token_count
    FROM ${database}.ohlcv_candles
    ${whereClause}
    GROUP BY \`interval\`
    ORDER BY candle_count DESC`
  );
  const intervals = intervalsResult.map((row) => ({
    interval: String(row['interval'] || ''),
    candleCount: parseInt(String(row['candle_count'] || 0), 10),
    tokenCount: parseInt(String(row['token_count'] || 0), 10),
  }));

  // Chains breakdown
  const chainsResult = await ctx.storage.clickHouse.query(
    `SELECT 
      chain,
      COUNT(*) as candle_count,
      COUNT(DISTINCT token_address) as token_count
    FROM ${database}.ohlcv_candles
    ${whereClause}
    GROUP BY chain
    ORDER BY candle_count DESC`
  );
  const chains = chainsResult.map((row) => ({
    chain: String(row['chain'] || ''),
    candleCount: parseInt(String(row['candle_count'] || 0), 10),
    tokenCount: parseInt(String(row['token_count'] || 0), 10),
  }));

  // Top tokens
  const topTokensResult = await ctx.storage.clickHouse.query(
    `SELECT 
      token_address,
      chain,
      COUNT(*) as candle_count,
      MIN(timestamp) as first_seen,
      MAX(timestamp) as last_seen
    FROM ${database}.ohlcv_candles
    ${whereClause}
    GROUP BY token_address, chain
    ORDER BY candle_count DESC
    LIMIT 10`
  );
  const topTokens = topTokensResult.map((row) => {
    const firstSeen = row['first_seen'];
    const lastSeen = row['last_seen'];
    return {
      token_address: String(row['token_address'] || ''),
      chain: String(row['chain'] || ''),
      candleCount: parseInt(String(row['candle_count'] || 0), 10),
      firstSeen: firstSeen
        ? typeof firstSeen === 'string'
          ? firstSeen
          : DateTime.fromSeconds(firstSeen as number).toISO()!
        : timestamp,
      lastSeen: lastSeen
        ? typeof lastSeen === 'string'
          ? lastSeen
          : DateTime.fromSeconds(lastSeen as number).toISO()!
        : timestamp,
    };
  });

  return {
    timestamp,
    chain: validated.chain,
    interval: validated.interval,
    mint: validated.mint,
    totalCandles,
    uniqueTokens,
    dateRange: {
      earliest,
      latest,
    },
    intervals,
    chains,
    topTokens,
  };
}

/**
 * Create default context for testing
 */
function createDefaultOhlcvStatsContext(): OhlcvStatsContext {
  throw new Error('OhlcvStatsContext must be provided - no default implementation');
}

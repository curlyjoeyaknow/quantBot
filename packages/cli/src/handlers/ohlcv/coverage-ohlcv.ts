/**
 * Handler for ohlcv coverage command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * Checks OHLCV data coverage for tokens.
 */

import { DateTime } from 'luxon';
import type { CommandContext } from '../../core/command-context.js';
import { coverageSchema } from '../../commands/ohlcv.js';
import type { z } from 'zod';
import { validateMintAddress } from '../../core/argument-parser.js';
import { getClickHouseClient } from '@quantbot/storage';

export type CoverageOhlcvArgs = z.infer<typeof coverageSchema>;

/**
 * Handler function: pure use-case orchestration
 */
export async function coverageOhlcvHandler(
  args: CoverageOhlcvArgs,
  _ctx: CommandContext
): Promise<{
  mint?: string;
  interval?: string;
  totalCandles: number;
  dateRange?: {
    earliest: string;
    latest: string;
  };
  chains: string[];
  intervals: string[];
}> {
  const client = getClickHouseClient();
  const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

  // Build query based on filters
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (args.mint) {
    const mintAddress = validateMintAddress(args.mint);
    conditions.push(`(token_address = {mint:String} OR lower(token_address) = lower({mint:String}))`);
    params.mint = mintAddress;
  }

  if (args.interval) {
    conditions.push(`\`interval\` = {interval:String}`);
    params.interval = args.interval;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Get total candle count
  const countQuery = `
    SELECT COUNT(*) as count
    FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
    ${whereClause}
  `;

  const countResult = await client.query({
    query: countQuery,
    query_params: params,
    format: 'JSONEachRow',
  });
  const countData = (await countResult.json()) as { count: string }[];
  const totalCandles = countData[0] ? parseInt(countData[0].count, 10) : 0;

  // Get date range
  const dateRangeQuery = `
    SELECT 
      MIN(timestamp) as earliest,
      MAX(timestamp) as latest
    FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
    ${whereClause}
  `;

  let dateRange: { earliest: string; latest: string } | undefined;
  if (totalCandles > 0) {
    const dateResult = await client.query({
      query: dateRangeQuery,
      query_params: params,
      format: 'JSONEachRow',
    });
    const dateData = (await dateResult.json()) as {
      earliest: string;
      latest: string;
    }[];
    if (dateData[0]) {
      dateRange = {
        earliest: dateData[0].earliest,
        latest: dateData[0].latest,
      };
    }
  }

  // Get distinct chains
  const chainsQuery = `
    SELECT DISTINCT chain
    FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
    ${whereClause}
  `;
  const chainsResult = await client.query({
    query: chainsQuery,
    query_params: params,
    format: 'JSONEachRow',
  });
  const chainsData = (await chainsResult.json()) as { chain: string }[];
  const chains = chainsData.map((row) => row.chain);

  // Get distinct intervals
  const intervalsQuery = `
    SELECT DISTINCT \`interval\`
    FROM ${CLICKHOUSE_DATABASE}.ohlcv_candles
    ${whereClause}
  `;
  const intervalsResult = await client.query({
    query: intervalsQuery,
    query_params: params,
    format: 'JSONEachRow',
  });
  const intervalsData = (await intervalsResult.json()) as { interval: string }[];
  const intervals = intervalsData.map((row) => row.interval);

  return {
    mint: args.mint,
    interval: args.interval,
    totalCandles,
    dateRange,
    chains,
    intervals,
  };
}


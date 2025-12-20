/**
 * Handler for listing unique tokens command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * No Commander, no console.log, no process.exit, no env reads.
 */

import type { CommandContext } from '../../core/command-context.js';
import { DatabaseError } from '@quantbot/utils';

/**
 * Input arguments (already validated by Zod)
 */
export type ListTokensArgs = {
  chain?: 'solana' | 'ethereum' | 'bsc' | 'base';
  source?: 'ohlcv' | 'metadata';
  format?: 'json' | 'table' | 'csv';
  limit?: number;
};

/**
 * Handler function: pure use-case orchestration
 */
export async function listTokensHandler(
  args: ListTokensArgs,
  ctx: CommandContext
): Promise<Array<Record<string, unknown>>> {
  const client = ctx.services.clickHouseClient();
  const database = process.env.CLICKHOUSE_DATABASE || 'quantbot';
  const source = args.source || 'ohlcv';
  const chain = args.chain || 'solana';
  const limit = args.limit || 1000;

  // Escape chain for SQL injection prevention
  const escapedChain = chain.replace(/'/g, "''");

  let query: string;
  if (source === 'ohlcv') {
    // Get unique tokens from ohlcv_candles
    query = `
      SELECT 
        token_address,
        chain,
        COUNT(*) as candle_count,
        MIN(timestamp) as first_seen,
        MAX(timestamp) as last_seen
      FROM ${database}.ohlcv_candles
      WHERE chain = '${escapedChain}'
      GROUP BY token_address, chain
      ORDER BY candle_count DESC
      LIMIT ${limit}
    `;
  } else {
    // Get unique tokens from token_metadata
    query = `
      SELECT 
        token_address,
        chain,
        COUNT(*) as snapshot_count,
        MIN(timestamp) as first_seen,
        MAX(timestamp) as last_seen
      FROM ${database}.token_metadata
      WHERE chain = '${escapedChain}'
      GROUP BY token_address, chain
      ORDER BY snapshot_count DESC
      LIMIT ${limit}
    `;
  }

  try {
    const result = await client.query({
      query,
      format: 'JSONEachRow',
    });

    const data = (await result.json()) as Array<{
      token_address: string;
      chain: string;
      candle_count?: number;
      snapshot_count?: number;
      first_seen: string;
      last_seen: string;
    }>;

    return data.map((row) => ({
      token_address: row.token_address,
      chain: row.chain,
      count: row.candle_count ?? row.snapshot_count ?? 0,
      first_seen: row.first_seen,
      last_seen: row.last_seen,
    }));
  } catch (error) {
    throw new DatabaseError(`Failed to query tokens: ${(error as Error).message}`, 'list_tokens', {
      source,
      chain,
      limit,
    });
  }
}

/**
 * CLI Composition Root for Listing Tokens
 *
 * This is a composition root - it's allowed to:
 * - Read process.env
 * - Do I/O
 */

import type { CommandContext } from '../../core/command-context.js';
import process from 'node:process';

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
 * CLI handler for listing tokens
 *
 * This function can:
 * - Read process.env ✅
 * - Do I/O ✅
 */
export async function listTokensHandler(
  args: ListTokensArgs,
  ctx: CommandContext
): Promise<Array<Record<string, unknown>>> {
  const client = ctx.services.clickHouseClient();

  // ENV LIVE HERE (composition root)
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
      SELECT DISTINCT
        token_address as mint,
        chain,
        min(timestamp) as first_seen,
        max(timestamp) as last_seen,
        count(*) as candle_count
      FROM ${database}.ohlcv
      WHERE chain = '${escapedChain}'
      GROUP BY token_address, chain
      ORDER BY first_seen DESC
      LIMIT ${limit}
    `;
  } else {
    // Get unique tokens from token_metadata
    query = `
      SELECT DISTINCT
        token_address as mint,
        chain,
        symbol,
        name,
        decimals
      FROM ${database}.token_metadata
      WHERE chain = '${escapedChain}'
      ORDER BY token_address
      LIMIT ${limit}
    `;
  }

  const result = await client.query({
    query,
    format: 'JSONEachRow',
  });
  const rows = (await result.json()) as Array<Record<string, unknown>>;

  return rows;
}

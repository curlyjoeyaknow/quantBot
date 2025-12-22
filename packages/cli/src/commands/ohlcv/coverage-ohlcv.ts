/**
 * CLI Composition Root for OHLCV Coverage Query
 *
 * This is a composition root - it's allowed to:
 * - Read process.env
 * - Do I/O
 */

import type { CommandContext } from '../../core/command-context.js';
import { coverageSchema } from '../../commands/ohlcv.js';
import type { z } from 'zod';
import process from 'node:process';
import { validateMintAddress } from '../../core/argument-parser.js';

export type CoverageOhlcvArgs = z.infer<typeof coverageSchema>;

/**
 * CLI handler for OHLCV coverage query
 *
 * This function can:
 * - Read process.env ✅
 * - Do I/O ✅
 */
export async function coverageOhlcvHandler(
  args: CoverageOhlcvArgs,
  ctx: CommandContext
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
  // Use factory to get client (no direct singleton access)
  const client = ctx.services.clickHouseClient();

  // ENV LIVE HERE (composition root)
  const CLICKHOUSE_DATABASE = process.env.CLICKHOUSE_DATABASE || 'quantbot';

  // Build query based on filters (using string interpolation with proper escaping)
  const conditions: string[] = [];

  if (args.mint) {
    const mintAddress = validateMintAddress(args.mint);
    const escapedMint = mintAddress.replace(/'/g, "''");
    conditions.push(
      `(token_address = '${escapedMint}' OR lower(token_address) = lower('${escapedMint}'))`
    );
  }

  if (args.interval) {
    const escapedInterval = args.interval.replace(/'/g, "''");
    conditions.push(`\`interval\` = '${escapedInterval}'`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Query for total candles and date range
  const statsQuery = `
    SELECT
      count(*) as total_candles,
      min(timestamp) as earliest,
      max(timestamp) as latest,
      groupArray(DISTINCT chain) as chains,
      groupArray(DISTINCT \`interval\`) as intervals
    FROM ${CLICKHOUSE_DATABASE}.ohlcv
    ${whereClause}
  `;

  const statsResult = await client.query(statsQuery);
  const stats = statsResult.json<{
    total_candles: number;
    earliest: string;
    latest: string;
    chains: string[];
    intervals: string[];
  }>();

  return {
    mint: args.mint,
    interval: args.interval,
    totalCandles: Number(stats.total_candles || 0),
    dateRange:
      stats.earliest && stats.latest
        ? {
            earliest: stats.earliest,
            latest: stats.latest,
          }
        : undefined,
    chains: stats.chains || [],
    intervals: stats.intervals || [],
  };
}

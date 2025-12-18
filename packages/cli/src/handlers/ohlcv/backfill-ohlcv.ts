/**
 * Handler for ohlcv backfill command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * Backfills OHLCV data for a specific mint address and date range.
 */

import { DateTime } from 'luxon';
import type { CommandContext } from '../../core/command-context.js';
import { backfillSchema } from '../../commands/ohlcv.js';
import { z } from 'zod';
import { validateMintAddress } from '../../core/argument-parser.js';
import { getOhlcvIngestionEngine } from '@quantbot/ohlcv';
import type { Chain } from '@quantbot/core';
import { ValidationError } from '@quantbot/utils';

export type BackfillOhlcvArgs = z.infer<typeof backfillSchema>;

/**
 * Handler function: pure use-case orchestration
 */
export async function backfillOhlcvHandler(
  args: BackfillOhlcvArgs,
  _ctx: CommandContext
): Promise<{
  mint: string;
  chain: string;
  interval: string;
  from: string;
  to: string;
  candlesFetched1m: number;
  candlesFetched5m: number;
  success: boolean;
  error?: string;
}> {
  // Validate and preserve mint address case
  const mintAddress = validateMintAddress(args.mint);

  // Parse dates
  const fromDate = DateTime.fromISO(args.from, { zone: 'utc' });
  const toDate = DateTime.fromISO(args.to, { zone: 'utc' });

  if (!fromDate.isValid) {
    throw new ValidationError(`Invalid from date: ${args.from}`, { from: args.from });
  }
  if (!toDate.isValid) {
    throw new ValidationError(`Invalid to date: ${args.to}`, { to: args.to });
  }
  if (fromDate >= toDate) {
    throw new ValidationError('From date must be before to date', {
      from: args.from,
      to: args.to,
    });
  }

  // Use the ingestion engine to fetch candles
  // Note: fetchCandles uses alertTime to determine fetch windows, so we use the start date
  const engine = getOhlcvIngestionEngine();
  await engine.initialize();

  try {
    const result = await engine.fetchCandles(mintAddress, args.chain as Chain, fromDate, {
      useCache: true,
      forceRefresh: false,
    });

    return {
      mint: mintAddress,
      chain: args.chain,
      interval: args.interval,
      from: args.from,
      to: args.to,
      candlesFetched1m: result.metadata.total1mCandles,
      candlesFetched5m: result.metadata.total5mCandles,
      success: true,
    };
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      mint: mintAddress,
      chain: args.chain,
      interval: args.interval,
      from: args.from,
      to: args.to,
      candlesFetched1m: 0,
      candlesFetched5m: 0,
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Ingest Market Data Handler
 *
 * Fetches market creation data and token creation info from Birdeye API
 * for all tokens in the database and stores them in ClickHouse.
 */

import type { CommandContext } from '../../core/command-context.js';
import type { z } from 'zod';
import { ingestMarketDataSchema } from '../../commands/ingestion.js';
import { MarketDataIngestionService } from '@quantbot/data/jobs';

export type IngestMarketDataArgs = z.infer<typeof ingestMarketDataSchema>;

/**
 * CLI handler for ingesting market data
 */
export async function ingestMarketDataHandler(args: IngestMarketDataArgs, ctx: CommandContext) {
  const service = ctx.services.marketDataIngestion();
  return service.ingestForAllTokens({
    chain: args.chain,
    limit: args.limit,
    skipExisting: args.skipExisting,
  });
}

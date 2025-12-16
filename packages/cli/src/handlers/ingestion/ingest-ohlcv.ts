/**
 * Handler for ingestion ohlcv command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * No Commander, no console.log, no process.exit, no env reads.
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { ohlcvSchema } from '../../commands/ingestion.js';

/**
 * Input arguments (already validated by Zod)
 */
export type IngestOhlcvArgs = z.infer<typeof ohlcvSchema>;

/**
 * Handler function: pure use-case orchestration
 */
export async function ingestOhlcvHandler(
  args: IngestOhlcvArgs,
  ctx: CommandContext
) {
  const service = ctx.services.ohlcvIngestion();

  // Note: interval is accepted in args but not currently passed to service
  // as OhlcvIngestionService.ingestForCalls doesn't support it yet.
  // The service uses its internal strategy (1m + 5m candles).
  // This is kept for future compatibility and validation.
  return service.ingestForCalls({
    from: args.from ? new Date(args.from) : undefined,
    to: args.to ? new Date(args.to) : undefined,
    preWindowMinutes: args.preWindow,
    postWindowMinutes: args.postWindow,
  });
}


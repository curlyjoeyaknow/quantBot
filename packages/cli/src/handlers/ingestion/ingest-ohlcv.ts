/**
 * Handler for ingestion ohlcv command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * No Commander, no console.log, no process.exit, no env reads.
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { ohlcvSchema } from '../../commands/ingestion.js';
import { readQueue, removeFromQueue } from '../../core/ohlcv-queue.js';

/**
 * Input arguments (already validated by Zod)
 */
export type IngestOhlcvArgs = z.infer<typeof ohlcvSchema>;

/**
 * Handler function: pure use-case orchestration
 * 
 * Prioritizes queued items (from simulation failures) before processing worklist.
 * After successful ingestion, removes items from queue.
 */
export async function ingestOhlcvHandler(args: IngestOhlcvArgs, ctx: CommandContext) {
  const service = ctx.services.ohlcvIngestion();

  // Read queue for prioritized items
  const queue = await readQueue();
  
  // Pass queue items to service for prioritization
  const result = await service.ingestForCalls({
    from: args.from ? new Date(args.from) : undefined,
    to: args.to ? new Date(args.to) : undefined,
    preWindowMinutes: args.preWindow,
    postWindowMinutes: args.postWindow,
    duckdbPath: args.duckdb,
    interval: args.interval,
    candles: args.candles,
    startOffsetMinutes: args.startOffsetMinutes,
    queueItems: queue, // Pass queue for prioritization
  } as any);

  // Remove successfully processed items from queue
  const processed = (result as any).queueItemsProcessed;
  if (processed && processed.length > 0) {
    for (const item of processed) {
      await removeFromQueue(item.mint, item.alertTimestamp);
    }
  }

  return result;
}

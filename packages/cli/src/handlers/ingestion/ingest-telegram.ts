/**
 * Handler for ingestion telegram command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * No Commander, no console.log, no process.exit, no env reads.
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { telegramSchema } from '../../commands/ingestion.js';

/**
 * Input arguments (already validated by Zod)
 */
export type IngestTelegramArgs = z.infer<typeof telegramSchema>;

/**
 * Handler function: pure use-case orchestration
 */
export async function ingestTelegramHandler(args: IngestTelegramArgs, ctx: CommandContext) {
  const service = ctx.services.telegramIngestion();

  return service.ingestExport({
    filePath: args.file,
    callerName: args.callerName,
    chain: args.chain,
    chatId: args.chatId,
  });
}

/**
 * Handler for ingestion telegram-python command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * Uses TelegramPipelineService to run the DuckDB pipeline tool.
 */

import type { CommandContext } from '../../core/command-context.js';
import { telegramProcessSchema } from '../../commands/ingestion.js';
import type { z } from 'zod';
import type { TelegramPipelineResult } from '@quantbot/data/ingestion';

export type ProcessTelegramPythonArgs = z.infer<typeof telegramProcessSchema>;

/**
 * Handler function: pure use-case orchestration
 */
export async function processTelegramPythonHandler(
  args: ProcessTelegramPythonArgs,
  ctx: CommandContext
): Promise<TelegramPipelineResult> {
  const service = ctx.services.telegramPipeline();

  // chatId is optional - Python script will extract from file or default to "single_chat"
  // Use a longer timeout (30 minutes) for large Telegram exports that may take time to process
  return await service.runPipeline(
    args.file,
    args.outputDb,
    args.chatId,
    args.rebuild,
    { timeout: 30 * 60 * 1000 } // 30 minutes timeout
  );
}

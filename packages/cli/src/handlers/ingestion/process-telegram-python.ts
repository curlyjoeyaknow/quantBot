/**
 * Handler for ingestion telegram-python command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * Uses TelegramPipelineService to run the DuckDB pipeline tool.
 */

import type { CommandContext } from '../../core/command-context.js';
import { telegramProcessSchema } from '../../commands/ingestion.js';
import type { z } from 'zod';
import type { TelegramPipelineResult } from '@quantbot/ingestion';

export type ProcessTelegramPythonArgs = z.infer<typeof telegramProcessSchema>;

/**
 * Handler function: pure use-case orchestration
 */
export async function processTelegramPythonHandler(
  args: ProcessTelegramPythonArgs,
  ctx: CommandContext
): Promise<TelegramPipelineResult> {
  const service = ctx.services.telegramPipeline();

  return await service.runPipeline(args.file, args.outputDb, args.chatId, args.rebuild);
}

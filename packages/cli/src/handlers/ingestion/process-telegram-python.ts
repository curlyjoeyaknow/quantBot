/**
 * Handler for ingestion telegram-python command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * Uses PythonEngine to run the DuckDB pipeline tool.
 */

import type { CommandContext } from '../../core/command-context.js';
import { telegramProcessSchema } from '../../commands/ingestion.js';
import type { z } from 'zod';
import type { PythonManifest } from '@quantbot/utils';

export type ProcessTelegramPythonArgs = z.infer<typeof telegramProcessSchema>;

/**
 * Handler function: pure use-case orchestration
 */
export async function processTelegramPythonHandler(
  args: ProcessTelegramPythonArgs,
  ctx: CommandContext
): Promise<PythonManifest> {
  const engine = ctx.services.pythonEngine();

  return await engine.runTelegramPipeline({
    inputFile: args.file,
    outputDb: args.outputDb,
    chatId: args.chatId,
    rebuild: args.rebuild,
  });
}

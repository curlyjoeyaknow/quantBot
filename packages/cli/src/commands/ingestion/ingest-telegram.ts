/**
 * CLI Composition Root for Telegram Ingestion
 *
 * This is a composition root - it's allowed to:
 * - Read process.env
 * - Do I/O
 * - Wire adapters
 */

import type { z } from 'zod';
import process from 'node:process';
import type { CommandContext } from '../../core/command-context.js';
import { telegramSchema } from '../../commands/ingestion.js';
import { ingestTelegramJson } from '@quantbot/workflows';
import { createProductionContextWithPorts } from '@quantbot/workflows';
import { CallersRepository, TokenDataRepository } from '@quantbot/storage';

/**
 * Input arguments (already validated by Zod)
 */
export type IngestTelegramArgs = z.infer<typeof telegramSchema>;

/**
 * CLI handler for telegram ingestion
 *
 * This function can:
 * - Read process.env ✅
 * - Do I/O ✅
 * - Wire adapters ✅
 */
export async function ingestTelegramHandler(args: IngestTelegramArgs, _ctx: CommandContext) {
  // ENV + ADAPTER WIRING LIVE HERE (composition root)
  const dbPath = process.env.DUCKDB_PATH || 'data/alerts.duckdb';
  const workflowContext = await createProductionContextWithPorts({ duckdbPath: dbPath });

  // Add DuckDB repositories to context
  const callersRepo = new CallersRepository(dbPath);
  const tokenDataRepo = new TokenDataRepository(dbPath);

  // Call workflow instead of service
  return ingestTelegramJson(
    {
      filePath: args.file,
      callerName: args.callerName,
      chain: args.chain,
      chatId: args.chatId,
    },
    {
      ...workflowContext,
      repos: {
        ...workflowContext.repos,
        callers: callersRepo,
        tokenData: tokenDataRepo,
      },
    }
  );
}

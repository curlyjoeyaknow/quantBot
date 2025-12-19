/**
 * Handler for ingestion telegram command
 *
 * Pure use-case function: takes validated args and context, returns data.
 * No Commander, no console.log, no process.exit, no env reads.
 *
 * Uses ingestTelegramJson workflow instead of direct service calls.
 */

import type { z } from 'zod';
import type { CommandContext } from '../../core/command-context.js';
import { telegramSchema } from '../../commands/ingestion.js';
import { ingestTelegramJson } from '@quantbot/workflows';
import { createProductionContext } from '@quantbot/workflows';
import { CallersRepository, TokenDataRepository } from '@quantbot/storage';

/**
 * Input arguments (already validated by Zod)
 */
export type IngestTelegramArgs = z.infer<typeof telegramSchema>;

/**
 * Handler function: pure use-case orchestration
 * Uses workflow instead of direct service calls
 */
export async function ingestTelegramHandler(args: IngestTelegramArgs, ctx: CommandContext) {
  // Create workflow context with DuckDB repositories
  const dbPath = process.env.DUCKDB_PATH || 'data/quantbot.db';
  const workflowContext = createProductionContext();

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

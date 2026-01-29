/**
 * CLI Handler: Ingest Telegram Alerts
 *
 * Pure CLI handler for ingesting Telegram alerts as artifacts.
 * Depends on ports only, no console.log, no process.exit.
 *
 * @packageDocumentation
 */

import type { CommandContext } from '../../core/command-context.js';
import {
  ingestTelegramAlertsHandler,
  type IngestTelegramAlertsArgs,
  type IngestTelegramAlertsResult,
} from '@quantbot/ingestion';

/**
 * CLI handler for ingesting Telegram alerts
 *
 * @param args - Ingestion arguments
 * @param ctx - Command context
 * @returns Ingestion result
 */
export async function ingestTelegramAlertsCLIHandler(
  args: IngestTelegramAlertsArgs,
  ctx: CommandContext
): Promise<IngestTelegramAlertsResult> {
  // Get artifact store from context
  const artifactStore = ctx.services.artifactStore();

  // Execute ingestion handler
  return await ingestTelegramAlertsHandler(args, artifactStore);
}


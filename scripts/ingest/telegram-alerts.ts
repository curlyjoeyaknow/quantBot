#!/usr/bin/env ts-node

/**
 * CLI script for ingesting Telegram export files
 * 
 * Usage:
 *   ts-node scripts/ingest/telegram-alerts.ts --file <path> --caller-name <name> [--chain SOL] [--chat-id <id>]
 */

// @ts-ignore - commander types may not be installed yet
import { program } from 'commander';
import {
  CallersRepository,
  TokensRepository,
  AlertsRepository,
  CallsRepository,
} from '@quantbot/storage';
import { TelegramAlertIngestionService } from '@quantbot/ingestion';
import { logger } from '@quantbot/utils';

// Initialize repositories
const callersRepo = new CallersRepository();
const tokensRepo = new TokensRepository();
const alertsRepo = new AlertsRepository();
const callsRepo = new CallsRepository();

// Initialize service
const ingestionService = new TelegramAlertIngestionService(
  callersRepo,
  tokensRepo,
  alertsRepo,
  callsRepo
);

program
  .name('telegram-alerts')
  .description('Ingest Telegram export files into Postgres')
  .requiredOption('--file <path>', 'Path to Telegram HTML export file')
  .requiredOption('--caller-name <name>', 'Name of the caller (e.g., Brook, Lsy)')
  .option('--chain <chain>', 'Blockchain (default: SOL)', 'SOL')
  .option('--chat-id <id>', 'Chat ID (optional, will be extracted from file if not provided)')
  .action(async (options) => {
    try {
      logger.info('Starting Telegram ingestion', options);

      const result = await ingestionService.ingestExport({
        filePath: options.file,
        callerName: options.callerName,
        chain: options.chain as 'SOL',
        chatId: options.chatId,
      });

      console.log('\n✅ Ingestion complete!');
      console.log(`   Alerts inserted: ${result.alertsInserted}`);
      console.log(`   Calls inserted: ${result.callsInserted}`);
      console.log(`   Tokens upserted: ${result.tokensUpserted}`);

      process.exit(0);
    } catch (error) {
      logger.error('Ingestion failed', error as Error);
      console.error('\n❌ Ingestion failed:', (error as Error).message);
      process.exit(1);
    }
  });

program.parse();


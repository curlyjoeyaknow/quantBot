#!/usr/bin/env ts-node

/**
 * CLI script for ingesting Telegram call exports
 *
 * Extracts token calls from Telegram chat exports by:
 * 1. Finding bot messages (Rick/Phanes)
 * 2. Extracting metadata from bot responses
 * 3. Resolving caller messages via reply_to references
 * 4. Validating in small chunks
 * 5. Storing in Postgres
 *
 * Usage:
 *   ts-node scripts/ingest/telegram-calls.ts --file <path> [--caller-name <name>] [--chain <chain>] [--chunk-size <size>]
 *   ts-node scripts/ingest/telegram-calls.ts --dir <directory> [--caller-name <name>] [--chain <chain>]
 */

import { program } from 'commander';
import {
  CallersRepository,
  TokensRepository,
  AlertsRepository,
  CallsRepository,
} from '@quantbot/storage';
import { TelegramCallIngestionService } from '@quantbot/ingestion';
import { logger } from '@quantbot/utils';
import * as fs from 'fs';
import * as path from 'path';

// Initialize repositories
const callersRepo = new CallersRepository();
const tokensRepo = new TokensRepository();
const alertsRepo = new AlertsRepository();
const callsRepo = new CallsRepository();

// Initialize service
const ingestionService = new TelegramCallIngestionService(
  callersRepo,
  tokensRepo,
  alertsRepo,
  callsRepo
);

/**
 * Process a single file
 */
async function processFile(
  filePath: string,
  options: {
    callerName?: string;
    chain?: string;
    chunkSize?: number;
  }
): Promise<void> {
  try {
    console.log(`\n📄 Processing: ${path.basename(filePath)}`);
    console.log('─'.repeat(80));

    const result = await ingestionService.ingestExport({
      filePath,
      callerName: options.callerName,
      chain: options.chain as any,
      chunkSize: options.chunkSize,
    });

    console.log(`\n✅ Completed: ${path.basename(filePath)}`);
    console.log(`   Bot messages found: ${result.botMessagesFound}`);
    console.log(`   Bot messages processed: ${result.botMessagesProcessed}`);
    console.log(`   Alerts inserted: ${result.alertsInserted}`);
    console.log(`   Calls inserted: ${result.callsInserted}`);
    console.log(`   Tokens upserted: ${result.tokensUpserted}`);
    if (result.messagesFailed > 0) {
      console.log(`   ⚠️  Messages failed: ${result.messagesFailed}`);
    }
  } catch (error) {
    logger.error(`Error processing ${filePath}`, error as Error);
    console.error(`\n❌ Error processing ${filePath}:`, (error as Error).message);
    throw error;
  }
}

/**
 * Process all HTML files in a directory
 */
async function processDirectory(
  dirPath: string,
  options: {
    callerName?: string;
    chain?: string;
    chunkSize?: number;
  }
): Promise<void> {
  const files = fs
    .readdirSync(dirPath)
    .filter((file) => file.endsWith('.html') || file.endsWith('.htm'))
    .map((file) => path.join(dirPath, file))
    .sort();

  console.log(`\n📂 Found ${files.length} HTML files in ${dirPath}\n`);

  let totalAlerts = 0;
  let totalCalls = 0;
  let totalTokens = 0;
  let totalFailed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    console.log(`\n[${i + 1}/${files.length}] Processing ${path.basename(file)}...`);

    try {
      const result = await ingestionService.ingestExport({
        filePath: file,
        callerName: options.callerName,
        chain: options.chain as any,
        chunkSize: options.chunkSize,
      });

      totalAlerts += result.alertsInserted;
      totalCalls += result.callsInserted;
      totalTokens += result.tokensUpserted;
      totalFailed += result.messagesFailed;

      console.log(`   ✅ ${result.alertsInserted} alerts, ${result.callsInserted} calls`);
    } catch (error) {
      totalFailed++;
      logger.error(`Error processing ${file}`, error as Error);
      console.error(`   ❌ Failed: ${(error as Error).message}`);
    }
  }

  console.log(`\n${'='.repeat(80)}`);
  console.log('📊 SUMMARY');
  console.log(`${'='.repeat(80)}`);
  console.log(`Files processed: ${files.length}`);
  console.log(`Total alerts inserted: ${totalAlerts}`);
  console.log(`Total calls inserted: ${totalCalls}`);
  console.log(`Total tokens upserted: ${totalTokens}`);
  if (totalFailed > 0) {
    console.log(`Total messages failed: ${totalFailed}`);
  }
  console.log(`${'='.repeat(80)}\n`);
}

program
  .name('telegram-calls')
  .description('Ingest Telegram call exports into Postgres')
  .option('--file <path>', 'Path to single HTML export file')
  .option('--dir <directory>', 'Path to directory containing HTML export files')
  .option('--caller-name <name>', 'Default caller name (if not found in messages)')
  .option('--chain <chain>', 'Default chain (solana, ethereum, base, bsc)', 'solana')
  .option('--chunk-size <size>', 'Chunk size for validation (default: 10)', '10')
  .action(async (options) => {
    try {
      if (options.file) {
        if (!fs.existsSync(options.file)) {
          console.error(`❌ File not found: ${options.file}`);
          process.exit(1);
        }
        await processFile(options.file, {
          callerName: options.callerName,
          chain: options.chain,
          chunkSize: parseInt(options.chunkSize, 10),
        });
      } else if (options.dir) {
        if (!fs.existsSync(options.dir)) {
          console.error(`❌ Directory not found: ${options.dir}`);
          process.exit(1);
        }
        await processDirectory(options.dir, {
          callerName: options.callerName,
          chain: options.chain,
          chunkSize: parseInt(options.chunkSize, 10),
        });
      } else {
        console.error('❌ Must specify either --file or --dir');
        program.help();
        process.exit(1);
      }

      console.log('\n✅ Ingestion complete!\n');
      process.exit(0);
    } catch (error) {
      logger.error('Ingestion failed', error as Error);
      console.error('\n❌ Ingestion failed:', (error as Error).message);
      process.exit(1);
    }
  });

program.parse();

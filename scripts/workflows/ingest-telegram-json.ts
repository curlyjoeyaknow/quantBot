#!/usr/bin/env ts-node

/**
 * CLI script for ingesting Telegram JSON exports via workflow
 *
 * Uses the ingestTelegramJson workflow to:
 * 1. Normalize JSON exports
 * 2. Extract bot messages and caller data
 * 3. Store alerts and calls in Postgres
 *
 * Usage:
 *   ts-node -r tsconfig-paths/register scripts/workflows/ingest-telegram-json.ts --file <path> [options]
 *   ts-node -r tsconfig-paths/register scripts/workflows/ingest-telegram-json.ts --dir <directory> [options]
 */

// Register tsconfig paths for workspace package resolution
import 'tsconfig-paths/register';

import { program } from 'commander';
// Import from dist to avoid ES module issues with ts-node
import { ingestTelegramJson, createProductionContext } from '../../packages/workflows/dist/index';
import {
  CallersRepository,
  TokensRepository,
  AlertsRepository,
  CallsRepository,
} from '@quantbot/storage';
import { logger } from '@quantbot/utils';
import * as fs from 'fs';
import * as path from 'path';

// Initialize repositories
const callersRepo = new CallersRepository();
const tokensRepo = new TokensRepository();
const alertsRepo = new AlertsRepository();
const callsRepo = new CallsRepository();

// Create production context with ingestion repos
const baseContext = createProductionContext();

const context = {
  ...baseContext,
  repos: {
    ...baseContext.repos,
    callers: callersRepo,
    tokens: tokensRepo,
    alerts: alertsRepo,
    calls: Object.assign(callsRepo, {
      list: baseContext.repos.calls.list.bind(baseContext.repos.calls),
    }),
  },
} as any; // Type assertion needed due to complex intersection types

/**
 * Process a single JSON file
 */
async function processFile(
  filePath: string,
  options: {
    chatId?: string;
    callerName?: string;
    chain?: string;
    chunkSize?: number;
    writeStreams?: boolean;
    outputDir?: string;
  }
): Promise<void> {
  try {
    console.log(`\n📄 Processing: ${path.basename(filePath)}`);
    console.log('─'.repeat(80));

    const result = await ingestTelegramJson(
      {
        filePath,
        chatId: options.chatId,
        callerName: options.callerName,
        chain: options.chain as any,
        chunkSize: options.chunkSize,
        writeStreams: options.writeStreams,
        outputDir: options.outputDir,
      },
      context
    );

    console.log(`\n✅ Completed: ${path.basename(filePath)}`);
    console.log(`   Total processed: ${result.totalProcessed}`);
    console.log(`   Normalized: ${result.normalized}`);
    console.log(`   Quarantined: ${result.quarantined}`);
    console.log(`   Bot messages found: ${result.botMessagesFound}`);
    console.log(`   Bot messages processed: ${result.botMessagesProcessed}`);
    console.log(`   Alerts inserted: ${result.alertsInserted}`);
    console.log(`   Calls inserted: ${result.callsInserted}`);
    console.log(`   Tokens upserted: ${result.tokensUpserted}`);

    if (result.quarantined > 0) {
      console.log(`   ⚠️  ${result.quarantined} messages quarantined`);
    }

    if (result.messagesFailed > 0) {
      console.log(`   ⚠️  ${result.messagesFailed} messages failed`);
    }

    if (result.streamResult) {
      if (result.streamResult.normalizedPath) {
        console.log(`   📝 Normalized: ${result.streamResult.normalizedPath}`);
      }
      if (result.streamResult.quarantinePath) {
        console.log(`   ⚠️  Quarantine: ${result.streamResult.quarantinePath}`);
      }
    }
  } catch (error) {
    logger.error(`Error processing ${filePath}`, error as Error);
    console.error(`\n❌ Error processing ${filePath}:`, (error as Error).message);
    throw error;
  }
}

/**
 * Process all JSON files in a directory
 */
async function processDirectory(
  dirPath: string,
  options: {
    chatId?: string;
    callerName?: string;
    chain?: string;
    chunkSize?: number;
    writeStreams?: boolean;
    outputDir?: string;
  }
): Promise<void> {
  const files = fs
    .readdirSync(dirPath)
    .filter((file) => file.endsWith('.json'))
    .map((file) => path.join(dirPath, file))
    .sort();

  console.log(`\n📂 Found ${files.length} JSON files in ${dirPath}\n`);

  let totalProcessed = 0;
  let totalNormalized = 0;
  let totalQuarantined = 0;
  let totalBotMessages = 0;
  let totalAlerts = 0;
  let totalCalls = 0;
  let totalTokens = 0;
  let totalFailed = 0;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    console.log(`\n[${i + 1}/${files.length}] Processing ${path.basename(file)}...`);

    try {
      const result = await ingestTelegramJson(
        {
          filePath: file,
          chatId: options.chatId,
          callerName: options.callerName,
          chain: options.chain as any,
          chunkSize: options.chunkSize,
          writeStreams: options.writeStreams,
          outputDir: options.outputDir,
        },
        context
      );

      totalProcessed += result.totalProcessed;
      totalNormalized += result.normalized;
      totalQuarantined += result.quarantined;
      totalBotMessages += result.botMessagesFound;
      totalAlerts += result.alertsInserted;
      totalCalls += result.callsInserted;
      totalTokens += result.tokensUpserted;
      totalFailed += result.messagesFailed;

      console.log(`   ✅ ${result.normalized} normalized, ${result.quarantined} quarantined`);
      console.log(`   📊 ${result.alertsInserted} alerts, ${result.callsInserted} calls`);
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
  console.log(`Total messages processed: ${totalProcessed}`);
  console.log(`Total normalized: ${totalNormalized}`);
  console.log(`Total quarantined: ${totalQuarantined}`);
  console.log(`Total bot messages found: ${totalBotMessages}`);
  console.log(`Total alerts inserted: ${totalAlerts}`);
  console.log(`Total calls inserted: ${totalCalls}`);
  console.log(`Total tokens upserted: ${totalTokens}`);
  if (totalQuarantined > 0) {
    console.log(`\n⚠️  ${totalQuarantined} messages quarantined - check quarantine files for details`);
  }
  if (totalFailed > 0) {
    console.log(`⚠️  ${totalFailed} files failed`);
  }
  console.log(`${'='.repeat(80)}\n`);
}

program
  .name('ingest-telegram-json')
  .description('Ingest Telegram JSON exports via workflow (normalize -> validate -> store)')
  .option('--file <path>', 'Path to JSON export file')
  .option('--dir <directory>', 'Path to directory containing JSON export files')
  .option('--chat-id <id>', 'Chat ID (optional, will be extracted from export if not provided)')
  .option('--caller-name <name>', 'Default caller name (if not found in messages)')
  .option('--chain <chain>', 'Default chain (solana, ethereum, base, bsc)', 'solana')
  .option('--chunk-size <size>', 'Chunk size for validation (default: 10)', '10')
  .option('--write-streams', 'Write normalized and quarantine NDJSON streams', false)
  .option('--output-dir <dir>', 'Output directory for NDJSON streams (default: current directory)')
  .action(async (options) => {
    try {
      if (options.file) {
        if (!fs.existsSync(options.file)) {
          console.error(`❌ File not found: ${options.file}`);
          process.exit(1);
        }

        await processFile(options.file, {
          chatId: options.chatId,
          callerName: options.callerName,
          chain: options.chain,
          chunkSize: parseInt(options.chunkSize, 10),
          writeStreams: options.writeStreams,
          outputDir: options.outputDir,
        });
      } else if (options.dir) {
        if (!fs.existsSync(options.dir)) {
          console.error(`❌ Directory not found: ${options.dir}`);
          process.exit(1);
        }

        await processDirectory(options.dir, {
          chatId: options.chatId,
          callerName: options.callerName,
          chain: options.chain,
          chunkSize: parseInt(options.chunkSize, 10),
          writeStreams: options.writeStreams,
          outputDir: options.outputDir,
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

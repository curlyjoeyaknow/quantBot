#!/usr/bin/env ts-node

/**
 * CLI script for ingesting Telegram JSON exports with normalization
 *
 * Pipeline: raw -> normalize -> validate -> store
 *
 * Outputs:
 * - normalized_messages.ndjson (good messages)
 * - quarantine.ndjson (bad messages + error codes)
 *
 * Usage:
 *   ts-node scripts/ingest/telegram-json.ts --file <path> [--chat-id <id>] [--output-dir <dir>]
 *   ts-node scripts/ingest/telegram-json.ts --dir <directory> [--output-dir <dir>]
 */

import { program } from 'commander';
import { ingestJsonExport } from '@quantbot/ingestion';
import { logger } from '@quantbot/utils';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Process a single JSON file
 */
async function processFile(
  filePath: string,
  options: {
    chatId?: string;
    outputDir?: string;
  }
): Promise<void> {
  try {
    console.log(`\n📄 Processing: ${path.basename(filePath)}`);
    console.log('─'.repeat(80));

    const result = await ingestJsonExport({
      filePath,
      chatId: options.chatId,
      outputDir: options.outputDir,
      writeStreams: true,
    });

    console.log(`\n✅ Completed: ${path.basename(filePath)}`);
    console.log(`   Total processed: ${result.totalProcessed}`);
    console.log(`   Normalized: ${result.normalized}`);
    console.log(`   Quarantined: ${result.quarantined}`);

    if (result.streamResult) {
      if (result.streamResult.normalizedPath) {
        console.log(`   📝 Normalized: ${result.streamResult.normalizedPath}`);
      }
      if (result.streamResult.quarantinePath) {
        console.log(`   ⚠️  Quarantine: ${result.streamResult.quarantinePath}`);
      }
    }

    if (result.quarantined > 0) {
      console.log(
        `\n   ⚠️  ${result.quarantined} messages quarantined (check quarantine file for details)`
      );
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

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    console.log(`\n[${i + 1}/${files.length}] Processing ${path.basename(file)}...`);

    try {
      const result = await ingestJsonExport({
        filePath: file,
        chatId: options.chatId,
        outputDir: options.outputDir,
        writeStreams: true,
      });

      totalProcessed += result.totalProcessed;
      totalNormalized += result.normalized;
      totalQuarantined += result.quarantined;

      console.log(`   ✅ ${result.normalized} normalized, ${result.quarantined} quarantined`);
    } catch (error) {
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
  if (totalQuarantined > 0) {
    console.log(
      `\n⚠️  ${totalQuarantined} messages quarantined - check quarantine files for details`
    );
  }
  console.log(`${'='.repeat(80)}\n`);
}

program
  .name('telegram-json')
  .description('Ingest Telegram JSON exports with normalization and quarantine')
  .option('--file <path>', 'Path to single JSON export file')
  .option('--dir <directory>', 'Path to directory containing JSON export files')
  .option('--chat-id <id>', 'Chat ID (optional, will be extracted from export if not provided)')
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
          outputDir: options.outputDir,
        });
      } else if (options.dir) {
        if (!fs.existsSync(options.dir)) {
          console.error(`❌ Directory not found: ${options.dir}`);
          process.exit(1);
        }
        await processDirectory(options.dir, {
          chatId: options.chatId,
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

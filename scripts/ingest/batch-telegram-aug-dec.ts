#!/usr/bin/env ts-node

/**
 * Batch ingest Telegram messages from data/messages directory
 * Filters messages from August 1, 2024 to December 11, 2024
 *
 * Usage:
 *   ts-node scripts/ingest/batch-telegram-aug-dec.ts --caller-name <name>
 */

import { program } from 'commander';
import * as fs from 'fs';
import * as path from 'path';
import { DateTime } from 'luxon';
// Import repositories from storage package
import {
  CallersRepository,
  TokensRepository,
  AlertsRepository,
  CallsRepository,
} from '@quantbot/storage';
import { TelegramAlertIngestionService } from '@quantbot/ingestion';
import { logger } from '@quantbot/utils';
import { getPostgresPool } from '@quantbot/storage';
import { readFileSync } from 'fs';
import { join } from 'path';

// Run migration first if needed
async function ensureMigration() {
  const pool = getPostgresPool();
  const migrationPath = join(__dirname, '../migration/postgres/002_add_alert_metrics.sql');
  const sql = readFileSync(migrationPath, 'utf8');

  try {
    await pool.query(sql);
    logger.info('Migration 002 applied (or already exists)');
  } catch (error: any) {
    if (error.message.includes('already exists') || error.message.includes('duplicate')) {
      logger.debug('Migration 002 columns already exist');
    } else {
      logger.warn('Migration 002 may have failed (continuing anyway)', { error: error.message });
    }
  }
}

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

// Date range: August 1, 2024 to December 11, 2024
const START_DATE = DateTime.fromObject({ year: 2024, month: 8, day: 1 });
const END_DATE = DateTime.fromObject({ year: 2024, month: 12, day: 11 });

/**
 * Check if a message timestamp is within our date range
 * Note: The ingestion service processes all messages, but we can filter at the parser level
 * For now, we'll let the service process all and rely on idempotency
 */
function isInDateRange(timestamp: DateTime): boolean {
  return timestamp >= START_DATE && timestamp <= END_DATE;
}

/**
 * Get all HTML files from data/messages directory
 */
function getMessageFiles(): string[] {
  const messagesDir = path.join(process.cwd(), 'data', 'messages');

  if (!fs.existsSync(messagesDir)) {
    throw new Error(`Messages directory not found: ${messagesDir}`);
  }

  const files = fs
    .readdirSync(messagesDir)
    .filter((file) => file.endsWith('.html'))
    .map((file) => path.join(messagesDir, file))
    .sort(); // Sort for consistent processing order

  return files;
}

/**
 * Process a single message file
 */
async function processFile(
  filePath: string,
  callerName: string,
  chain: string
): Promise<{ alertsInserted: number; callsInserted: number; tokensUpserted: number }> {
  try {
    logger.info(`Processing file: ${path.basename(filePath)}`);

    const result = await ingestionService.ingestExport({
      filePath,
      callerName,
      chain: chain as 'solana',
    });

    logger.info(`Completed ${path.basename(filePath)}`, {
      alertsInserted: result.alertsInserted,
      callsInserted: result.callsInserted,
      tokensUpserted: result.tokensUpserted,
    });

    return result;
  } catch (error) {
    logger.error(`Error processing ${path.basename(filePath)}`, error as Error);
    throw error;
  }
}

/**
 * Main batch ingestion function
 */
async function batchIngest(callerName: string, chain: string = 'solana'): Promise<void> {
  logger.info('Starting batch Telegram ingestion', {
    dateRange: `${START_DATE.toISODate()} to ${END_DATE.toISODate()}`,
    callerName,
    chain,
  });

  // Ensure migration is applied
  await ensureMigration();

  const files = getMessageFiles();
  logger.info(`Found ${files.length} message files to process`);

  if (files.length === 0) {
    logger.warn('No message files found!');
    return;
  }

  let totalAlerts = 0;
  let totalCalls = 0;
  let totalTokens = 0;
  let processed = 0;
  let failed = 0;

  const startTime = Date.now();

  for (const file of files) {
    try {
      const result = await processFile(file, callerName, chain);
      totalAlerts += result.alertsInserted;
      totalCalls += result.callsInserted;
      totalTokens += result.tokensUpserted;
      processed++;

      // Progress update
      logger.info(`Progress: ${processed}/${files.length} files processed`, {
        totalAlerts,
        totalCalls,
        totalTokens,
      });

      // Small delay between files to avoid overwhelming the database
      await new Promise((resolve) => setTimeout(resolve, 500));
    } catch (error) {
      failed++;
      logger.error(`Failed to process ${path.basename(file)}`, error as Error);
      // Continue with next file
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  logger.info('Batch ingestion complete!', {
    filesProcessed: processed,
    filesFailed: failed,
    totalFiles: files.length,
    totalAlerts,
    totalCalls,
    totalTokens,
    elapsedSeconds: elapsed,
  });

  console.log('\n✅ Batch ingestion complete!');
  console.log(`   Files processed: ${processed}/${files.length}`);
  console.log(`   Files failed: ${failed}`);
  console.log(`   Total alerts inserted: ${totalAlerts}`);
  console.log(`   Total calls inserted: ${totalCalls}`);
  console.log(`   Total tokens upserted: ${totalTokens}`);
  console.log(`   Time elapsed: ${elapsed}s`);
}

program
  .name('batch-telegram-aug-dec')
  .description('Batch ingest Telegram messages from August 1 to December 11, 2024')
  .requiredOption('--caller-name <name>', 'Name of the caller (e.g., Brook, Lsy)')
  .option('--chain <chain>', 'Blockchain (default: solana)', 'solana')
  .action(async (options) => {
    try {
      await batchIngest(options.callerName, options.chain);
      process.exit(0);
    } catch (error) {
      logger.error('Batch ingestion failed', error as Error);
      console.error('\n❌ Batch ingestion failed:', (error as Error).message);
      process.exit(1);
    }
  });

program.parse();

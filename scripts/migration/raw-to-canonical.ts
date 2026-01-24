#!/usr/bin/env tsx
/**
 * Migration Script: Raw Data → Canonical Format
 *
 * Transforms raw data records into canonical events and stores them.
 *
 * Usage:
 *   tsx scripts/migration/raw-to-canonical.ts \
 *     --db-path data/quantbot.duckdb \
 *     [--source-type telegram_export] \
 *     [--from 2024-01-01] \
 *     [--to 2024-12-31] \
 *     [--dry-run]
 */

import { parseArgs } from 'util';
import { RawDataDuckDBAdapter } from '@quantbot/storage';
import { CanonicalDuckDBAdapter } from '@quantbot/storage';
import { transformCallToCanonical } from '@quantbot/core';
import type { CallSignal } from '@quantbot/core';
import { logger } from '@quantbot/infra/utils';

interface MigrationArgs {
  dbPath: string;
  sourceType?: 'telegram_export' | 'api_response' | 'file_upload' | 'stream_event';
  from?: string;
  to?: string;
  dryRun: boolean;
}

async function migrateRawToCanonical(args: MigrationArgs): Promise<void> {
  const rawRepo = new RawDataDuckDBAdapter(args.dbPath);
  const canonicalRepo = new CanonicalDuckDBAdapter(args.dbPath);

  // Check availability
  if (!(await rawRepo.isAvailable())) {
    throw new Error('Raw data repository is not available');
  }
  if (!(await canonicalRepo.isAvailable())) {
    throw new Error('Canonical repository is not available');
  }

  // Query raw data
  const filter = {
    sourceType: args.sourceType,
    timeRange:
      args.from || args.to
        ? {
            from: args.from || '',
            to: args.to || '',
          }
        : undefined,
  };

  logger.info('Querying raw data', { filter });
  const rawRecords = await rawRepo.query(filter);

  logger.info(`Found ${rawRecords.length} raw data records`);

  if (rawRecords.length === 0) {
    logger.info('No raw data to migrate');
    return;
  }

  // Transform to canonical events
  const canonicalEvents = [];
  let transformed = 0;
  let skipped = 0;

  for (const record of rawRecords) {
    try {
      // Parse raw content
      const content = typeof record.content === 'string' ? JSON.parse(record.content) : record.content;

      // Transform based on source type
      if (record.sourceType === 'telegram_export') {
        // Try to parse as CallSignal
        // Note: This is a simplified example - actual transformation depends on raw data structure
        if (content.token && content.caller) {
          const callSignal = content as CallSignal;
          const canonicalEvent = transformCallToCanonical(callSignal);
          canonicalEvent.sourceHash = record.hash;
          canonicalEvent.sourceRunId = record.runId;
          canonicalEvents.push(canonicalEvent);
          transformed++;
        } else {
          skipped++;
          logger.warn('Skipping record - not a valid CallSignal', { recordId: record.id });
        }
      } else {
        skipped++;
        logger.warn('Skipping record - unsupported source type', {
          recordId: record.id,
          sourceType: record.sourceType,
        });
      }
    } catch (error) {
      skipped++;
      logger.error('Failed to transform record', error as Error, { recordId: record.id });
    }
  }

  logger.info(`Transformed ${transformed} records, skipped ${skipped}`);

  if (args.dryRun) {
    logger.info('DRY RUN: Would store canonical events', { count: canonicalEvents.length });
    return;
  }

  // Store canonical events (batch)
  if (canonicalEvents.length > 0) {
    logger.info('Storing canonical events', { count: canonicalEvents.length });
    await canonicalRepo.storeBatch(canonicalEvents);
    logger.info('Migration complete', { transformed, skipped });
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      'db-path': { type: 'string', default: 'data/quantbot.duckdb' },
      'source-type': { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      'dry-run': { type: 'boolean', default: false },
    },
  });

  const args: MigrationArgs = {
    dbPath: values['db-path'] as string,
    sourceType: values['source-type'] as MigrationArgs['sourceType'],
    from: values.from as string,
    to: values.to as string,
    dryRun: values['dry-run'] as boolean,
  };

  try {
    await migrateRawToCanonical(args);
    process.exit(0);
  } catch (error) {
    logger.error('Migration failed', error as Error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}


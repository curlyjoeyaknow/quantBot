#!/usr/bin/env tsx
/**
 * Initialize ClickHouse tables for OHLCV ingestion
 *
 * Usage: tsx scripts/system/init-clickhouse-tables.ts
 */

import { initClickHouse } from '@quantbot/storage';
import { logger } from '@quantbot/utils';

async function main() {
  try {
    console.log('Initializing ClickHouse database and tables...');
    await initClickHouse();
    console.log('✅ ClickHouse database and tables initialized successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Failed to initialize ClickHouse:', error);
    logger.error('Failed to initialize ClickHouse', error as Error);
    process.exit(1);
  }
}

main();
